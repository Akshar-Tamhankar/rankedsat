'use strict';
/**
 * RankedSat Firebase — END-TO-END duel test against the Emulator Suite.
 *
 * Requires the auth + functions + firestore + hosting emulators to be running
 * (Firestore emulator needs a Java runtime). Easiest invocation:
 *
 *   cd firebase
 *   npm run test:emu
 *     (= firebase emulators:exec --project demo-rankedsat
 *        --only auth,functions,firestore,hosting "node test-duel-emu.js")
 *
 * Assumes functions/.env.local sets RANKEDSAT_ACCESS_CODE=test-code-123
 * (checked in; emulator-only).
 *
 * Coverage:
 *   - hosting serves the client + a figure PNG; the private bank is NOT served
 *   - anonymous auth; profiles created at 1000/1000
 *   - invite-code gate on joinQueue (+ verifyAccessCode)
 *   - transactional pairing; both players get the SAME question set
 *   - banded difficulty (fresh players -> all easy) + advertised clock/stake
 *   - ANSWER SECRECY: no correct/rationale/suspect anywhere in any
 *     client-readable doc before finalization; private docs unreadable by the
 *     opponent and third parties; match doc unreadable by non-participants;
 *     all client writes to competitive state rejected by rules
 *   - sequential enforcement (out-of-order + resubmission rejected)
 *   - SPR fraction-aware grading through the real callable
 *   - winner by corrects; tiebreak by completion time; symmetric stakes
 *   - deadline enforcement via emulator-only test clock (expired submit,
 *     lazy finalization, timed-out players charged the full clock)
 *   - forfeit = loss at stake; math rating shared across desmos/no-calc queues
 *   - leaderboard reflects final ratings
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Preflight: Java (Firestore emulator) + emulator ports
// ---------------------------------------------------------------------------
function javaAvailable() {
  try { execSync('java -version', { stdio: 'ignore' }); return true; } catch { return false; }
}
if (!process.env.SKIP_JAVA_CHECK && !javaAvailable()) {
  console.error('SKIP: no Java runtime found on PATH. The Firestore emulator requires Java.');
  console.error('Install a JRE/JDK (e.g. Temurin 21 from adoptium.net), then run: npm run test:emu');
  process.exit(3);
}

const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInAnonymously } = require('firebase/auth');
const {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
} = require('firebase/firestore');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');

const PROJECT = 'demo-rankedsat';
const HOST = '127.0.0.1';
const PORTS = { auth: 9099, firestore: 8080, functions: 5001, hosting: 5000 };
const ACCESS_CODE = 'test-code-123';
const HOSTING = 'http://' + HOST + ':' + PORTS.hosting;

// Private answer key, read from DISK (functions-only bundle) — the whole point
// is that clients can never obtain this through any served/queried surface.
const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'functions', 'bank.json'), 'utf8'));
const keyById = {};
BANK.questions.forEach(q => { keyById[q.id] = q; });

const rules = require('./functions/rules');

const failures = [];
function check(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { console.error('  FAIL  ' + label); failures.push(label); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function newClient(name) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: PROJECT + '.firebaseapp.com' }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + HOST + ':' + PORTS.auth, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, HOST, PORTS.firestore);
  const fns = getFunctions(app);
  connectFunctionsEmulator(fns, HOST, PORTS.functions);
  return { name, app, auth, db, fns, uid: null };
}
async function signIn(c) {
  const cred = await signInAnonymously(c.auth);
  c.uid = cred.user.uid;
  return c;
}
function call(c, fn, data) {
  return httpsCallable(c.fns, fn)(data || {}).then(r => r.data);
}
async function callErr(c, fn, data) {
  try { await call(c, fn, data); return null; }
  catch (err) { return { code: String(err.code || ''), message: String(err.message || '') }; }
}
async function fsErr(promise) {
  try { await promise; return null; }
  catch (err) { return { code: String(err.code || ''), message: String(err.message || '') }; }
}

/** Recursively collect every object key in a value. */
function allKeys(v, out) {
  out = out || new Set();
  if (Array.isArray(v)) v.forEach(x => allKeys(x, out));
  else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) { out.add(k); allKeys(v[k], out); }
  }
  return out;
}
function assertNoForbiddenKeys(value, label) {
  const keys = allKeys(value);
  const bad = ['correct', 'rationale', 'suspect'].filter(k => keys.has(k));
  check(bad.length === 0, label + ' contains no correct/rationale/suspect keys' +
    (bad.length ? ' (LEAKED: ' + bad.join(',') + ')' : ''));
}

function rightAnswerFor(q) {
  const k = keyById[q.id];
  if (!k) throw new Error('no key for ' + q.id);
  if (k.type === 'mcq') return k.correct.trim();
  // Numeric variant: exercises fraction-aware SPR grading through the callable.
  const first = String(k.correct).split(',')[0].trim();
  const n = rules.parseNumeric(first);
  return Number.isFinite(n) ? n.toFixed(3) : first;
}
function wrongAnswerFor(q) {
  const k = keyById[q.id];
  if (k.type === 'mcq') {
    const labels = (k.choices && k.choices.length ? k.choices.map(c => String(c.label)) : ['A', 'B', 'C', 'D']);
    return labels.find(l => l.toUpperCase() !== k.correct.trim().toUpperCase()) || 'A';
  }
  return '424242';
}

/** Wait until the match doc (read as client c) satisfies pred. */
function waitForMatch(c, matchId, pred, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const ref = doc(c.db, 'matches', matchId);
    const timer = setTimeout(() => { unsub(); reject(new Error('timeout waiting: ' + label)); }, timeoutMs || 15000);
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists() && pred(snap.data())) {
        clearTimeout(timer); unsub(); resolve(snap.data());
      }
    }, err => { clearTimeout(timer); unsub(); reject(err); });
  });
}

/** Pair two clients through the real queue flow; returns matchId. */
async function pairUp(a, b, queue, extra) {
  const ja = await call(a, 'joinQueue', { queue, accessCode: ACCESS_CODE, ...(extra || {}) });
  if (ja.matched || ja.resume) throw new Error('expected ' + a.name + ' to wait in queue');
  const matchIdPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error('queue listener timeout')); }, 15000);
    const unsub = onSnapshot(doc(a.db, 'queue', a.uid), snap => {
      if (snap.exists() && snap.data().matchId) {
        clearTimeout(timer); unsub(); resolve(snap.data().matchId);
      }
    }, err => { clearTimeout(timer); unsub(); reject(err); });
  });
  const jb = await call(b, 'joinQueue', { queue, accessCode: ACCESS_CODE, ...(extra || {}) });
  if (!jb.matched) throw new Error('expected ' + b.name + ' to be matched instantly');
  const seenByA = await matchIdPromise;
  if (seenByA !== jb.matchId) throw new Error('matchId mismatch between queue doc and joinQueue response');
  await deleteDoc(doc(a.db, 'queue', a.uid)).catch(() => {});
  return jb.matchId;
}

async function playAll(c, matchId, questions, mode /* 'right'|'wrong' */, delayMs) {
  const acks = [];
  for (let i = 0; i < questions.length; i++) {
    if (delayMs) await sleep(delayMs);
    const ans = mode === 'right' ? rightAnswerFor(questions[i]) : wrongAnswerFor(questions[i]);
    acks.push(await call(c, 'submitAnswer', { matchId, index: i, answer: ans }));
  }
  return acks;
}

(async () => {
  console.log('=== Hosting emulator ===');
  const idx = await fetch(HOSTING + '/');
  check(idx.status === 200 && (await idx.text()).includes('RankedSat'), 'GET / serves the client (200, contains RankedSat)');
  const cjs = await fetch(HOSTING + '/client.js');
  check(cjs.status === 200, 'GET /client.js -> 200');
  const css = await fetch(HOSTING + '/style.css');
  check(css.status === 200, 'GET /style.css -> 200');
  const someFigure = BANK.questions.find(q => q.stemImageUrl);
  const fig = await fetch(HOSTING + someFigure.stemImageUrl);
  check(fig.status === 200 && String(fig.headers.get('content-type')).includes('image/png'),
    'GET ' + someFigure.stemImageUrl + ' -> 200 image/png');
  for (const secret of ['/bank.json', '/functions/bank.json', '/../functions/bank.json', '/data/questions.jsonl']) {
    const r = await fetch(HOSTING + secret);
    check(r.status === 404, 'SECRECY: GET ' + secret + ' -> 404 (private bank not hosted)');
  }

  console.log('=== Auth & profiles ===');
  const A = await signIn(newClient('Alice'));
  const B = await signIn(newClient('Bob'));
  const C = await signIn(newClient('Snoop'));
  check(A.uid && B.uid && C.uid && A.uid !== B.uid, 'three distinct anonymous users signed in');

  const pa = await call(A, 'ensureProfile', { name: 'AutoAlice' });
  const pb = await call(B, 'ensureProfile', { name: 'AutoBob' });
  await call(C, 'ensureProfile', { name: 'Snoop' });
  check(pa.ok && pa.profile.ratings.ela === 1000 && pa.profile.ratings.math === 1000, 'fresh profiles start at 1000/1000');
  check(pa.gateEnabled === true, 'access gate reported enabled (.env.local)');

  console.log('=== Invite gate ===');
  const vBad = await call(A, 'verifyAccessCode', { code: 'nope' });
  const vGood = await call(A, 'verifyAccessCode', { code: ACCESS_CODE });
  check(vBad.ok === false && vGood.ok === true, 'verifyAccessCode rejects wrong / accepts right code');
  const gateErr = await callErr(A, 'joinQueue', { queue: 'ela' });
  check(!!gateErr && gateErr.code.includes('permission-denied'), 'joinQueue without code -> permission-denied');

  console.log('=== Rules lockdown (client SDK vs firestore.rules) ===');
  check(!!(await fsErr(setDoc(doc(A.db, 'queue', A.uid), { uid: A.uid, queue: 'ela', joinedAtMs: Date.now(), matchId: null }))),
    'client cannot create its own queue doc (functions only)');
  check(!!(await fsErr(getDoc(doc(C.db, 'queue', A.uid)))), 'third party cannot read another queue doc');
  check(!!(await fsErr(updateDoc(doc(A.db, 'users', A.uid), { 'ratings.ela': 9999 }))),
    'client cannot write own ratings');
  check(!(await fsErr(updateDoc(doc(A.db, 'users', A.uid), { displayName: 'AutoAlice' }))),
    'client CAN update own displayName');
  check(!(await fsErr(getDoc(doc(C.db, 'users', A.uid)))), 'user docs are publicly readable (leaderboard fields)');

  // =========================================================================
  console.log('=== Duel 1 (ELA): pairing, identical questions, secrecy, corrects win ===');
  const m1 = await pairUp(A, B, 'ela');
  const m1a = (await getDoc(doc(A.db, 'matches', m1))).data();
  const m1b = (await getDoc(doc(B.db, 'matches', m1))).data();
  check(m1a.questions.length === 5 && JSON.stringify(m1a.questions.map(q => q.id)) === JSON.stringify(m1b.questions.map(q => q.id)),
    'both players read the SAME 5-question set');
  check(m1a.section === 'ela' && m1a.questions.every(q => q.section === 'ela'), 'section is ela');
  check(m1a.questions.every(q => q.difficulty === 'easy'), 'avg 1000 (<1200): all 5 questions easy');
  check(m1a.clockMs === 300000 && m1a.deadlineAtMs - m1a.startAtMs === 300000, 'clock 5:00 with matching deadline');
  check(m1a.stake === 30, 'even match stake ±30');
  assertNoForbiddenKeys(m1a, 'PRE-FINALIZE match doc');
  check(!m1a.review && !m1a.result, 'no review/result before finalization');

  check(!!(await fsErr(getDoc(doc(C.db, 'matches', m1)))), 'non-participant cannot read the match doc');
  check(!!(await fsErr(getDoc(doc(B.db, 'matches', m1, 'private', A.uid)))), 'opponent cannot read my private doc');
  check(!!(await fsErr(getDoc(doc(C.db, 'matches', m1, 'private', A.uid)))), 'third party cannot read my private doc');
  const myPriv = await getDoc(doc(A.db, 'matches', m1, 'private', A.uid));
  check(myPriv.exists() && myPriv.data().qIndex === 0, 'player CAN read own private doc (resume support)');
  check(!!(await fsErr(updateDoc(doc(A.db, 'matches', m1), { stake: 2 }))), 'client cannot write the match doc');
  const cSubmit = await callErr(C, 'submitAnswer', { matchId: m1, index: 0, answer: 'A' });
  check(!!cSubmit && cSubmit.code.includes('permission-denied'), 'non-participant submitAnswer rejected');

  const resumeRes = await call(A, 'joinQueue', { queue: 'ela', accessCode: ACCESS_CODE });
  check(resumeRes.resume === true && resumeRes.matchId === m1, 'joinQueue during an active match returns resume');

  const outOfOrder = await callErr(A, 'submitAnswer', { matchId: m1, index: 2, answer: 'A' });
  check(!!outOfOrder && outOfOrder.code.includes('failed-precondition'), 'out-of-order submit (index 2 first) rejected');

  const a1 = await call(A, 'submitAnswer', { matchId: m1, index: 0, answer: rightAnswerFor(m1a.questions[0]) });
  check(a1.ok === true && a1.correct === true && typeof a1.remainingMs === 'number' && a1.remainingMs > 0,
    'first correct answer accepted with server clock resync');
  check(!('points' in a1) && !('correctAnswer' in a1), 'submit ack leaks nothing beyond own correctness');
  const resub = await callErr(A, 'submitAnswer', { matchId: m1, index: 0, answer: 'A' });
  check(!!resub && resub.code.includes('failed-precondition'), 'resubmitting an answered question rejected');

  for (let i = 1; i < 5; i++) {
    const r = await call(A, 'submitAnswer', { matchId: m1, index: i, answer: rightAnswerFor(m1a.questions[i]) });
    if (i < 4) check(r.ok && r.correct, 'Alice Q' + (i + 1) + ' graded correct');
    else check(r.ok && r.correct && r.finished === true, 'Alice finished all 5 (server confirms)');
  }

  // B sees A's progress but never correctness.
  const midDoc = (await getDoc(doc(B.db, 'matches', m1))).data();
  check(midDoc.progress[A.uid].qIndex === 5 && midDoc.progress[A.uid].finished === true,
    'opponent progress visible (qIndex/finished)');
  assertNoForbiddenKeys(midDoc, 'mid-match doc (A finished, B not)');
  check(!midDoc.review && !midDoc.result, 'still no reveal while opponent is playing');

  const bAcks = await playAll(B, m1, m1b.questions, 'wrong');
  check(bAcks.every(r => r.ok && r.correct === false), 'all 5 Bob answers graded incorrect');

  const end1 = await waitForMatch(A, m1, m => m.state === 'ended', 15000, 'duel 1 finalize');
  check(end1.result.winnerUid === A.uid && end1.result.draw === false, 'Alice wins by corrects');
  check(end1.result.corrects[A.uid] === 5 && end1.result.corrects[B.uid] === 0, 'corrects 5-0');
  check(end1.result.rating.stake === 30 && end1.result.rating.delta[A.uid] === 30 && end1.result.rating.delta[B.uid] === -30,
    'stake ±30 applied');
  check(end1.result.rating.after[A.uid] === 1030 && end1.result.rating.after[B.uid] === 970, 'ratings 1030 / 970');
  check(Array.isArray(end1.review) && end1.review.length === 5 &&
        end1.review.every(q => typeof q.correct === 'string' && keyById[q.id] && q.correct === keyById[q.id].correct),
    'review reveals the true correct answers ONLY now');
  check(end1.review.some(q => q.rationale), 'review includes rationales');
  const uA1 = (await getDoc(doc(A.db, 'users', A.uid))).data();
  check(uA1.ratings.ela === 1030 && uA1.wins === 1 && uA1.games.ela === 1 && uA1.activeMatchId === null,
    'user doc updated transactionally (rating, record, activeMatchId cleared)');

  // =========================================================================
  console.log('=== Duel 2 (Math no-calc): SPR fraction grading + time tiebreaker ===');
  const m2 = await pairUp(A, B, 'math-nocalc');
  const m2doc = (await getDoc(doc(A.db, 'matches', m2))).data();
  check(m2doc.section === 'math' && m2doc.stake === 30, 'math duel, math ratings still even -> stake 30');
  const sprCount = m2doc.questions.filter(q => q.type === 'spr').length;
  console.log('  info  SPR questions in this set: ' + sprCount);
  const aAcks2 = await playAll(A, m2, m2doc.questions, 'right');           // fast
  check(aAcks2.every(r => r.ok && r.correct === true), 'Alice 5/5 in math (SPR numeric variants accepted)');
  const bAcks2 = await playAll(B, m2, m2doc.questions, 'right', 400);      // slower, also 5/5
  check(bAcks2.every(r => r.ok && r.correct === true), 'Bob also 5/5 (tie on corrects)');
  const end2 = await waitForMatch(A, m2, m => m.state === 'ended', 15000, 'duel 2 finalize');
  check(end2.result.completionMs[A.uid] < end2.result.completionMs[B.uid], 'Alice completed faster');
  check(end2.result.winnerUid === A.uid, 'tie on corrects -> faster completion wins');
  check(end2.result.rating.after[A.uid] === 1030 && end2.result.rating.after[B.uid] === 970, 'math ratings 1030 / 970');

  // =========================================================================
  console.log('=== Duel 3 (ELA, test clock): deadline enforcement + lazy finalize ===');
  const m3 = await pairUp(A, B, 'ela', { testClockMs: 4000 });
  const m3doc = (await getDoc(doc(A.db, 'matches', m3))).data();
  check(m3doc.clockMs === 4000, 'emulator-only test clock override honored (4s match)');
  const q3ack = await call(A, 'submitAnswer', { matchId: m3, index: 0, answer: rightAnswerFor(m3doc.questions[0]) });
  check(q3ack.ok && q3ack.correct, 'Alice answers 1 correct before the deadline');
  await sleep(4700); // let both deadlines pass
  const late = await call(A, 'submitAnswer', { matchId: m3, index: 1, answer: rightAnswerFor(m3doc.questions[1]) });
  check(late.ok === false && late.expired === true, 'submit after the deadline -> expired, counted wrong');
  const end3 = await waitForMatch(B, m3, m => m.state === 'ended', 15000, 'duel 3 finalize');
  check(end3.result.timedOut[A.uid] === true && end3.result.timedOut[B.uid] === true, 'both players timed out');
  check(end3.result.completionMs[A.uid] === 4000 && end3.result.completionMs[B.uid] === 4000,
    'timed-out players charged the full clock');
  check(end3.result.corrects[A.uid] === 1 && end3.result.corrects[B.uid] === 0 && end3.result.winnerUid === A.uid,
    '1-0 on corrects decides it despite the double timeout');
  const stake3 = rules.stakeFor(1030, 970);
  check(end3.result.rating.stake === stake3 && end3.result.rating.after[A.uid] === 1030 + stake3,
    'gap-scaled stake ±' + stake3 + ' applied (ela 1030 vs 970)');

  // checkMatch on an ended match is a harmless no-op read.
  const cm = await call(B, 'checkMatch', { matchId: m3 });
  check(cm.state === 'ended', 'checkMatch reports ended state');

  // =========================================================================
  console.log('=== Duel 4 (Math Desmos): forfeit = loss at stake; shared math rating ===');
  const m4 = await pairUp(A, B, 'math-desmos');
  const m4doc = (await getDoc(doc(A.db, 'matches', m4))).data();
  check(m4doc.desmos === true, 'desmos flag set for math-desmos queue');
  const stake4 = rules.stakeFor(1030, 970);
  check(m4doc.stake === stake4, 'desmos queue uses the shared math rating (stake ±' + stake4 + ')');
  await call(A, 'submitAnswer', { matchId: m4, index: 0, answer: rightAnswerFor(m4doc.questions[0]) });
  const ff = await call(B, 'forfeit', { matchId: m4 });
  check(ff.ok === true && ff.state === 'ended', 'forfeit finalizes immediately');
  const end4 = await waitForMatch(A, m4, m => m.state === 'ended', 15000, 'duel 4 finalize');
  check(end4.result.forfeit && end4.result.forfeit.loserUid === B.uid && end4.result.winnerUid === A.uid,
    'forfeiter recorded as loser');
  check(end4.result.rating.delta[B.uid] === -stake4 && end4.result.rating.after[A.uid] === 1030 + stake4,
    'forfeit loss at the full stake ±' + stake4);

  // =========================================================================
  console.log('=== Leaderboard ===');
  const board = await call(A, 'leaderboard', {});
  const elaTop = board.ela[0], mathTop = board.math[0];
  check(elaTop && elaTop.name === 'AutoAlice' && elaTop.rating === 1030 + stake3 && elaTop.games === 2,
    'ELA board: Alice on top at ' + (1030 + stake3) + ' with 2 games');
  check(mathTop && mathTop.name === 'AutoAlice' && mathTop.rating === 1030 + stake4 && mathTop.games === 2,
    'Math board: Alice on top at ' + (1030 + stake4) + ' with 2 games');
  check(board.ela.every(p => p.games > 0) && board.math.every(p => p.games > 0),
    'boards only list players with games in that section');

  console.log('');
  if (failures.length === 0) {
    console.log('ALL EMULATOR E2E CHECKS PASSED');
    process.exit(0);
  } else {
    console.error(failures.length + ' CHECK(S) FAILED:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})().catch(err => {
  console.error('TEST ERROR:', err && err.stack || err);
  process.exit(1);
});
