'use strict';
/**
 * Automated end-to-end duel test (dev-only) for the corrects-based rules.
 *
 * Part 1 — unit checks on app/rules.js (shared by the server):
 *   banded difficulty plans, clock choice, symmetric gap-scaled stakes,
 *   winner/tiebreaker/draw decision, fraction-aware numeric parsing, and a
 *   bank-wide SPR grading regression sweep (the old flake: parseFloat("3/2")
 *   silently truncates to 3 — every SPR answer must grade correct when
 *   submitted in the numeric format this test uses).
 *
 * Part 2 — live duels against a running server on :3000:
 *   Duel 1 (ELA):   Alice all-correct fast, Bob all-wrong  -> win by corrects,
 *                   all-easy band (avg 1000), clock 300s, stake +/-30.
 *   Duel 2 (Math):  same, exercising SPR numeric-variant answers.
 *   Duel 3 (ELA):   BOTH all-correct, Alice faster -> tiebreak on completion
 *                   time, stake recomputed from the now-unequal ratings.
 *   Then: persistence of ratings/records to players.json.
 *
 * A live draw is not practically testable (it needs equal corrects AND
 * millisecond-equal completion times, or a double timeout at 5 minutes), so
 * draw handling is covered by the rules.decideWinner unit checks.
 *
 * Run: node test-duel.js   (server must already be listening on :3000)
 */

const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const rules = require('./rules');

const URL = 'http://localhost:3000';
const DATA_QUESTIONS = path.join(__dirname, '..', 'data', 'questions.jsonl');
const SAMPLE_QUESTIONS = path.join(__dirname, 'sample-questions.jsonl');
const PLAYERS_JSON = path.join(__dirname, '..', 'data', 'players.json');

// ---------------------------------------------------------------------------
// Answer key (same source file the server loads; test runs on the same machine)
// ---------------------------------------------------------------------------
const keySource = fs.existsSync(DATA_QUESTIONS) ? DATA_QUESTIONS : SAMPLE_QUESTIONS;
const usingRealBank = keySource === DATA_QUESTIONS;
const ANSWER_KEY = {}; // id -> { correct, type, choices }
fs.readFileSync(keySource, 'utf8').split(/\r?\n/).forEach(line => {
  const t = line.trim();
  if (!t) return;
  try {
    const q = JSON.parse(t);
    ANSWER_KEY[q.id] = { correct: q.correct, type: q.type, choices: q.choices };
  } catch { /* skip bad lines */ }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const failures = [];
function check(cond, label) {
  if (cond) console.log('  PASS  ' + label);
  else { console.error('  FAIL  ' + label); failures.push(label); }
}

/** Numeric-format variant of an SPR answer. MUST be fraction-aware:
 *  parseFloat("3/2") === 3 was the root cause of the flaky failures. */
function numericVariant(correctField) {
  const first = String(correctField).split(',')[0].trim();
  const n = rules.parseNumeric(first);
  return Number.isFinite(n) ? n.toFixed(3) : first;
}

function correctAnswerFor(q, sprNumericFormat) {
  const key = ANSWER_KEY[q.id];
  if (!key) throw new Error('No answer key for question ' + q.id);
  if (key.type === 'mcq') return key.correct;
  return sprNumericFormat ? numericVariant(key.correct) : key.correct.split(',')[0].trim();
}

function wrongAnswerFor(q) {
  const key = ANSWER_KEY[q.id];
  if (!key) throw new Error('No answer key for question ' + q.id);
  if (key.type === 'mcq') {
    const labels = Array.isArray(key.choices) && key.choices.length
      ? key.choices.map(c => String(c.label))
      : ['A', 'B', 'C', 'D'];
    return labels.filter(l => l.toUpperCase() !== key.correct.trim().toUpperCase())[0];
  }
  return '424242';
}

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error(name + ': connect timeout')), 8000);
    socket.on('connect', () => {
      socket.emit('hello', { name }, (res) => {
        clearTimeout(timer);
        if (!res || !res.ok) return reject(new Error(name + ': hello failed'));
        resolve({ socket, name: res.profile.name, profile: res.profile });
      });
    });
    socket.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function playDuel(client, { answerRight, answerDelayMs, sprNumericFormat }) {
  return new Promise((resolve, reject) => {
    const obs = {
      matchFound: null, questions: [], acks: [],
      leakedFields: 0, ackPointsLeak: 0, opponentProgressEvents: 0, matchEnd: null,
    };
    const timer = setTimeout(() => reject(new Error(client.name + ': duel timeout (90s)')), 90000);

    const onMatchFound = m => { obs.matchFound = m; };
    const onOppProgress = () => { obs.opponentProgressEvents++; };
    const onQuestion = payload => {
      obs.questions.push(payload);
      const q = payload.question;
      if ('correct' in q || 'rationale' in q || 'suspect' in q) obs.leakedFields++;
      const ans = answerRight ? correctAnswerFor(q, sprNumericFormat) : wrongAnswerFor(q);
      setTimeout(() => {
        client.socket.emit('answer', { index: payload.index, answer: ans }, (res) => {
          if (res && 'points' in res) obs.ackPointsLeak++;
          obs.acks.push(res);
        });
      }, answerDelayMs);
    };
    const onMatchEnd = payload => {
      clearTimeout(timer);
      client.socket.off('matchFound', onMatchFound);
      client.socket.off('question', onQuestion);
      client.socket.off('opponentProgress', onOppProgress);
      client.socket.off('matchEnd', onMatchEnd);
      obs.matchEnd = payload;
      resolve(obs);
    };

    client.socket.on('matchFound', onMatchFound);
    client.socket.on('question', onQuestion);
    client.socket.on('opponentProgress', onOppProgress);
    client.socket.on('matchEnd', onMatchEnd);
  });
}

function joinQueue(client, queue) {
  return new Promise((resolve, reject) => {
    client.socket.emit('joinQueue', { queue }, (res) => {
      if (!res || !res.ok) return reject(new Error(client.name + ': joinQueue failed: ' + (res && res.error)));
      resolve(res);
    });
  });
}

function toLobby(client) {
  return new Promise(resolve => client.socket.emit('toLobby', {}, resolve));
}

// ---------------------------------------------------------------------------
// Part 1 — rules unit checks
// ---------------------------------------------------------------------------
function unitChecks() {
  console.log('=== Rules unit checks ===');

  // Difficulty bands
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
  check(sawEasy && sawMedium, 'avg 1200-1499 mix actually uses both difficulties (60 draws)');
  const high = rules.difficultyPlanFor(1600);
  const counts = high.reduce((m, d) => (m[d] = (m[d] || 0) + 1, m), {});
  check(counts.easy === 1 && counts.medium === 1 && counts.hard === 3, 'avg >=1500 -> 1 easy + 1 medium + 3 hard');

  // Clock
  check(rules.clockSecondsFor(1000) === 300 && rules.clockSecondsFor(1499) === 300, 'clock 5:00 below avg 1500');
  check(rules.clockSecondsFor(1500) === 420 && rules.clockSecondsFor(1700) === 420, 'clock 7:00 at avg >=1500');

  // Stakes
  check(rules.stakeFor(1000, 1000) === 30, 'even match stake = 30');
  check(rules.stakeFor(1000, 1400) === 10, 'gap 400 -> stake 10');
  check(rules.stakeFor(1030, 970) === 27, 'gap 60 -> stake 27');
  check(rules.stakeFor(1000, 2000) === 2, 'huge gap clamps to minimum stake 2');
  check(rules.stakeFor(1400, 1000) === rules.stakeFor(1000, 1400), 'stake is symmetric in the gap');

  // Winner decision
  check(rules.decideWinner({ correctCount: 4, completionMs: 200000 }, { correctCount: 3, completionMs: 100 }) === 0,
    'more corrects wins regardless of time');
  check(rules.decideWinner({ correctCount: 3, completionMs: 90000 }, { correctCount: 3, completionMs: 80000 }) === 1,
    'tie on corrects -> lower completion time wins');
  check(rules.decideWinner({ correctCount: 3, completionMs: 90000 }, { correctCount: 3, completionMs: 90000 }) === -1,
    'equal corrects AND equal times -> draw');

  // Fraction-aware parsing (the flake root cause: parseFloat("14/3") === 14)
  check(Math.abs(rules.parseNumeric('14/3') - 4.666666) < 0.001, 'parseNumeric handles fractions ("14/3")');
  check(rules.parseNumeric('.5') === 0.5 && rules.parseNumeric('-3/4') === -0.75, 'parseNumeric handles ".5" and "-3/4"');
  check(Number.isNaN(rules.parseNumeric('abc')) && Number.isNaN(rules.parseNumeric('1/0')), 'parseNumeric rejects junk and /0');
  check(rules.gradeSpr('3/2, 1.5', '1.500') === true, 'gradeSpr accepts decimal form of a fraction answer');
  check(rules.gradeSpr('59/9, 6.555, 6.556', '6.556') === true, 'gradeSpr accepts truncated repeating decimal');
  check(rules.gradeSpr('42', '41') === false, 'gradeSpr rejects wrong values');

  // Bank-wide SPR regression sweep: the numeric variant this test submits must
  // grade correct for EVERY SPR in the bank (deterministic — no random draw).
  let sprTotal = 0, sprBad = 0;
  for (const [id, k] of Object.entries(ANSWER_KEY)) {
    if (k.type !== 'spr') continue;
    sprTotal++;
    if (!rules.gradeSpr(k.correct, numericVariant(k.correct))) {
      sprBad++;
      if (sprBad <= 5) console.error('   SPR would fail: ' + id + ' correct=' + JSON.stringify(k.correct) + ' submitted=' + numericVariant(k.correct));
    }
  }
  check(sprBad === 0, 'All ' + sprTotal + ' bank SPR answers grade correct in numeric format (flake regression)');
}

// ---------------------------------------------------------------------------
// Part 2 — live duels
// ---------------------------------------------------------------------------
async function runDuel(label, alice, bob, queue, expectedSection, opts) {
  console.log('\n=== ' + label + ' (' + queue + ') ===');
  const aPlay = playDuel(alice, opts.alice);
  const bPlay = playDuel(bob, opts.bob);
  await joinQueue(alice, queue);
  await joinQueue(bob, queue);
  const [aObs, bObs] = await Promise.all([aPlay, bPlay]);

  const mf = aObs.matchFound;
  check(mf && mf.opponent.name === bob.name && !mf.opponent.isBot, 'Alice matched against Bob (human)');
  check(bObs.matchFound && bObs.matchFound.opponent.name === alice.name, 'Bob matched against Alice');
  check(mf.section === expectedSection, 'Match section is ' + expectedSection);

  const expStake = rules.stakeFor(mf.you.rating, mf.opponent.rating);
  const expClock = rules.clockSecondsFor((mf.you.rating + mf.opponent.rating) / 2);
  check(mf.stake === expStake, 'matchFound advertises the stake ±' + expStake);
  check(mf.clockSeconds === expClock, 'matchFound advertises the match clock ' + expClock + 's');

  check(aObs.questions.length === 5 && bObs.questions.length === 5, 'Both clients received 5 questions');
  check(aObs.leakedFields === 0 && bObs.leakedFields === 0, 'No correct/rationale/suspect leaked pre-answer');
  check(aObs.questions.every(p => typeof p.clockRemainingMs === 'number' && p.clockRemainingMs > 0 && p.clockRemainingMs <= expClock * 1000),
    'Every question carries a sane server-authoritative clockRemainingMs');
  check(aObs.questions.every(p => !('softLimit' in p)), 'Per-question time limits are gone');
  check(aObs.opponentProgressEvents >= 5, 'Alice saw opponent progress events (' + aObs.opponentProgressEvents + ')');
  check(aObs.ackPointsLeak === 0 && bObs.ackPointsLeak === 0, 'Answer acks carry no points field');

  return { aObs, bObs, mf };
}

(async () => {
  console.log('Answer key source: ' + path.basename(keySource) + ' (' + Object.keys(ANSWER_KEY).length + ' questions)');
  unitChecks();

  const suffix = Math.floor(Math.random() * 100000);
  const alice = await connectClient('AutoAlice' + suffix);
  const bob = await connectClient('AutoBob' + suffix);
  console.log('\nConnected as: ' + alice.name + ' / ' + bob.name);
  check(alice.profile.ratings.ela === 1000 && alice.profile.ratings.math === 1000, 'Fresh profiles start at 1000');

  // --- Duel 1: ELA, win by corrects, all-easy band, stake ±30 ---
  const d1 = await runDuel('Duel 1 — win by corrects', alice, bob, 'ela', 'ela', {
    alice: { answerRight: true, answerDelayMs: 250, sprNumericFormat: true },
    bob: { answerRight: false, answerDelayMs: 450 },
  });
  if (usingRealBank) {
    check(d1.aObs.questions.every(p => p.question.difficulty === 'easy'),
      'Avg rating 1000 (<1200): all 5 questions are easy');
  } else {
    console.log('  skip  band assertion (sample bank too small for all-easy sets)');
  }
  check(d1.aObs.acks.every(r => r && r.ok && r.correct === true), 'All 5 Alice answers graded correct');
  check(d1.bObs.acks.every(r => r && r.ok && r.correct === false), 'All 5 Bob answers graded incorrect');
  const a1 = d1.aObs.matchEnd, b1 = d1.bObs.matchEnd;
  check(a1.outcome === 'win' && b1.outcome === 'loss', 'Alice won, Bob lost (by corrects)');
  check(a1.you.correctCount === 5 && a1.opponent.correctCount === 0, 'Corrects 5-0');
  check(typeof a1.you.completionMs === 'number' && a1.you.completionMs > 0 && a1.you.completionMs < 300000,
    'Completion time recorded (' + Math.round(a1.you.completionMs / 100) / 10 + 's)');
  check(a1.you.timedOut === false && a1.opponent.timedOut === false, 'Nobody timed out');
  check(a1.rating.stake === 30 && a1.rating.delta === 30 && b1.rating.delta === -30,
    'Stake ±30 applied: winner +30, loser -30');
  check(a1.rating.before === 1000 && a1.rating.after === 1030 && b1.rating.after === 970,
    'Ratings 1000 -> 1030 / 970');
  check(a1.questions.length === 5 && a1.questions.every(q => typeof q.correct === 'string'),
    'Post-match reveal includes correct answers');
  check(a1.questions.every(q => q.you.correct === true && q.opponent.correct === false),
    'Per-question breakdown shows both players');
  check(a1.forfeit === null, 'No forfeit recorded');
  await toLobby(alice); await toLobby(bob);

  // --- Duel 2: Math, SPR numeric-variant answers (fraction-aware fix) ---
  const d2 = await runDuel('Duel 2 — math incl. SPR', alice, bob, 'math-nocalc', 'math', {
    alice: { answerRight: true, answerDelayMs: 250, sprNumericFormat: true },
    bob: { answerRight: false, answerDelayMs: 450 },
  });
  check(d2.aObs.acks.every(r => r && r.ok && r.correct === true),
    'All 5 Alice math answers graded correct (SPR numeric variants incl.)');
  const a2 = d2.aObs.matchEnd, b2 = d2.bObs.matchEnd;
  check(a2.outcome === 'win' && a2.rating.stake === 30 && a2.rating.after === 1030 && b2.rating.after === 970,
    'Math ratings 1000 -> 1030 / 970 at stake 30');
  const sprSeen = d2.aObs.questions.filter(p => p.question.type === 'spr').length;
  console.log('  info  SPR questions drawn this math duel: ' + sprSeen);
  await toLobby(alice); await toLobby(bob);

  // --- Duel 3: ELA, equal corrects -> completion-time tiebreaker, gap-scaled stake ---
  const d3 = await runDuel('Duel 3 — time tiebreaker', alice, bob, 'ela', 'ela', {
    alice: { answerRight: true, answerDelayMs: 150, sprNumericFormat: true },
    bob: { answerRight: true, answerDelayMs: 900, sprNumericFormat: true },
  });
  const a3 = d3.aObs.matchEnd, b3 = d3.bObs.matchEnd;
  check(a3.you.correctCount === 5 && a3.opponent.correctCount === 5, 'Both players 5/5 correct');
  check(a3.you.completionMs < a3.opponent.completionMs, 'Alice completed faster than Bob');
  check(a3.outcome === 'win' && b3.outcome === 'loss', 'Tie on corrects resolved by completion time');
  const expStake3 = rules.stakeFor(a3.rating.before, b3.rating.before);
  check(a3.rating.before === 1030 && b3.rating.before === 970, 'Duel 3 started from 1030 vs 970');
  check(expStake3 === 27 && a3.rating.stake === 27 && a3.rating.delta === 27 && b3.rating.delta === -27,
    'Gap-scaled stake ±27 applied (gap 60)');
  await toLobby(alice); await toLobby(bob);

  // --- Persistence ---
  console.log('\n=== Persistence ===');
  const players = JSON.parse(fs.readFileSync(PLAYERS_JSON, 'utf8')).players;
  const aRec = players[alice.name.toLowerCase()];
  const bRec = players[bob.name.toLowerCase()];
  check(!!aRec && !!bRec, 'Both players persisted to players.json');
  check(aRec.ratings.ela === 1057 && bRec.ratings.ela === 943, 'ELA ratings persisted (1057 / 943)');
  check(aRec.ratings.math === 1030 && bRec.ratings.math === 970, 'Math ratings persisted (1030 / 970)');
  check(aRec.wins === 3 && bRec.losses === 3, 'Records persisted (Alice 3W, Bob 3L)');
  check(aRec.games.ela === 2 && aRec.games.math === 1, 'Per-section game counts persisted');

  alice.socket.disconnect();
  bob.socket.disconnect();

  console.log('\n' + (failures.length === 0
    ? 'ALL CHECKS PASSED'
    : failures.length + ' CHECK(S) FAILED:\n  - ' + failures.join('\n  - ')));
  process.exit(failures.length === 0 ? 0 : 1);
})().catch(err => {
  console.error('TEST ERROR:', err.message);
  process.exit(1);
});
