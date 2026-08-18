'use strict';
/**
 * RankedSat competitive rules — the authoritative implementation.
 * Plain-English spec: docs/GAME-RULES.md (keep the two in sync).
 *
 * Dependency-free on purpose: required by server.js at runtime AND by
 * test-duel.js directly, so there is exactly one copy of the banding, clock,
 * stake, winner, and SPR-grading logic.
 */

const QUESTIONS_PER_MATCH = 5;
const RATING_START = 1000;
const SPR_TOLERANCE = 0.001;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * Difficulty plan: an array of QUESTIONS_PER_MATCH difficulty strings, derived
 * from the AVERAGE of both players' section ratings at match start.
 *   avg < 1200      -> all easy
 *   1200 <= avg < 1500 -> each slot easy or medium (50/50 per slot)
 *   avg >= 1500     -> 1 easy + 1 medium + 3 hard
 */
function difficultyPlanFor(avgRating) {
  const plan = [];
  if (avgRating < 1200) {
    for (let i = 0; i < QUESTIONS_PER_MATCH; i++) plan.push('easy');
  } else if (avgRating < 1500) {
    for (let i = 0; i < QUESTIONS_PER_MATCH; i++) plan.push(Math.random() < 0.5 ? 'easy' : 'medium');
  } else {
    plan.push('easy', 'medium', 'hard', 'hard', 'hard');
  }
  return plan;
}

/** Match clock (seconds): 5:00 below avg 1500, 7:00 at or above. */
function clockSecondsFor(avgRating) {
  return avgRating < 1500 ? 300 : 420;
}

/**
 * Symmetric gap-scaled stake: X = clamp(round(30 - |gap| / 20), 2, 30).
 * Winner +X, loser -X, draw 0. Forfeit/disconnect = loss at the same stake.
 */
function stakeFor(ratingA, ratingB) {
  return clamp(Math.round(30 - Math.abs(ratingA - ratingB) / 20), 2, 30);
}

/**
 * Winner index (0/1) or -1 for a draw.
 * Most correct answers wins; tie -> lower completion time (ms from match start
 * to final answer; a timed-out player is charged the full clock); still tied -> draw.
 */
function decideWinner(a, b) {
  if (a.correctCount !== b.correctCount) return a.correctCount > b.correctCount ? 0 : 1;
  if (a.completionMs !== b.completionMs) return a.completionMs < b.completionMs ? 0 : 1;
  return -1;
}

/**
 * Parse a student-entered (or bank-authored) numeric string.
 * Accepts plain decimals ("4.5", ".47", "-3") and fractions ("14/3", "-1/2").
 * Returns NaN for anything else. NOTE: JavaScript's parseFloat must never be
 * used on these values — parseFloat("14/3") silently returns 14.
 */
function parseNumeric(s) {
  if (typeof s !== 'string') return NaN;
  const t = s.trim();
  const frac = t.match(/^([-+]?\d+(?:\.\d+)?)\s*\/\s*([-+]?\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = parseFloat(frac[2]);
    if (den === 0) return NaN;
    return parseFloat(frac[1]) / den;
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return parseFloat(t);
}

/**
 * Grade a student-produced response against the bank's `correct` field:
 * comma-separated acceptable answers; each accepted on exact case-insensitive
 * string match (covers fractions verbatim) OR numeric equality within
 * SPR_TOLERANCE (fraction-aware on both sides).
 */
function gradeSpr(correctField, given) {
  if (given == null) return false;
  const g = String(given).trim();
  if (!g) return false;
  const accepted = String(correctField).split(',').map(s => s.trim()).filter(Boolean);
  for (const acc of accepted) {
    if (g.toLowerCase() === acc.toLowerCase()) return true;
    const a = parseNumeric(acc);
    const n = parseNumeric(g);
    if (Number.isFinite(a) && Number.isFinite(n) && Math.abs(a - n) <= SPR_TOLERANCE) return true;
  }
  return false;
}

module.exports = {
  QUESTIONS_PER_MATCH,
  RATING_START,
  SPR_TOLERANCE,
  difficultyPlanFor,
  clockSecondsFor,
  stakeFor,
  decideWinner,
  parseNumeric,
  gradeSpr,
};
