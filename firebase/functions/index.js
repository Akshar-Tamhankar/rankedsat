'use strict';
/**
 * RankedSat — Cloud Functions match engine (Firebase port).
 *
 * Product model: simultaneous-start, independently-played duels.
 *  - joinQueue pairs two waiting players transactionally, picks ONE question
 *    set (banded by the average of both section ratings), stamps a server
 *    start time, and gives each player the same match-wide clock
 *    (5:00 below avg 1500, 7:00 at/above).
 *  - Each player answers sequentially at their own pace (submitAnswer).
 *    Out-of-order submissions are rejected; wrong answers are final.
 *  - Deadlines are enforced with SERVER time only. checkMatch lazily expires
 *    and finalizes matches whose deadlines passed (no scheduled functions).
 *  - Winner = most corrects; tie -> faster completion (timed-out = full
 *    clock); equal -> draw. Rating: symmetric stake
 *    X = clamp(round(30 - |gap|/20), 2, 30); forfeit = loss at stake.
 *
 * ANSWER SECRECY (#1 invariant): the full bank (bank.json, incl. correct +
 * rationale) lives ONLY in this functions bundle. Client-readable match docs
 * carry logic.publicQuestion() projections during play; correct answers and
 * rationales are written into the match doc ONLY at finalization.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const rules = require('./rules');
const logic = require('./logic');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1', maxInstances: 10, memory: '256MiB' });

// ---------------------------------------------------------------------------
// Private bank (functions-only)
// ---------------------------------------------------------------------------
const BANK = require('./bank.json');
const bankById = {};
BANK.questions.forEach(q => { bankById[q.id] = q; });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ACCESS_CODE = process.env.RANKEDSAT_ACCESS_CODE || '';
const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const ENV_TEST_CLOCK = parseInt(process.env.RANKEDSAT_TEST_CLOCK_MS || '', 10);
const QUEUE_TTL_MS = 120000; // queue docs older than this are stale (client gone)

/** Match clock in ms. Test overrides are honored ONLY inside the emulator. */
function clockMsForMatch(avgRating, requestedTestClockMs) {
  if (IS_EMULATOR) {
    const req = Number(requestedTestClockMs);
    if (Number.isFinite(req) && req >= 500 && req <= 600000) return Math.round(req);
    if (Number.isFinite(ENV_TEST_CLOCK) && ENV_TEST_CLOCK > 0) return ENV_TEST_CLOCK;
  }
  return rules.clockSecondsFor(avgRating) * 1000;
}

function reqUid(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  return request.auth.uid;
}

function checkAccessCode(data) {
  if (!ACCESS_CODE) return;
  const supplied = data && typeof data.accessCode === 'string' ? data.accessCode : '';
  if (supplied !== ACCESS_CODE) {
    throw new HttpsError('permission-denied', 'invite-only');
  }
}

function userRef(uid) { return db.collection('users').doc(uid); }
function queueRef(uid) { return db.collection('queue').doc(uid); }
function matchRef(id) { return db.collection('matches').doc(id); }
function privRef(matchId, uid) { return matchRef(matchId).collection('private').doc(uid); }

function publicProfile(u, uid) {
  return {
    uid,
    name: u.displayName,
    ratings: u.ratings,
    games: u.games,
    wins: u.wins, losses: u.losses, draws: u.draws,
    activeMatchId: u.activeMatchId || null,
  };
}

function newPrivate(uid, matchId) {
  return {
    uid, matchId,
    qIndex: 0,
    answers: [],
    finished: false,
    timedOut: false,
    forfeited: false,
    completionMs: null,
    lastAnswerAtMs: null,
  };
}

/**
 * Finalize inside a transaction: compute winner + symmetric stake, write
 * result + full review (the ONLY pre-existing place correct/rationale may
 * reach a client-readable doc), update both user docs.
 * All t.get reads must already have happened.
 */
function finalizeInTxn(t, mRef, match, privs, users, opts = {}) {
  const nowIso = new Date().toISOString();
  const fin = logic.computeFinalize(match, privs, users, bankById, opts);
  const [uidA, uidB] = match.participants;

  for (const uid of [uidA, uidB]) {
    t.set(userRef(uid), logic.applyResultToUser(users[uid], uid, fin, nowIso));
  }
  const progress = {};
  for (const uid of [uidA, uidB]) {
    progress[uid] = {
      qIndex: privs[uid].qIndex,
      finished: true,
      timedOut: !!privs[uid].timedOut,
    };
  }
  t.update(mRef, {
    state: 'ended',
    endedAtMs: Date.now(),
    progress,
    result: {
      winnerUid: fin.winnerUid,
      draw: fin.draw,
      forfeit: fin.forfeit,
      corrects: { [uidA]: fin.totals[uidA].correctCount, [uidB]: fin.totals[uidB].correctCount },
      completionMs: { [uidA]: fin.totals[uidA].completionMs, [uidB]: fin.totals[uidB].completionMs },
      timedOut: { [uidA]: fin.totals[uidA].timedOut, [uidB]: fin.totals[uidB].timedOut },
      rating: fin.rating,
    },
    review: fin.review,
  });
  return fin;
}

/** Read a user doc inside a txn, defaulting to a fresh profile if missing. */
async function txnUser(t, uid) {
  const snap = await t.get(userRef(uid));
  if (snap.exists) return snap.data();
  return logic.defaultProfile('Player', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// ensureProfile — create/refresh users/{uid}; returns profile + gate status
// ---------------------------------------------------------------------------
exports.ensureProfile = onCall(async (request) => {
  const uid = reqUid(request);
  const name = logic.sanitizeName(request.data && request.data.name);
  const nowIso = new Date().toISOString();
  const ref = userRef(uid);
  const profile = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) {
      const fresh = logic.defaultProfile(name, nowIso);
      t.set(ref, fresh);
      return fresh;
    }
    const u = snap.data();
    u.displayName = name;
    u.lastSeen = nowIso;
    t.update(ref, { displayName: name, lastSeen: nowIso });
    return u;
  });
  return {
    ok: true,
    profile: publicProfile(profile, uid),
    gateEnabled: !!ACCESS_CODE,
    serverNow: Date.now(),
  };
});

// ---------------------------------------------------------------------------
// verifyAccessCode — lets the entry gate validate before queueing
// ---------------------------------------------------------------------------
exports.verifyAccessCode = onCall(async (request) => {
  if (!ACCESS_CODE) return { ok: true, gateEnabled: false };
  const code = request.data && typeof request.data.code === 'string' ? request.data.code : '';
  return { ok: code === ACCESS_CODE, gateEnabled: true };
});

// ---------------------------------------------------------------------------
// joinQueue — enqueue, or transactionally pair with a waiting player
// ---------------------------------------------------------------------------
exports.joinQueue = onCall(async (request) => {
  const uid = reqUid(request);
  const data = request.data || {};
  checkAccessCode(data);

  const queue = data.queue;
  const qdef = logic.QUEUE_DEFS[queue];
  if (!qdef) throw new HttpsError('invalid-argument', 'Unknown queue.');
  const section = qdef.section;
  if (!BANK.questions.some(q => q.section === section)) {
    throw new HttpsError('failed-precondition', 'No questions available for that section.');
  }

  // Ensure a profile exists (outside the pairing transaction).
  const meSnap = await userRef(uid).get();
  if (!meSnap.exists) {
    await userRef(uid).set(logic.defaultProfile(logic.sanitizeName(data.name), new Date().toISOString()));
  } else if (meSnap.data().activeMatchId) {
    const am = await matchRef(meSnap.data().activeMatchId).get();
    if (am.exists && am.data().state === 'active') {
      return { ok: true, resume: true, matchId: am.id, serverNow: Date.now() };
    }
  }

  const result = await db.runTransaction(async (t) => {
    const now = Date.now();
    // --- reads (all before writes) ---
    const candSnap = await t.get(
      db.collection('queue')
        .where('queue', '==', queue)
        .orderBy('joinedAtMs', 'asc')
        .limit(8)
    );
    const stale = [];
    let partner = null;
    candSnap.forEach(docSnap => {
      const d = docSnap.data();
      if (d.uid === uid) return;               // my own stale entry: overwritten below
      if (d.matchId) return;                    // already paired, waiting for pickup
      if (now - d.joinedAtMs > QUEUE_TTL_MS) { stale.push(docSnap.ref); return; }
      if (!partner) partner = { ref: docSnap.ref, data: d };
    });

    const myUser = await txnUser(t, uid);
    let partnerUser = null;
    if (partner) partnerUser = await txnUser(t, partner.data.uid);

    // --- writes ---
    stale.forEach(ref => t.delete(ref));

    if (!partner) {
      t.set(queueRef(uid), {
        uid, queue,
        joinedAtMs: now,
        matchId: null,
        displayName: myUser.displayName || 'Player',
      });
      return { matched: false };
    }

    const partnerUid = partner.data.uid;
    const ratings = {
      [partnerUid]: partnerUser.ratings[section],
      [uid]: myUser.ratings[section],
    };
    const avg = (ratings[partnerUid] + ratings[uid]) / 2;
    const clockMs = clockMsForMatch(avg, data.testClockMs);
    const stake = rules.stakeFor(ratings[partnerUid], ratings[uid]);
    const plan = rules.difficultyPlanFor(avg);
    const questions = logic.pickQuestions(BANK.questions, section, plan).map(logic.publicQuestion);
    if (questions.length < logic.QUESTIONS_PER_MATCH) {
      throw new HttpsError('failed-precondition', 'Question bank too small for a match.');
    }

    const mRef = db.collection('matches').doc();
    const startAtMs = now;
    t.set(mRef, {
      participants: [partnerUid, uid],
      queue,
      queueLabel: qdef.label,
      section,
      desmos: queue === 'math-desmos',
      state: 'active',
      clockMs,
      startAtMs,
      deadlineAtMs: startAtMs + clockMs,
      stake,
      names: {
        [partnerUid]: partnerUser.displayName || 'Player',
        [uid]: myUser.displayName || 'Player',
      },
      ratingsBefore: ratings,
      questions,
      progress: {
        [partnerUid]: { qIndex: 0, finished: false, timedOut: false },
        [uid]: { qIndex: 0, finished: false, timedOut: false },
      },
      createdAtMs: now,
    });
    t.set(privRef(mRef.id, partnerUid), newPrivate(partnerUid, mRef.id));
    t.set(privRef(mRef.id, uid), newPrivate(uid, mRef.id));

    // Tell the waiting player (their client listens to their queue doc).
    t.update(partner.ref, { matchId: mRef.id });
    t.delete(queueRef(uid));
    t.set(userRef(partnerUid), { ...partnerUser, activeMatchId: mRef.id });
    t.set(userRef(uid), { ...myUser, activeMatchId: mRef.id });

    return { matched: true, matchId: mRef.id };
  });

  return { ok: true, ...result, serverNow: Date.now() };
});

// ---------------------------------------------------------------------------
// leaveQueue — belt-and-braces server-side dequeue (clients may also delete
// their own queue doc directly; rules allow it)
// ---------------------------------------------------------------------------
exports.leaveQueue = onCall(async (request) => {
  const uid = reqUid(request);
  await queueRef(uid).delete();
  return { ok: true };
});

// ---------------------------------------------------------------------------
// submitAnswer — grade against the private key; sequential + deadline enforced
// ---------------------------------------------------------------------------
exports.submitAnswer = onCall(async (request) => {
  const uid = reqUid(request);
  const data = request.data || {};
  const matchId = typeof data.matchId === 'string' ? data.matchId : '';
  const index = Number(data.index);
  if (!matchId) throw new HttpsError('invalid-argument', 'matchId required.');

  const out = await db.runTransaction(async (t) => {
    const now = Date.now();
    const mRef = matchRef(matchId);
    const mSnap = await t.get(mRef);
    if (!mSnap.exists) throw new HttpsError('not-found', 'No such match.');
    const match = mSnap.data();
    if (!match.participants.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');
    const oppUid = match.participants.find(p => p !== uid);

    if (match.state !== 'active') {
      return { ok: false, over: true, state: match.state, serverNow: now };
    }

    // reads before writes
    const [privMeSnap, privOppSnap] = await Promise.all([
      t.get(privRef(matchId, uid)),
      t.get(privRef(matchId, oppUid)),
    ]);
    const users = {
      [uid]: await txnUser(t, uid),
      [oppUid]: await txnUser(t, oppUid),
    };
    const privMe = privMeSnap.data();
    const privOpp = privOppSnap.data();
    const privs = { [uid]: privMe, [oppUid]: privOpp };
    const total = match.questions.length;
    const deadline = match.startAtMs + match.clockMs;

    if (privMe.finished) {
      return { ok: false, error: 'Already finished.', serverNow: now };
    }

    if (now > deadline) {
      // Clock ran out before this answer arrived: expire, maybe finalize.
      logic.expirePrivate(privMe, total, match.clockMs);
      t.set(privRef(matchId, uid), privMe);
      // Both players share the same deadline, so the opponent is expired too
      // (if they hadn't already finished) and the match finalizes now.
      if (!privOpp.finished) {
        logic.expirePrivate(privOpp, total, match.clockMs);
        t.set(privRef(matchId, oppUid), privOpp);
      }
      finalizeInTxn(t, mRef, match, privs, users);
      return { ok: false, expired: true, serverNow: now };
    }

    if (!Number.isInteger(index) || index !== privMe.qIndex) {
      throw new HttpsError('failed-precondition',
        'Out of order: expected question ' + privMe.qIndex + '.');
    }

    const bq = bankById[match.questions[index].id];
    if (!bq) throw new HttpsError('internal', 'Question missing from bank.');
    const rawAnswer = data.answer == null ? null : String(data.answer);
    const correct = logic.grade(bq, rawAnswer);
    const timeMs = now - (privMe.lastAnswerAtMs || match.startAtMs);

    privMe.answers[index] = { answer: rawAnswer, correct, timeMs, expired: false };
    privMe.qIndex = index + 1;
    privMe.lastAnswerAtMs = now;
    if (privMe.qIndex >= total) {
      privMe.finished = true;
      privMe.completionMs = Math.min(now - match.startAtMs, match.clockMs);
    }

    t.set(privRef(matchId, uid), privMe);
    const progress = { ...match.progress };
    progress[uid] = { qIndex: privMe.qIndex, finished: privMe.finished, timedOut: false };
    t.update(mRef, { progress });

    if (privMe.finished && privOpp.finished) {
      finalizeInTxn(t, mRef, match, privs, users);
    }

    return {
      ok: true,
      index,
      correct,          // micro-reveal: YOUR correctness only, never the key
      finished: privMe.finished,
      remainingMs: Math.max(0, deadline - now),
      serverNow: now,
    };
  });

  return out;
});

// ---------------------------------------------------------------------------
// checkMatch — lazy deadline enforcement + finalization (no cron needed).
// Clients call it when their local clock passes 0 and when (re)opening a match.
// ---------------------------------------------------------------------------
exports.checkMatch = onCall(async (request) => {
  const uid = reqUid(request);
  const data = request.data || {};
  const matchId = typeof data.matchId === 'string' ? data.matchId : '';
  if (!matchId) throw new HttpsError('invalid-argument', 'matchId required.');

  const out = await db.runTransaction(async (t) => {
    const now = Date.now();
    const mRef = matchRef(matchId);
    const mSnap = await t.get(mRef);
    if (!mSnap.exists) throw new HttpsError('not-found', 'No such match.');
    const match = mSnap.data();
    if (!match.participants.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');

    if (match.state !== 'active') {
      return { state: match.state, serverNow: now };
    }

    const [uidA, uidB] = match.participants;
    const [privASnap, privBSnap] = await Promise.all([
      t.get(privRef(matchId, uidA)),
      t.get(privRef(matchId, uidB)),
    ]);
    const users = {
      [uidA]: await txnUser(t, uidA),
      [uidB]: await txnUser(t, uidB),
    };
    const privs = { [uidA]: privASnap.data(), [uidB]: privBSnap.data() };
    const total = match.questions.length;
    const deadline = match.startAtMs + match.clockMs;

    let changed = false;
    for (const u of [uidA, uidB]) {
      if (!privs[u].finished && now > deadline) {
        logic.expirePrivate(privs[u], total, match.clockMs);
        t.set(privRef(matchId, u), privs[u]);
        changed = true;
      }
    }

    if (privs[uidA].finished && privs[uidB].finished) {
      finalizeInTxn(t, mRef, match, privs, users);
      return { state: 'ended', serverNow: now };
    }

    if (changed) {
      const progress = { ...match.progress };
      for (const u of [uidA, uidB]) {
        progress[u] = { qIndex: privs[u].qIndex, finished: privs[u].finished, timedOut: !!privs[u].timedOut };
      }
      t.update(mRef, { progress });
    }

    return { state: 'active', remainingMs: Math.max(0, deadline - now), serverNow: now };
  });

  return out;
});

// ---------------------------------------------------------------------------
// forfeit — loss at the match stake, effective immediately
// ---------------------------------------------------------------------------
exports.forfeit = onCall(async (request) => {
  const uid = reqUid(request);
  const data = request.data || {};
  const matchId = typeof data.matchId === 'string' ? data.matchId : '';
  if (!matchId) throw new HttpsError('invalid-argument', 'matchId required.');

  const out = await db.runTransaction(async (t) => {
    const now = Date.now();
    const mRef = matchRef(matchId);
    const mSnap = await t.get(mRef);
    if (!mSnap.exists) throw new HttpsError('not-found', 'No such match.');
    const match = mSnap.data();
    if (!match.participants.includes(uid)) throw new HttpsError('permission-denied', 'Not your match.');
    if (match.state !== 'active') {
      return { ok: false, state: match.state, serverNow: now };
    }

    const [uidA, uidB] = match.participants;
    const [privASnap, privBSnap] = await Promise.all([
      t.get(privRef(matchId, uidA)),
      t.get(privRef(matchId, uidB)),
    ]);
    const users = {
      [uidA]: await txnUser(t, uidA),
      [uidB]: await txnUser(t, uidB),
    };
    const privs = { [uidA]: privASnap.data(), [uidB]: privBSnap.data() };

    privs[uid].forfeited = true;
    privs[uid].finished = true;
    t.set(privRef(matchId, uid), privs[uid]);
    finalizeInTxn(t, mRef, match, privs, users, { forfeitUid: uid, reason: 'forfeit' });
    return { ok: true, state: 'ended', serverNow: now };
  });

  return out;
});

// ---------------------------------------------------------------------------
// leaderboard — top-50 per section among players with games in that section
// ---------------------------------------------------------------------------
exports.leaderboard = onCall(async () => {
  const board = {};
  for (const section of ['ela', 'math']) {
    const snap = await db.collection('users')
      .orderBy('ratings.' + section, 'desc')
      .limit(150)
      .get();
    board[section] = [];
    snap.forEach(docSnap => {
      const u = docSnap.data();
      if (!u.games || !(u.games[section] > 0)) return;
      if (board[section].length >= 50) return;
      board[section].push({
        name: u.displayName,
        rating: u.ratings[section],
        games: u.games[section],
        wins: u.wins || 0, losses: u.losses || 0, draws: u.draws || 0,
      });
    });
  }
  return board;
});
