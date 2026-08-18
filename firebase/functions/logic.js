'use strict';
/**
 * RankedSat Firebase — pure match logic (no Firestore, no firebase-functions).
 *
 * Everything here operates on plain objects so it can be unit-tested without
 * the emulator. index.js wires these into Firestore transactions.
 *
 * ANSWER SECRECY INVARIANT: publicQuestion() is the ONLY projection of a bank
 * question that may be written to any client-readable location before a match
 * is finalized. It must never include `correct`, `rationale`, or `suspect`.
 */

const rules = require('./rules');

const QUEUE_DEFS = {
  'ela':         { section: 'ela',  label: 'ELA' },
  'math-desmos': { section: 'math', label: 'Math (Desmos)' },
  'math-nocalc': { section: 'math', label: 'Math (No Desmos)' },
};

const RATING_START = rules.RATING_START;
const QUESTIONS_PER_MATCH = rules.QUESTIONS_PER_MATCH;

/** What a client may see BEFORE finalization. Never correct/rationale/suspect. */
function publicQuestion(q) {
  return {
    id: q.id,
    section: q.section,
    domain: q.domain || '',
    skill: q.skill || '',
    difficulty: q.difficulty,
    type: q.type,
    passage: q.stemImageUrl ? null : (q.passage || null),
    stem: q.stemImageUrl ? '' : q.stem,
    choices: q.type === 'mcq' ? (q.choices || []).map(c => ({ label: c.label, text: c.text })) : null,
    hasFigure: !!q.hasFigure,
    figureUrl: q.stemImageUrl ? null : (q.figureUrl || null),
    stemImageUrl: q.stemImageUrl || null,
  };
}

/**
 * Pick a match set following a difficulty plan. Same behavior as the local
 * server: prefer exact difficulties, fall back to any question in the section
 * if a difficulty runs dry, shuffle final order.
 */
function pickQuestions(bankQuestions, section, plan, excludeIds = new Set()) {
  const inSection = bankQuestions.filter(q => q.section === section);
  const fresh = inSection.filter(q => !excludeIds.has(q.id));
  const pool = fresh.length >= plan.length ? fresh : inSection;
  const byDiff = { easy: [], medium: [], hard: [] };
  pool.forEach(q => { if (byDiff[q.difficulty]) byDiff[q.difficulty].push(q); });
  Object.values(byDiff).forEach(shuffle);
  const chosen = [];
  const used = new Set();
  for (const d of plan) {
    let q = (byDiff[d] || []).find(x => !used.has(x.id));
    if (!q) {
      const rest = pool.filter(x => !used.has(x.id));
      q = rest[Math.floor(Math.random() * rest.length)];
    }
    if (!q) break;
    used.add(q.id);
    chosen.push(q);
  }
  return shuffle(chosen);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Grade a raw answer against the PRIVATE bank question. */
function grade(q, rawAnswer) {
  if (rawAnswer == null) return false;
  const given = String(rawAnswer).trim();
  if (!given) return false;
  if (q.type === 'mcq') {
    return given.toUpperCase() === q.correct.trim().toUpperCase();
  }
  return rules.gradeSpr(q.correct, given);
}

function sanitizeName(raw) {
  let n = String(raw || '').replace(/[<>&\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length > 20) n = n.slice(0, 20).trim();
  return n || 'Player';
}

function defaultProfile(name, nowIso) {
  return {
    displayName: name,
    ratings: { ela: RATING_START, math: RATING_START },
    games: { ela: 0, math: 0 },
    wins: 0, losses: 0, draws: 0,
    activeMatchId: null,
    createdAt: nowIso,
    lastSeen: nowIso,
  };
}

/**
 * Expire a player's private state in place: every unanswered question counts
 * wrong, completion time is charged as the full clock.
 */
function expirePrivate(priv, totalQuestions, clockMs) {
  for (let i = priv.qIndex; i < totalQuestions; i++) {
    if (!priv.answers[i]) priv.answers[i] = { answer: null, correct: false, timeMs: null, expired: true };
  }
  priv.qIndex = totalQuestions;
  priv.finished = true;
  priv.timedOut = true;
  priv.completionMs = clockMs;
}

/** Corrects + completion summary for rules.decideWinner. */
function totalsOf(priv, totalQuestions) {
  let correctCount = 0;
  for (let i = 0; i < totalQuestions; i++) {
    const a = priv.answers[i];
    if (a && a.correct) correctCount++;
  }
  return { correctCount, completionMs: priv.completionMs, timedOut: !!priv.timedOut };
}

/**
 * Compute the full finalization payload (winner, rating changes, review) from
 * plain state. Pure — writes are the caller's job.
 *
 * @param match  { section, stake, questions:[publicQuestion], participants:[uidA,uidB] }
 * @param privs  { [uid]: privateState } — answers arrays with correctness
 * @param users  { [uid]: userDoc }      — for ratings before
 * @param bankById  Map/obj id -> PRIVATE bank question (for correct/rationale)
 * @param opts   { forfeitUid?: string, reason?: string }
 */
function computeFinalize(match, privs, users, bankById, opts = {}) {
  const [uidA, uidB] = match.participants;
  const total = match.questions.length;
  const totals = {
    [uidA]: totalsOf(privs[uidA], total),
    [uidB]: totalsOf(privs[uidB], total),
  };

  let winnerUid = null;
  let draw = false;
  let forfeit = null;
  if (opts.forfeitUid) {
    winnerUid = opts.forfeitUid === uidA ? uidB : uidA;
    forfeit = { loserUid: opts.forfeitUid, reason: opts.reason || 'forfeit' };
  } else {
    const w = rules.decideWinner(totals[uidA], totals[uidB]);
    if (w === -1) draw = true;
    else winnerUid = w === 0 ? uidA : uidB;
  }

  const section = match.section;
  const stake = match.stake;
  const before = {
    [uidA]: users[uidA].ratings[section],
    [uidB]: users[uidB].ratings[section],
  };
  const delta = { [uidA]: 0, [uidB]: 0 };
  if (!draw) {
    delta[winnerUid] = stake;
    delta[winnerUid === uidA ? uidB : uidA] = -stake;
  }
  const after = { [uidA]: before[uidA] + delta[uidA], [uidB]: before[uidB] + delta[uidB] };

  // Full reveal: correct answers + rationales exist client-side ONLY from here.
  const review = match.questions.map((pq, i) => {
    const bq = bankById[pq.id];
    return {
      index: i,
      id: pq.id,
      section: pq.section,
      domain: pq.domain,
      skill: pq.skill,
      difficulty: pq.difficulty,
      type: pq.type,
      passage: pq.passage,
      stem: pq.stem,
      choices: pq.choices,
      figureUrl: pq.figureUrl,
      stemImageUrl: pq.stemImageUrl,
      correct: bq ? bq.correct : null,
      rationale: bq ? (bq.rationale || null) : null,
      results: {
        [uidA]: answerResult(privs[uidA], i),
        [uidB]: answerResult(privs[uidB], i),
      },
    };
  });

  return {
    winnerUid, draw, forfeit, totals,
    rating: { section, stake, before, after, delta },
    review,
  };
}

function answerResult(priv, i) {
  const a = priv.answers[i] || null;
  return a
    ? { answer: a.answer == null ? null : String(a.answer), correct: !!a.correct, timeMs: a.timeMs == null ? null : a.timeMs }
    : { answer: null, correct: false, timeMs: null };
}

/** Apply a finalize result to a user doc (mutates a copy; returns it). */
function applyResultToUser(userDoc, uid, fin, nowIso) {
  const u = JSON.parse(JSON.stringify(userDoc));
  const section = fin.rating.section;
  u.ratings[section] = fin.rating.after[uid];
  u.games[section] = (u.games[section] || 0) + 1;
  if (fin.draw) u.draws = (u.draws || 0) + 1;
  else if (fin.winnerUid === uid) u.wins = (u.wins || 0) + 1;
  else u.losses = (u.losses || 0) + 1;
  u.activeMatchId = null;
  u.lastSeen = nowIso;
  return u;
}

module.exports = {
  QUEUE_DEFS,
  RATING_START,
  QUESTIONS_PER_MATCH,
  publicQuestion,
  pickQuestions,
  grade,
  sanitizeName,
  defaultProfile,
  expirePrivate,
  totalsOf,
  computeFinalize,
  applyResultToUser,
};
