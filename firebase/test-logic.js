'use strict';
/**
 * RankedSat Firebase — logic-level test suite (NO emulator required).
 *
 * Covers everything that doesn't need Firestore:
 *   - rules.js: banded difficulty, clock, symmetric stakes, winner/tiebreak/draw,
 *     fraction-aware SPR parsing + bank-wide grading sweep
 *   - logic.publicQuestion: ANSWER SECRECY — no correct/rationale/suspect in any
 *     client-visible projection of the whole 3,443-question bank
 *   - logic.pickQuestions: per-band composition, identical-set determinism inputs
 *   - logic.grade: mcq + spr paths
 *   - logic.expirePrivate / computeFinalize: winner by corrects, time tiebreak,
 *     draw, timeout charging, forfeit-as-loss, symmetric stake application
 *   - logic.applyResultToUser: rating/record bookkeeping
 *
 * Run: node firebase/test-logic.js
 */

const rules = require('./functions/rules');
const logic = require('./functions/logic');
const BANK = require('./functions/bank.json');

const failures = [];
function check(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { console.error('  FAIL  ' + label); failures.push(label); }
}

// ---------------------------------------------------------------------------
console.log('=== Rules unit checks ===');

check(rules.difficultyPlanFor(1000).every(d => d === 'easy') && rules.difficultyPlanFor(1000).length === 5,
  'avg <1200 -> five easy questions');
check(rules.difficultyPlanFor(1199).every(d => d === 'easy'), 'avg 1199 still all-easy');
let sawEasy = false, sawMedium = false, midOk = true;
for (let i = 0; i < 60; i++) {
  const plan = rules.difficultyPlanFor(1350);
  if (plan.length !== 5 || plan.some(d => d !== 'easy' && d !== 'medium')) midOk = false;
  if (plan.includes('easy')) sawEasy = true;
  if (plan.includes('medium')) sawMedium = true;
}
check(midOk, 'avg 1200-1499 -> only easy/medium slots');
check(sawEasy && sawMedium, 'avg 1200-1499 mix uses both difficulties (60 draws)');
const high = rules.difficultyPlanFor(1600);
const hCounts = high.reduce((m, d) => (m[d] = (m[d] || 0) + 1, m), {});
check(hCounts.easy === 1 && hCounts.medium === 1 && hCounts.hard === 3, 'avg >=1500 -> 1E+1M+3H');

check(rules.clockSecondsFor(1000) === 300 && rules.clockSecondsFor(1499) === 300, 'clock 5:00 below avg 1500');
check(rules.clockSecondsFor(1500) === 420 && rules.clockSecondsFor(1700) === 420, 'clock 7:00 at avg >=1500');

check(rules.stakeFor(1000, 1000) === 30, 'even match stake = 30');
check(rules.stakeFor(1000, 1400) === 10, 'gap 400 -> stake 10');
check(rules.stakeFor(1030, 970) === 27, 'gap 60 -> stake 27');
check(rules.stakeFor(1000, 2000) === 2, 'huge gap clamps to stake 2');
check(rules.stakeFor(1400, 1000) === rules.stakeFor(1000, 1400), 'stake symmetric in the gap');

check(rules.decideWinner({ correctCount: 4, completionMs: 200000 }, { correctCount: 3, completionMs: 100 }) === 0,
  'more corrects wins regardless of time');
check(rules.decideWinner({ correctCount: 3, completionMs: 90000 }, { correctCount: 3, completionMs: 80000 }) === 1,
  'tie on corrects -> lower completion time wins');
check(rules.decideWinner({ correctCount: 3, completionMs: 90000 }, { correctCount: 3, completionMs: 90000 }) === -1,
  'equal corrects AND equal times -> draw');

check(Math.abs(rules.parseNumeric('14/3') - 4.666666) < 0.001, 'parseNumeric handles fractions');
check(rules.parseNumeric('.5') === 0.5 && rules.parseNumeric('-3/4') === -0.75, 'parseNumeric ".5" and "-3/4"');
check(Number.isNaN(rules.parseNumeric('abc')) && Number.isNaN(rules.parseNumeric('1/0')), 'parseNumeric rejects junk and /0');
check(rules.gradeSpr('3/2, 1.5', '1.500') === true, 'gradeSpr accepts decimal form of fraction');
check(rules.gradeSpr('59/9, 6.555, 6.556', '6.556') === true, 'gradeSpr accepts truncated repeating decimal');
check(rules.gradeSpr('42', '41') === false, 'gradeSpr rejects wrong values');

// Bank-wide SPR sweep: numeric variant of every SPR answer must grade correct.
function numericVariant(correctField) {
  const first = String(correctField).split(',')[0].trim();
  const n = rules.parseNumeric(first);
  return Number.isFinite(n) ? n.toFixed(3) : first;
}
let sprTotal = 0, sprBad = 0;
for (const q of BANK.questions) {
  if (q.type !== 'spr') continue;
  sprTotal++;
  if (!rules.gradeSpr(q.correct, numericVariant(q.correct))) {
    sprBad++;
    if (sprBad <= 5) console.error('   SPR would fail: ' + q.id + ' correct=' + JSON.stringify(q.correct));
  }
}
check(sprBad === 0, 'All ' + sprTotal + ' bank SPR answers grade correct in numeric format');

// ---------------------------------------------------------------------------
console.log('=== ANSWER SECRECY: publicQuestion projection over the whole bank ===');

const FORBIDDEN = ['correct', 'rationale', 'suspect'];
let leakCount = 0, projected = 0;
for (const q of BANK.questions) {
  const pub = logic.publicQuestion(q);
  projected++;
  const json = JSON.stringify(pub);
  for (const f of FORBIDDEN) {
    if (Object.prototype.hasOwnProperty.call(pub, f)) leakCount++;
  }
  // Also catch nested leaks (e.g., a choices object accidentally carrying keys).
  if (json.indexOf('"rationale"') !== -1 || json.indexOf('"correct"') !== -1) leakCount++;
}
check(leakCount === 0, 'publicQuestion leaks nothing across all ' + projected + ' bank questions');

// Every public projection keeps what the client DOES need.
const spot = logic.publicQuestion(BANK.questions.find(q => q.type === 'mcq' && !q.stemImageUrl));
check(typeof spot.stem === 'string' && Array.isArray(spot.choices) && spot.choices.length >= 2,
  'publicQuestion keeps stem/choices for text MCQs');
const spotImg = logic.publicQuestion(BANK.questions.find(q => q.stemImageUrl));
check(typeof spotImg.stemImageUrl === 'string' && spotImg.stemImageUrl.indexOf('/figures/') === 0,
  'publicQuestion keeps hosting-relative stemImageUrl for image questions');

// ---------------------------------------------------------------------------
console.log('=== pickQuestions banding ===');

for (const [avg, label] of [[1000, 'all-easy'], [1350, 'easy/medium'], [1600, '1E+1M+3H']]) {
  for (const section of ['ela', 'math']) {
    const plan = rules.difficultyPlanFor(avg);
    const picked = logic.pickQuestions(BANK.questions, section, plan);
    const ids = new Set(picked.map(q => q.id));
    const wantCounts = plan.reduce((m, d) => (m[d] = (m[d] || 0) + 1, m), {});
    const gotCounts = picked.reduce((m, q) => (m[q.difficulty] = (m[q.difficulty] || 0) + 1, m), {});
    const bandOk = JSON.stringify(Object.keys(wantCounts).sort().map(k => [k, wantCounts[k]])) ===
                   JSON.stringify(Object.keys(gotCounts).sort().map(k => [k, gotCounts[k]]));
    check(picked.length === 5 && ids.size === 5 && bandOk && picked.every(q => q.section === section),
      section + ' avg ' + avg + ' (' + label + '): 5 unique in-section questions matching the plan');
  }
}

// ---------------------------------------------------------------------------
console.log('=== grade ===');

const mcq = BANK.questions.find(q => q.type === 'mcq');
check(logic.grade(mcq, mcq.correct.trim().toLowerCase()) === true, 'mcq grading is case-insensitive');
const wrongLabel = ['A', 'B', 'C', 'D'].find(l => l !== mcq.correct.trim().toUpperCase());
check(logic.grade(mcq, wrongLabel) === false, 'mcq wrong label graded incorrect');
check(logic.grade(mcq, null) === false && logic.grade(mcq, '  ') === false, 'null/blank answers graded incorrect');
const spr = BANK.questions.find(q => q.type === 'spr' && q.correct.indexOf('/') !== -1);
if (spr) {
  check(logic.grade(spr, numericVariant(spr.correct)) === true, 'spr fraction graded correct in decimal form');
}

// ---------------------------------------------------------------------------
console.log('=== finalize computation ===');

const A = 'uidAAA', B = 'uidBBB';
function mkMatch(section, stake, n) {
  const qs = logic.pickQuestions(BANK.questions, section, rules.difficultyPlanFor(1000)).map(logic.publicQuestion);
  return { participants: [A, B], section, stake, clockMs: 300000, questions: qs.slice(0, n || 5) };
}
function mkPriv(answers, completionMs, timedOut) {
  return { qIndex: answers.length, answers, finished: true, timedOut: !!timedOut, completionMs, lastAnswerAtMs: null, forfeited: false };
}
function ans(correct, timeMs) { return { answer: correct ? 'X' : 'Y', correct, timeMs: timeMs || 1000, expired: false }; }
function mkUsers(ra, rb, section) {
  const ua = logic.defaultProfile('Alice', 'now'); ua.ratings[section] = ra;
  const ub = logic.defaultProfile('Bob', 'now'); ub.ratings[section] = rb;
  return { [A]: ua, [B]: ub };
}
const bankById = {};
BANK.questions.forEach(q => { bankById[q.id] = q; });

// 1. Win by corrects
{
  const m = mkMatch('ela', 30);
  const privs = {
    [A]: mkPriv([ans(true), ans(true), ans(true), ans(true), ans(true)], 60000),
    [B]: mkPriv([ans(false), ans(false), ans(false), ans(false), ans(false)], 50000),
  };
  const fin = logic.computeFinalize(m, privs, mkUsers(1000, 1000, 'ela'), bankById);
  check(fin.winnerUid === A && !fin.draw, 'win by corrects (5-0) despite slower time');
  check(fin.rating.delta[A] === 30 && fin.rating.delta[B] === -30 &&
        fin.rating.after[A] === 1030 && fin.rating.after[B] === 970,
    'symmetric stake ±30 applied to ratings');
  check(fin.review.length === 5 && fin.review.every(r => typeof r.correct === 'string'),
    'review reveals correct answers at finalization');
  check(fin.review.every(r => r.results[A].correct === true && r.results[B].correct === false),
    'review carries both players\' per-question results');
  const uA = logic.applyResultToUser(mkUsers(1000, 1000, 'ela')[A], A, fin, 'now2');
  const uB = logic.applyResultToUser(mkUsers(1000, 1000, 'ela')[B], B, fin, 'now2');
  check(uA.ratings.ela === 1030 && uA.wins === 1 && uA.games.ela === 1 && uA.activeMatchId === null,
    'winner user doc bookkeeping');
  check(uB.ratings.ela === 970 && uB.losses === 1 && uB.games.ela === 1, 'loser user doc bookkeeping');
}

// 2. Tie on corrects -> faster completion wins
{
  const m = mkMatch('math', 27);
  const privs = {
    [A]: mkPriv([ans(true), ans(true), ans(true), ans(false), ans(false)], 90000),
    [B]: mkPriv([ans(true), ans(true), ans(true), ans(false), ans(false)], 80000),
  };
  const fin = logic.computeFinalize(m, privs, mkUsers(1030, 970, 'math'), bankById);
  check(fin.winnerUid === B, 'tie on corrects -> faster player wins');
  check(fin.rating.delta[B] === 27 && fin.rating.delta[A] === -27, 'gap-scaled stake ±27 applied');
}

// 3. Timeout charges the full clock in the tiebreak
{
  const m = mkMatch('ela', 30);
  const privA = mkPriv([ans(true), ans(true), ans(false), ans(false), ans(false)], 250000);
  const privB = { qIndex: 2, answers: [ans(true), ans(true)], finished: false, timedOut: false, completionMs: null, lastAnswerAtMs: null, forfeited: false };
  logic.expirePrivate(privB, 5, m.clockMs);
  check(privB.finished && privB.timedOut && privB.completionMs === 300000 && privB.answers.length === 5 &&
        privB.answers[4].expired === true && privB.answers[4].correct === false,
    'expirePrivate fills unanswered as wrong and charges the full clock');
  const fin = logic.computeFinalize(m, { [A]: privA, [B]: privB }, mkUsers(1000, 1000, 'ela'), bankById);
  check(fin.winnerUid === A, 'equal corrects: finisher (250s) beats timed-out player (charged 300s)');
  check(fin.totals[B].timedOut === true, 'timeout recorded in totals');
}

// 4. Draw: equal corrects, both timed out (identical full-clock times)
{
  const m = mkMatch('ela', 30);
  const privA = { qIndex: 1, answers: [ans(true)], finished: false, timedOut: false, completionMs: null, lastAnswerAtMs: null, forfeited: false };
  const privB = { qIndex: 1, answers: [ans(true)], finished: false, timedOut: false, completionMs: null, lastAnswerAtMs: null, forfeited: false };
  logic.expirePrivate(privA, 5, m.clockMs);
  logic.expirePrivate(privB, 5, m.clockMs);
  const users = mkUsers(1000, 1000, 'ela');
  const fin = logic.computeFinalize(m, { [A]: privA, [B]: privB }, users, bankById);
  check(fin.draw === true && fin.winnerUid === null, 'double timeout with equal corrects -> draw');
  check(fin.rating.delta[A] === 0 && fin.rating.delta[B] === 0, 'draw changes no ratings');
  const uA = logic.applyResultToUser(users[A], A, fin, 'now2');
  check(uA.draws === 1 && uA.wins === 0 && uA.losses === 0, 'draw recorded on user doc');
}

// 5. Forfeit = loss at the same stake, regardless of the scoreboard
{
  const m = mkMatch('math', 30);
  const privs = {
    [A]: mkPriv([ans(true), ans(true), ans(true), ans(true), ans(true)], 60000),  // A was winning...
    [B]: mkPriv([ans(false)], null),
  };
  const fin = logic.computeFinalize(m, privs, mkUsers(1000, 1000, 'math'), bankById,
    { forfeitUid: A, reason: 'forfeit' });                                         // ...but A forfeits
  check(fin.winnerUid === B && fin.forfeit && fin.forfeit.loserUid === A, 'forfeiter loses even when ahead');
  check(fin.rating.delta[A] === -30 && fin.rating.delta[B] === 30, 'forfeit applies the full stake');
}

// 6. Review never invents data for unanswered questions
{
  const m = mkMatch('ela', 30);
  const privA = mkPriv([ans(true), ans(true), ans(true), ans(true), ans(true)], 60000);
  const privB = { qIndex: 0, answers: [], finished: true, timedOut: false, completionMs: null, lastAnswerAtMs: null, forfeited: true };
  const fin = logic.computeFinalize(m, { [A]: privA, [B]: privB }, mkUsers(1000, 1000, 'ela'), bankById, { forfeitUid: B });
  check(fin.review.every(r => r.results[B].answer === null && r.results[B].correct === false),
    'unanswered questions show null answers in the review');
}

// ---------------------------------------------------------------------------
console.log('');
if (failures.length === 0) {
  console.log('ALL LOGIC CHECKS PASSED');
  process.exit(0);
} else {
  console.error(failures.length + ' CHECK(S) FAILED:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
