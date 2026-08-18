'use strict';
/**
 * RankedSat — local test server (v0)
 *
 * Server-authoritative 1v1 duel engine. Rules (see docs/GAME-RULES.md and app/rules.js):
 *  - Holds all answer keys; clients NEVER receive `correct`/`rationale` before answering.
 *  - Timestamps served/answered server-side; client clocks are untrusted.
 *  - Difficulty is banded from the AVERAGE of both players' section ratings
 *    (no picker): <1200 all easy; 1200-1499 easy+medium mix; >=1500 1E+1M+3H.
 *  - ONE match-wide countdown clock per player (5:00 below avg 1500, 7:00 at/above).
 *    When a player's clock expires their unanswered questions count as wrong;
 *    the opponent keeps playing until their own clock/questions end.
 *  - Winner = most correct answers; tie -> lower completion time (timed-out player
 *    is charged the full clock); still tied -> draw.
 *  - Rating: symmetric gap-scaled stake X = clamp(round(30 - |gap|/20), 2, 30);
 *    winner +X, loser -X, draw 0. Separate ela/math ratings (math queues share one).
 *    Forfeit/disconnect = loss at the same stake. NOTE: bot matches are rated —
 *    TEST-ONLY behavior so a solo tester can watch ratings move.
 *  - Opponent presence = progress only (which question they're on), never live score.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const rules = require('./rules');
const { createStorage } = require('./storage');

// ---------------------------------------------------------------------------
// Paths & config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

// --- Read-only content (baked into the container image in production) -----
// RANKEDSAT_QUESTIONS env var overrides the question file (used by automated tests).
const QUESTIONS_PATH = process.env.RANKEDSAT_QUESTIONS
  ? path.resolve(process.env.RANKEDSAT_QUESTIONS)
  : path.join(DATA_DIR, 'questions.jsonl');
const SAMPLE_QUESTIONS_PATH = path.join(__dirname, 'sample-questions.jsonl');
const FIGURES_DIR = process.env.RANKEDSAT_FIGURES
  ? path.resolve(process.env.RANKEDSAT_FIGURES)
  : path.join(DATA_DIR, 'figures');

// --- Mutable state (points at a mounted volume in production) -------------
const STATE_DIR = process.env.RANKEDSAT_STATE_DIR
  ? path.resolve(process.env.RANKEDSAT_STATE_DIR)
  : DATA_DIR;
if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
const PLAYERS_PATH = path.join(STATE_DIR, 'players.json');

// --- Private beta gate (soft gate; unset = disabled = current behavior) ---
const ACCESS_CODE = process.env.RANKEDSAT_ACCESS_CODE || '';

const PORT = process.env.PORT || 3000;

const QUESTIONS_PER_MATCH = rules.QUESTIONS_PER_MATCH;

const QUEUE_DEFS = {
  'ela':         { section: 'ela',  label: 'ELA' },
  'math-desmos': { section: 'math', label: 'Math (Desmos)' },
  'math-nocalc': { section: 'math', label: 'Math (No Desmos)' },
};

const NEXT_QUESTION_DELAY_MS = 600; // small beat between lock and next question (micro-reveal)

const BOT_WAIT_MS = 10000;   // spawn a bot if no human opponent within 10s
const BOT_ACCURACY = 0.6;    // configurable bot accuracy
const BOT_NAME = 'Ghost Bot';
const BOT_RATING = 1000;

const DISCONNECT_GRACE_MS = 15000; // opponent disconnect -> forfeit after 15s

const RATING_START = rules.RATING_START;

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

function loadQuestions() {
  let src = QUESTIONS_PATH;
  let origin = process.env.RANKEDSAT_QUESTIONS ? QUESTIONS_PATH : 'data/questions.jsonl';
  if (!fs.existsSync(src)) {
    src = SAMPLE_QUESTIONS_PATH;
    origin = 'app/sample-questions.jsonl (fallback)';
  }
  const raw = fs.readFileSync(src, 'utf8');
  const questions = [];
  const seen = new Set();
  let bad = 0, filtered = 0;
  raw.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    let q;
    try { q = JSON.parse(t); } catch { bad++; return; }
    const hasStemImage = typeof q.stemImagePath === 'string' && q.stemImagePath.trim() !== '';
    if (!isValidQuestion(q, hasStemImage) || seen.has(q.id)) { bad++; return; }
    // Filter rules: suspect questions out; figure-required but no figure file out.
    // A stemImagePath cures both: the PDF-rendered image contains the full,
    // trustworthy question (stem + figure + choices), so the text holes that made
    // it "suspect" don't matter.
    if (!hasStemImage && (q.suspect === true || (q.hasFigure && !q.figurePath))) { filtered++; return; }
    if (hasStemImage && typeof q.stem !== 'string') q.stem = '';
    if (hasStemImage && q.type === 'mcq') {
      // Choice texts may be empty/missing for stem-image questions (the choices are
      // in the image). Normalize so downstream code always sees labeled choices.
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        q.choices = ['A', 'B', 'C', 'D'].map(l => ({ label: l, text: '' }));
      } else {
        q.choices = q.choices.map(c => ({
          label: String(c.label),
          text: typeof c.text === 'string' ? c.text : '',
        }));
      }
    }
    seen.add(q.id);
    questions.push(q);
  });
  return { questions, origin, bad, filtered };
}

function isValidQuestion(q, hasStemImage) {
  if (!q || typeof q !== 'object') return false;
  if (typeof q.id !== 'string' || !q.id) return false;
  if (q.section !== 'ela' && q.section !== 'math') return false;
  if (!['easy', 'medium', 'hard'].includes(q.difficulty)) return false;
  if (q.type !== 'mcq' && q.type !== 'spr') return false;
  if (typeof q.correct !== 'string' || !q.correct) return false;
  // Stem text is required unless the question ships as a rendered image.
  if (!hasStemImage && (typeof q.stem !== 'string' || !q.stem)) return false;
  if (q.type === 'mcq' && !hasStemImage) {
    if (!Array.isArray(q.choices) || q.choices.length < 2) return false;
    if (!q.choices.every(c => c && typeof c.label === 'string' && typeof c.text === 'string')) return false;
  }
  if (q.type === 'mcq' && hasStemImage && Array.isArray(q.choices)) {
    if (!q.choices.every(c => c && c.label != null)) return false;
  }
  return true;
}

/** What the client may see BEFORE answering. Never correct/rationale/suspect. */
function publicQuestion(q) {
  const stemImage = stemImageUrl(q);
  // Per-choice notation art (see scripts/mathcrop.py). Only present for
  // choices whose text did not survive PDF extraction; carries no answer key.
  const choiceImages = q.choiceImages && typeof q.choiceImages === 'object'
    ? Object.fromEntries(Object.entries(q.choiceImages)
      .filter(([, p]) => typeof p === 'string' && p.trim())
      .map(([k, p]) => [k, figuresRouteUrl(p)]))
    : null;
  return {
    id: q.id,
    section: q.section,
    domain: q.domain || '',
    skill: q.skill || '',
    difficulty: q.difficulty,
    type: q.type,
    passage: q.passage || null,
    // The stem image is now a tight crop of the stem alone, so the prose that
    // DID extract is still worth sending alongside it.
    stem: q.stem || '',
    choices: q.type === 'mcq' ? q.choices.map(c => ({ label: c.label, text: c.text })) : null,
    choiceImages,
    hasFigure: !!q.hasFigure,
    figureUrl: stemImage ? null : figureUrl(q),
    stemImageUrl: stemImage,
  };
}

/** Normalize a path from the jsonl into a URL under the /figures static route. */
function figuresRouteUrl(rawPath) {
  if (!rawPath) return null;
  let p = String(rawPath).replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.startsWith('data/')) p = p.slice(5);
  if (p.startsWith('figures/')) p = p.slice(8);
  return '/figures/' + p;
}

function figureUrl(q) {
  if (!q.hasFigure || !q.figurePath) return null;
  return figuresRouteUrl(q.figurePath);
}

function stemImageUrl(q) {
  if (typeof q.stemImagePath !== 'string' || q.stemImagePath.trim() === '') return null;
  return figuresRouteUrl(q.stemImagePath);
}

/** Rendered rationale. NEVER include this in publicQuestion — it shows the working. */
function rationaleImageUrl(q) {
  if (typeof q.rationaleImagePath !== 'string' || q.rationaleImagePath.trim() === '') return null;
  return figuresRouteUrl(q.rationaleImagePath);
}

/**
 * Pick a match set following a difficulty plan (array of difficulty strings from
 * rules.difficultyPlanFor). Falls back to any question in the section when a
 * difficulty runs dry (only relevant for tiny banks like the bundled sample).
 * Final order is shuffled so band composition never telegraphs question order.
 */
function pickQuestions(section, plan, excludeIds = new Set()) {
  const inSection = BANK.questions.filter(q => q.section === section);
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
    if (!q) break; // section exhausted entirely
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

// ---------------------------------------------------------------------------
// Solo study (practice / timed module / full mock) — server-side helpers
// ---------------------------------------------------------------------------

/**
 * Bluebook module shape. The digital SAT runs each section as two modules;
 * Module 2's difficulty is routed by Module 1 performance.
 * These counts/timings mirror the public test specification.
 */
const SAT_MODULE = {
  ela: { count: 27, minutes: 32, label: 'Reading & Writing' },
  math: { count: 22, minutes: 35, label: 'Math' },
};
/** Fraction of Module 1 correct needed to route into the harder Module 2. */
const UPPER_TIER_CUTOFF = 0.6;

let _newestBatch;
function newestBatch() {
  if (_newestBatch === undefined) {
    _newestBatch = BANK.questions.reduce((m, q) => (q.batch && q.batch > m ? q.batch : m), '');
  }
  return _newestBatch;
}

// ---------------------------------------------------------------------------
// "Hell" — the hardest questions in the bank, by our own reckoning.
//
// College Board publishes only three difficulty tiers, so ranking WITHIN
// 'hard' is a judgement call, not their data. Say so plainly rather than
// implying an authority that does not exist. The signals, by weight:
//
//   grid-in (+45)      no choices to eliminate, no working backwards from
//                      the options, and no partial credit for a good guess.
//   rationale length   the official explanation is a decent proxy for how
//   (up to +40)        many reasoning steps a question actually takes.
//   figure/table (+15) something to interpret before the maths even starts.
//   stem length        more to parse before you can begin.
//   (up to +15)
//
// Deliberately spans BOTH sections — "hardest in the entire question bank"
// should not quietly mean "hardest in whichever section you picked".
// ---------------------------------------------------------------------------
const HELL_SIZE = 100;
let _hell = null;

function hellScore(q) {
  if (q.difficulty !== 'hard') return -1;
  let score = 0;
  if (q.type === 'spr') score += 45;
  score += Math.min(40, (q.rationale || '').length / 60);
  if (q.hasFigure) score += 15;
  score += Math.min(15, (q.stem || '').length / 40);
  return score;
}

/**
 * Top HELL_SIZE ids, computed once from the loaded bank.
 *
 * Ranked WITHIN each section, half from each. A single global ranking was
 * tried first and came out 98% maths, because the grid-in bonus can only ever
 * apply to maths — so "hardest in the whole bank" quietly meant "hardest
 * maths grid-ins" and you would never see a hard inference question. Splitting
 * the quota keeps the name honest.
 */
function hellSet() {
  if (!_hell) {
    const pick = (section) => BANK.questions
      .filter(q => q.section === section)
      .map(q => ({ q, score: hellScore(q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.floor(HELL_SIZE / 2))
      .map(x => x.q.id);
    _hell = [...pick('math'), ...pick('ela')];
  }
  return _hell;
}

/** Every question matching the session's filters. */
function soloPool(s) {
  // Hell ignores section and type: it is one fixed list of the worst the
  // bank has to offer, drawn from everywhere.
  if (s.filters.difficulty === 'hell') {
    const ids = new Set(hellSet());
    return BANK.questions.filter(q => ids.has(q.id));
  }
  return soloPoolFiltered(s);
}

function soloPoolFiltered(s) {
  const f = s.filters;
  const newest = newestBatch();
  return BANK.questions.filter(q =>
    q.section === s.section &&
    (f.difficulty === 'mixed' || q.difficulty === f.difficulty) &&
    (f.type === 'any' || q.type === f.type) &&
    (f.domain === 'any' || q.domain === f.domain) &&
    (f.age === 'any'
      || (f.age === 'new' ? q.batch === newest : q.batch !== newest)));
}

/**
 * Domains actually present in the loaded bank, with counts, per section.
 * Derived from the bank rather than hardcoded so it cannot drift when
 * College Board revises the taxonomy in a future export.
 */
let _domainMeta = null;
function domainMeta() {
  if (!_domainMeta) {
    const acc = { ela: new Map(), math: new Map() };
    for (const q of BANK.questions) {
      const m = acc[q.section];
      if (!m || !q.domain) continue;
      const e = m.get(q.domain) || { domain: q.domain, count: 0, skills: new Set() };
      e.count++;
      if (q.skill) e.skills.add(q.skill);
      m.set(q.domain, e);
    }
    const shape = (m) => [...m.values()]
      .sort((a, b) => b.count - a.count)
      .map(e => ({ domain: e.domain, count: e.count, skills: [...e.skills].sort() }));
    _domainMeta = { ela: shape(acc.ela), math: shape(acc.math) };
  }
  return _domainMeta;
}

function soloServeOne(s) {
  const pool = soloPool(s);
  const fresh = pool.filter(q => !s.served.has(q.id));
  // Practice is endless: once the filtered pool is exhausted, recycle rather
  // than dead-end the session. Only leaving ends it.
  const usable = fresh.length ? fresh : pool;
  if (!fresh.length) { s.served.clear(); s.recycled++; }
  const q = usable[Math.floor(Math.random() * usable.length)];
  s.served.add(q.id);
  s.current = q;
  s.answeredCurrent = false;
  s.servedAt = Date.now();
}

/**
 * Session analytics. Computed here because the server holds the question
 * metadata (domain / skill / difficulty) that the client is never sent.
 * Buckets are sorted weakest-first so the thing to work on is at the top.
 */
function soloStats(s) {
  const log = s.log || [];
  const bucket = (keyOf) => {
    const m = new Map();
    for (const r of log) {
      const k = keyOf(r) || '—';
      const e = m.get(k) || { key: k, seen: 0, correct: 0 };
      e.seen++;
      if (r.correct) e.correct++;
      m.set(k, e);
    }
    return [...m.values()]
      .map(e => ({ ...e, pct: Math.round((e.correct / e.seen) * 100) }))
      .sort((a, b) => a.pct - b.pct || b.seen - a.seen);
  };

  let streak = 0;
  let best = 0;
  for (const r of log) {
    if (r.correct) { streak++; if (streak > best) best = streak; } else streak = 0;
  }
  // Times over 15 min are someone walking away mid-question, not thinking
  // time; they would wreck the mean, so they are excluded from every stat.
  const OUTLIER_MS = 15 * 60 * 1000;
  const timed = log.filter(r => r.ms > 0 && r.ms < OUTLIER_MS);
  const times = timed.map(r => r.ms).sort((a, b) => a - b);
  const mean = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const median = (arr) => {
    if (!arr.length) return 0;
    const m = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[m] : Math.round((arr[m - 1] + arr[m]) / 2);
  };
  const pctile = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
  const rightT = timed.filter(r => r.correct).map(r => r.ms).sort((a, b) => a - b);
  const wrongT = timed.filter(r => !r.correct).map(r => r.ms).sort((a, b) => a - b);

  const timing = {
    n: times.length,
    mean: mean(times),
    median: median(times),
    fastest: times[0] || 0,
    slowest: times[times.length - 1] || 0,
    p25: pctile(times, 0.25),
    p75: pctile(times, 0.75),
    totalMs: times.reduce((a, b) => a + b, 0),
    // the interesting one: are the misses the slow ones?
    meanCorrect: mean(rightT),
    medianCorrect: median(rightT),
    meanIncorrect: mean(wrongT),
    medianIncorrect: median(wrongT),
    outliersExcluded: log.filter(r => r.ms >= OUTLIER_MS).length,
    byDifficulty: ['easy', 'medium', 'hard'].map((d) => {
      const t = timed.filter(r => r.difficulty === d).map(r => r.ms).sort((a, b) => a - b);
      return { key: d, n: t.length, mean: mean(t), median: median(t) };
    }).filter(x => x.n > 0),
  };

  const avgMs = timing.mean;
  const correct = log.filter(r => r.correct).length;

  const byDomain = bucket(r => r.domain);
  const bySkill = bucket(r => r.skill);
  // "Struggled with" needs enough attempts to mean anything.
  const weakSkill = bySkill.find(x => x.seen >= 3 && x.pct < 100) || null;
  const weakDomain = byDomain.find(x => x.seen >= 3 && x.pct < 100) || null;

  return {
    seen: log.length,
    correct,
    accuracy: log.length ? Math.round((correct / log.length) * 100) : null,
    streak,
    bestStreak: best,
    avgMs,
    timing,
    byDifficulty: bucket(r => r.difficulty),
    byDomain,
    bySkill: bySkill.slice(0, 12),
    byType: bucket(r => (r.type === 'spr' ? 'grid-in' : 'multiple choice')),
    recent: log.slice(-24).map(r => r.correct),
    weakSkill,
    weakDomain,
    recycled: s.recycled || 0,
  };
}

/**
 * Difficulty spread for a module. Module 1 is broadly mixed; Module 2 skews
 * hard ("upper") or easy ("lower") depending on the routing decision.
 */
function moduleDifficultyPlan(n, tier) {
  const mix = tier === 'upper' ? [0.10, 0.30, 0.60]
    : tier === 'lower' ? [0.60, 0.30, 0.10]
      : [0.34, 0.33, 0.33];
  const names = ['easy', 'medium', 'hard'];
  const plan = [];
  names.forEach((name, i) => {
    const k = i === names.length - 1 ? n - plan.length : Math.round(n * mix[i]);
    for (let j = 0; j < k; j++) plan.push(name);
  });
  return shuffle(plan.slice(0, n));
}

/**
 * The candidate pool for a module.
 *
 * A module's SHAPE owns difficulty and type — that is the whole point of
 * mimicking Bluebook — so the practice difficulty/type filters are ignored
 * here. Content age is not about shape, so it still applies.
 */
function soloModulePool(s, section) {
  const newest = newestBatch();
  const age = s.filters.age;
  return BANK.questions.filter(q =>
    q.section === section &&
    (age === 'any' || (age === 'new' ? q.batch === newest : q.batch !== newest)));
}

/**
 * Draw one module. Freshly shuffled on every call, so two modules — or two
 * mock exams — never come out the same. `s.served` carries across the whole
 * session, so a mock cannot repeat a question between its four modules.
 */
function soloDrawModule(s, section, plan) {
  const pool = soloModulePool(s, section);
  const fresh = pool.filter(q => !s.served.has(q.id));
  // Only fall back to the full pool if honouring "unseen" would short the
  // module; a short module is worse than a repeat across sessions.
  const usable = fresh.length >= plan.length ? fresh : pool;

  const byDiff = { easy: [], medium: [], hard: [] };
  usable.forEach(q => { if (byDiff[q.difficulty]) byDiff[q.difficulty].push(q); });
  Object.values(byDiff).forEach(shuffle);

  const chosen = [];
  const used = new Set();
  for (const d of plan) {
    let q = (byDiff[d] || []).find(x => !used.has(x.id));
    if (!q) {
      // that band is dry — take any unused question so the module stays full
      const rest = usable.filter(x => !used.has(x.id));
      q = rest[Math.floor(Math.random() * rest.length)];
    }
    if (!q) break;
    used.add(q.id);
    chosen.push(q);
  }
  return shuffle(chosen);
}

/** Build and start the module at s.plan[s.planIdx]. Returns an error string or null. */
function soloBeginModule(s) {
  const step = s.plan[s.planIdx];
  const spec = SAT_MODULE[step.section];
  const tier = step.module === 2 ? (step.tier || 'upper') : null;

  if (!soloModulePool(s, step.section).length) return 'No questions available for that module.';

  const plan = moduleDifficultyPlan(spec.count, tier);
  const chosen = soloDrawModule(s, step.section, plan);
  if (chosen.length < spec.count) {
    return `Only ${chosen.length} of ${spec.count} questions available for that module.`;
  }
  chosen.forEach(q => s.served.add(q.id));

  s.section = step.section;
  s.queue = chosen;
  s.idx = 0;
  s.answers = [];
  s.current = chosen[0];
  s.answeredCurrent = false;
  s.done = false;
  s.report = null;
  s.endsAt = Date.now() + spec.minutes * 60 * 1000;
  s.moduleLabel = `${spec.label} · Module ${step.module}${tier ? ` (${tier})` : ''}`;
  return null;
}

function soloTimeLeft(s) {
  return s.endsAt ? Math.max(0, s.endsAt - Date.now()) : 0;
}

/**
 * Close the current module: build its report (answers ARE revealed here — the
 * module is over) and, in a mock, route the next Module 2 by performance.
 */
function soloFinishModule(s) {
  s.done = true;
  s.current = null;
  const answered = s.answers.length;
  const correct = s.answers.filter(a => a.correct).length;
  const byId = new Map(s.queue.map(q => [q.id, q]));

  s.report = {
    label: s.moduleLabel,
    correct,
    answered,
    total: s.queue.length,
    unanswered: s.queue.length - answered,
    review: s.answers.map(a => {
      const q = byId.get(a.id);
      return {
        id: a.id,
        correct: a.correct,
        yourAnswer: a.answer == null ? null : String(a.answer),
        correctAnswer: q.correct,
        difficulty: q.difficulty,
        domain: q.domain || '',
        skill: q.skill || '',
        rationale: q.rationale || '',
        rationaleImageUrl: rationaleImageUrl(q),
      };
    }),
  };
  s.results.push({ label: s.moduleLabel, correct, total: s.queue.length });

  // Adaptive routing: a mock's next Module 2 follows this Module 1's score.
  const step = s.plan[s.planIdx];
  const next = s.plan[s.planIdx + 1];
  if (step && step.module === 1 && next && next.module === 2 && next.section === step.section) {
    const ratio = s.queue.length ? correct / s.queue.length : 0;
    next.tier = ratio >= UPPER_TIER_CUTOFF ? 'upper' : 'lower';
  }
}

// ---------------------------------------------------------------------------
// Practice session history
//
// Solo sessions live on the socket, so they used to vanish on disconnect.
// Finished sessions are summarised to STATE_DIR/sessions.json, keyed by the
// same lowercased player name profiles use. Summaries only — never the
// question ids or answers, so this file can't become an answer key.
// ---------------------------------------------------------------------------
const SESSIONS_PATH = path.join(STATE_DIR, 'sessions.json');
const MAX_SESSIONS_PER_PLAYER = 200;
let SESSIONS = {};

try {
  if (fs.existsSync(SESSIONS_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object') SESSIONS = parsed;
  }
} catch (err) {
  console.warn('[sessions] unreadable, starting fresh:', err.message);
  SESSIONS = {};
}

let sessionsDirty = false;
function saveSessions() {
  if (!sessionsDirty) return;
  sessionsDirty = false;
  try {
    const tmp = SESSIONS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(SESSIONS));
    fs.renameSync(tmp, SESSIONS_PATH);
  } catch (err) {
    console.error('[sessions] save failed:', err.message);
  }
}
// Batched: a burst of endings shouldn't mean a burst of disk writes.
setInterval(saveSessions, 4000).unref();

/** Fold a finished solo session into the player's history. */
function recordSession(name, s) {
  if (!name || !s || !s.log || s.log.length === 0) return null;
  const key = String(name).toLowerCase();
  const st = soloStats(s);
  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    at: Date.now(),
    mode: s.mode,
    section: s.section,
    filters: s.filters,
    feedback: s.feedback,
    seen: st.seen,
    correct: st.correct,
    accuracy: st.accuracy,
    bestStreak: st.bestStreak,
    timing: {
      mean: st.timing.mean, median: st.timing.median,
      fastest: st.timing.fastest, slowest: st.timing.slowest,
      totalMs: st.timing.totalMs,
    },
    byDifficulty: st.byDifficulty,
    byDomain: st.byDomain,
    bySkill: st.bySkill.slice(0, 8),
    weakSkill: st.weakSkill,
    results: s.results && s.results.length ? s.results : null,
  };
  const list = SESSIONS[key] || [];
  list.unshift(entry);
  SESSIONS[key] = list.slice(0, MAX_SESSIONS_PER_PLAYER);
  sessionsDirty = true;
  return entry;
}

function historyFor(name) {
  return SESSIONS[String(name || '').toLowerCase()] || [];
}

/** One shape for every solo response; the client renders straight from it. */
function soloState(s) {
  return {
    mode: s.mode,
    section: s.section,
    filters: s.filters,
    feedback: s.feedback,
    question: s.current ? publicQuestion(s.current) : null,
    seen: s.seen,
    correct: s.correct,
    // module / mock only
    moduleLabel: s.moduleLabel || null,
    idx: s.queue ? s.idx : null,
    total: s.queue ? s.queue.length : null,
    msLeft: s.queue && !s.done ? soloTimeLeft(s) : null,
    done: !!s.done,
    report: s.report,
    planIdx: s.plan ? s.planIdx : null,
    planTotal: s.plan ? s.plan.length : null,
    results: s.results,
    examOver: !!(s.plan && s.done && s.planIdx >= s.plan.length - 1),
    stats: soloStats(s),
  };
}

// ---------------------------------------------------------------------------
// Grading (server-side only; SPR logic shared with tests via rules.js)
// ---------------------------------------------------------------------------

function grade(q, rawAnswer) {
  if (rawAnswer == null) return false;
  const given = String(rawAnswer).trim();
  if (!given) return false;
  if (q.type === 'mcq') {
    return given.toUpperCase() === q.correct.trim().toUpperCase();
  }
  return rules.gradeSpr(q.correct, given);
}

// ---------------------------------------------------------------------------
// Player profiles (pluggable storage — local data/players.json by default,
// Firestore when FIREBASE_SERVICE_ACCOUNT or FIRESTORE_EMULATOR_HOST is set;
// see storage.js)
// ---------------------------------------------------------------------------

let PLAYERS = { players: {} };
const storage = createStorage(PLAYERS_PATH);

/** Write-through save. `touchedKeys` (lowercased player keys) lets the
 * Firestore backend write only the docs that actually changed; the local
 * backend ignores it and always rewrites the whole file (unchanged behavior). */
function savePlayers(touchedKeys) {
  storage.save(PLAYERS.players, touchedKeys);
}

function sanitizeName(raw) {
  let n = String(raw || '').replace(/[<>&\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length > 20) n = n.slice(0, 20).trim();
  return n || 'Player';
}

function profileFor(name) {
  const key = name.toLowerCase();
  if (!PLAYERS.players[key]) {
    PLAYERS.players[key] = {
      name,
      ratings: { ela: RATING_START, math: RATING_START },
      games: { ela: 0, math: 0 },
      wins: 0, losses: 0, draws: 0,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
  }
  return PLAYERS.players[key];
}

function publicProfile(p) {
  return { name: p.name, ratings: p.ratings, games: p.games, wins: p.wins, losses: p.losses, draws: p.draws };
}

// ---------------------------------------------------------------------------
// Matchmaking & match engine
// ---------------------------------------------------------------------------

const queues = new Map();  // queue name -> [{ socket, botTimer }]
const matches = new Map(); // matchId -> match
const activeNames = new Map(); // lowercased display name -> socket.id (unique while connected)

function removeFromQueue(socket) {
  const key = socket.data.queueKey;
  if (!key) return;
  const list = queues.get(key) || [];
  const idx = list.findIndex(e => e.socket === socket);
  if (idx !== -1) {
    clearTimeout(list[idx].botTimer);
    list.splice(idx, 1);
  }
  socket.data.queueKey = null;
}

function newHumanPlayer(socket) {
  return {
    kind: 'human',
    socket,
    name: socket.data.name,
    profile: profileFor(socket.data.name),
    connected: true,
    qIndex: 0,
    answers: [],
    servedAt: 0,
    finished: false,
    timedOut: false,
    completionMs: null,   // ms from match start to final answer (full clock if timed out)
    pendingTimer: null,   // bot answer timer (humans: unused)
    clockTimer: null,     // match-clock expiry timer
    leftResults: false,
  };
}

function newBotPlayer() {
  return {
    kind: 'bot',
    socket: null,
    name: BOT_NAME,
    profile: null,
    connected: true,
    qIndex: 0,
    answers: [],
    servedAt: 0,
    finished: false,
    timedOut: false,
    completionMs: null,
    pendingTimer: null,
    clockTimer: null,
    leftResults: false,
  };
}

function createMatch(queue, playerA, playerB, excludeIds = new Set()) {
  const def = QUEUE_DEFS[queue];
  const section = def.section;
  const players = [playerA, playerB];
  const ratings = players.map(p => p.kind === 'bot' ? BOT_RATING : p.profile.ratings[section]);
  const avg = (ratings[0] + ratings[1]) / 2;
  const clockSeconds = rules.clockSecondsFor(avg);
  const stake = rules.stakeFor(ratings[0], ratings[1]);

  const match = {
    id: crypto.randomUUID(),
    queue,
    section,
    clockMs: clockSeconds * 1000,
    stake,
    questions: pickQuestions(section, rules.difficultyPlanFor(avg), excludeIds),
    players,
    state: 'active',
    startAt: 0, // set when Q1 is served (the clock starts then)
    forfeitTimer: null,
    rematchVotes: new Set(),
    createdAt: Date.now(),
  };
  matches.set(match.id, match);

  for (let i = 0; i < 2; i++) {
    const p = match.players[i];
    const opp = match.players[1 - i];
    if (p.kind === 'human') {
      p.socket.data.matchId = match.id;
      p.socket.data.playerIdx = i;
      p.socket.emit('matchFound', {
        matchId: match.id,
        queue,
        queueLabel: def.label,
        section,
        totalQuestions: match.questions.length,
        clockSeconds,
        stake, // "This match is worth ±stake"
        desmos: queue === 'math-desmos',
        opponent: {
          name: opp.name,
          isBot: opp.kind === 'bot',
          rating: ratings[1 - i],
        },
        you: { name: p.name, rating: ratings[i] },
      });
    }
  }

  // Serve Q1 to both after a short "get ready" beat; the match clock starts here.
  setTimeout(() => {
    if (match.state !== 'active') return;
    match.startAt = Date.now();
    match.players.forEach(p => {
      p.clockTimer = setTimeout(() => expireClock(match, p), match.clockMs);
      serveQuestion(match, p);
    });
  }, 1500);
  return match;
}

function clockRemainingMs(match) {
  if (!match.startAt) return match.clockMs;
  return Math.max(0, match.startAt + match.clockMs - Date.now());
}

function serveQuestion(match, p) {
  if (match.state !== 'active' || p.finished) return;
  const q = match.questions[p.qIndex];
  p.servedAt = Date.now();
  clearTimeout(p.pendingTimer);
  p.pendingTimer = null;
  if (p.kind === 'human') {
    if (!p.connected) return; // disconnected player: forfeit timer is already running
    p.socket.emit('question', {
      index: p.qIndex,
      total: match.questions.length,
      clockRemainingMs: clockRemainingMs(match), // server-authoritative resync each question
      question: publicQuestion(q),
    });
    // No per-question timer: the match clock (expireClock) is the only cutoff.
  } else {
    // Bot: human-ish pace within the clock, ~BOT_ACCURACY chance of a correct answer.
    p.pendingTimer = setTimeout(() => {
      if (match.state !== 'active') return;
      recordAnswer(match, p, p.qIndex, botAnswer(q));
    }, botDelayMs(match.clockMs));
  }
}

/**
 * A player's match clock ran out: every unanswered question counts as wrong,
 * their completion time is the full clock, and the opponent keeps playing.
 */
function expireClock(match, p) {
  if (match.state !== 'active' || p.finished) return;
  clearTimeout(p.pendingTimer);
  p.pendingTimer = null;
  for (let i = p.qIndex; i < match.questions.length; i++) {
    if (!p.answers[i]) p.answers[i] = { answer: null, correct: false, timeMs: null, expired: true };
  }
  p.qIndex = match.questions.length;
  p.finished = true;
  p.timedOut = true;
  p.completionMs = match.clockMs;
  if (p.kind === 'human' && p.connected) p.socket.emit('clockExpired', {});

  const opp = match.players[match.players[0] === p ? 1 : 0];
  if (opp.kind === 'human' && opp.connected) {
    opp.socket.emit('opponentProgress', { completed: p.qIndex, total: match.questions.length });
  }
  if (match.players.every(pl => pl.finished)) {
    setTimeout(() => endMatch(match), NEXT_QUESTION_DELAY_MS);
  }
}

function botDelayMs(clockMs) {
  // 30-80% of the per-question clock budget, uniformly: finishes comfortably
  // within the clock while feeling human-paced.
  const budget = clockMs / QUESTIONS_PER_MATCH;
  return Math.floor(budget * (0.3 + Math.random() * 0.5));
}

function botAnswer(q) {
  const beRight = Math.random() < BOT_ACCURACY;
  if (q.type === 'mcq') {
    if (beRight) return q.correct;
    const wrong = q.choices.map(c => c.label).filter(l => l.toUpperCase() !== q.correct.toUpperCase());
    return wrong[Math.floor(Math.random() * wrong.length)] || q.correct;
  }
  if (beRight) return q.correct.split(',')[0].trim();
  const n = rules.parseNumeric(q.correct.split(',')[0].trim());
  return Number.isFinite(n) ? String(n + 1 + Math.floor(Math.random() * 5)) : '0';
}

/** Record an answer for player p (right or wrong is the only way to advance). */
function recordAnswer(match, p, index, rawAnswer) {
  if (match.state !== 'active') return null;
  if (p.finished || index !== p.qIndex || p.answers[index]) return null;
  clearTimeout(p.pendingTimer);
  p.pendingTimer = null;

  const q = match.questions[index];
  const timeMs = Date.now() - p.servedAt; // per-question time, shown in review only
  const correct = grade(q, rawAnswer);
  p.answers[index] = {
    answer: rawAnswer == null ? null : String(rawAnswer),
    correct, timeMs,
  };
  p.qIndex++;

  // Opponent presence: progress only, never correctness/score.
  const opp = match.players[match.players[0] === p ? 1 : 0];
  if (opp.kind === 'human' && opp.connected) {
    opp.socket.emit('opponentProgress', { completed: p.qIndex, total: match.questions.length });
  }

  if (p.qIndex >= match.questions.length) {
    p.finished = true;
    p.completionMs = Date.now() - match.startAt; // match start -> final answer
    clearTimeout(p.clockTimer);
    p.clockTimer = null;
    if (match.players.every(pl => pl.finished)) {
      setTimeout(() => endMatch(match), NEXT_QUESTION_DELAY_MS);
    }
  } else {
    setTimeout(() => serveQuestion(match, p), NEXT_QUESTION_DELAY_MS);
  }
  return { correct };
}

/** Match-level summary for a player: corrects + completion time (rules.decideWinner input). */
function playerTotals(p, match) {
  let correctCount = 0;
  for (let i = 0; i < match.questions.length; i++) {
    const a = p.answers[i];
    if (a && a.correct) correctCount++;
  }
  return { correctCount, completionMs: p.completionMs, timedOut: p.timedOut };
}

function clearMatchTimers(match) {
  match.players.forEach(p => {
    clearTimeout(p.pendingTimer); p.pendingTimer = null;
    clearTimeout(p.clockTimer); p.clockTimer = null;
  });
  clearTimeout(match.forfeitTimer);
  match.forfeitTimer = null;
}

/**
 * End a match. opts.forfeitLoser = player index that forfeited (disconnect/abandon).
 */
function endMatch(match, opts = {}) {
  if (match.state !== 'active') return;
  match.state = 'ended';
  clearMatchTimers(match);

  const [a, b] = match.players;
  const totals = [playerTotals(a, match), playerTotals(b, match)];

  let winnerIdx;
  let forfeit = null;
  if (typeof opts.forfeitLoser === 'number') {
    // Forfeit/disconnect = loss at the same stake.
    winnerIdx = 1 - opts.forfeitLoser;
    forfeit = { loser: opts.forfeitLoser, reason: opts.reason || 'disconnect' };
  } else {
    winnerIdx = rules.decideWinner(totals[0], totals[1]);
  }

  // --- Rating: symmetric gap-scaled stake (per section; math queues share). ---
  // Winner +X, loser -X, draw 0 (X fixed at match start from both ratings).
  // TEST-ONLY: bot matches count toward rating so solo testing moves the ladder.
  const section = match.section;
  const stake = match.stake;
  const before = match.players.map(p => p.kind === 'bot' ? BOT_RATING : p.profile.ratings[section]);
  const deltas = [0, 0];
  if (winnerIdx !== -1) {
    deltas[winnerIdx] = stake;
    deltas[1 - winnerIdx] = -stake;
  }
  const after = [before[0] + deltas[0], before[1] + deltas[1]];

  const touchedKeys = [];
  match.players.forEach((p, i) => {
    if (p.kind !== 'human') return;
    p.profile.ratings[section] = after[i];
    p.profile.games[section]++;
    if (winnerIdx === -1) p.profile.draws++;
    else if (winnerIdx === i) p.profile.wins++;
    else p.profile.losses++;
    p.profile.lastSeen = new Date().toISOString();
    touchedKeys.push(p.name.toLowerCase());
  });
  savePlayers(touchedKeys);

  // --- Full reveal payload (correct answers + rationales only now). ---
  const questionsReveal = match.questions.map((q, i) => ({
    index: i,
    id: q.id,
    section: q.section,
    domain: q.domain || '',
    skill: q.skill || '',
    difficulty: q.difficulty,
    type: q.type,
    passage: stemImageUrl(q) ? null : (q.passage || null),
    stem: stemImageUrl(q) ? '' : q.stem,
    choices: q.type === 'mcq' ? q.choices.map(c => ({ label: c.label, text: c.text })) : null,
    figureUrl: stemImageUrl(q) ? null : figureUrl(q),
    stemImageUrl: stemImageUrl(q),
    correct: q.correct,
    rationale: q.rationale || null,
    results: [0, 1].map(pi => {
      const ans = match.players[pi].answers[i] || null;
      return ans
        ? { answer: ans.answer, correct: ans.correct, timeMs: ans.timeMs }
        : { answer: null, correct: false, timeMs: null };
    }),
  }));

  match.players.forEach((p, i) => {
    if (p.kind !== 'human' || !p.connected) return;
    const oi = 1 - i;
    const outcome = winnerIdx === -1 ? 'draw' : (winnerIdx === i ? 'win' : 'loss');
    p.socket.emit('matchEnd', {
      matchId: match.id,
      outcome,
      forfeit: forfeit ? { youForfeited: forfeit.loser === i, reason: forfeit.reason } : null,
      section,
      queue: match.queue,
      clockSeconds: match.clockMs / 1000,
      you: { name: p.name, ...totals[i] },
      opponent: { name: match.players[oi].name, isBot: match.players[oi].kind === 'bot', ...totals[oi] },
      rating: {
        section,
        stake,
        before: before[i], after: after[i], delta: deltas[i],
        opponentBefore: before[oi], opponentAfter: after[oi], opponentDelta: deltas[oi],
        opponentIsBot: match.players[oi].kind === 'bot',
      },
      questions: questionsReveal.map(q => ({
        ...q,
        you: q.results[i],
        opponent: q.results[oi],
        results: undefined,
      })),
      rematchAvailable: match.players[oi].kind === 'bot' || match.players[oi].connected,
    });
    p.socket.emit('profile', publicProfile(p.profile));
  });

  cleanupIfAbandoned(match);
}

/** Drop ended matches nobody is looking at anymore. */
function cleanupIfAbandoned(match) {
  if (match.state !== 'ended') return;
  const anyHumanPresent = match.players.some(p => p.kind === 'human' && p.connected && !p.leftResults);
  if (!anyHumanPresent) matches.delete(match.id);
}

function startRematch(match) {
  const [a, b] = match.players;
  const excludeIds = new Set(match.questions.map(q => q.id));
  matches.delete(match.id);
  const pa = a.kind === 'human' ? newHumanPlayer(a.socket) : newBotPlayer();
  const pb = b.kind === 'human' ? newHumanPlayer(b.socket) : newBotPlayer();
  // Band, clock, and stake are recomputed from the players' CURRENT ratings.
  createMatch(match.queue, pa, pb, excludeIds);
}

// ---------------------------------------------------------------------------
// HTTP + Socket.IO wiring
// ---------------------------------------------------------------------------

const BANK = loadQuestions();

const app = express();
app.use(express.json());
// Static assets (HTML/CSS/JS/figures) stay publicly fetchable even when the
// access-code gate is on — only socket play and the leaderboard API are gated.
// `public` is now the Vite BUILD OUTPUT of the React client in app/client
// (npm run build). Do not hand-edit anything in there — it is regenerated.
app.use(express.static(path.join(__dirname, 'public')));
// The previous hand-written vanilla client, kept working and reachable at
// /legacy so there is always a known-good fallback while the port settles.
app.use('/legacy', express.static(path.join(__dirname, 'legacy')));
// Figures ARE the question bank (stems, choices, diagrams), so when the gate
// is on they are gated too. Registered only when a code is set, so the
// ungated default behaviour is unchanged.
if (ACCESS_CODE) {
  app.use('/figures', (req, res, next) => {
    if (hasValidCode(req)) return next();
    res.status(401).end();
  });
}
app.use('/figures', express.static(FIGURES_DIR));

const ACCESS_COOKIE = 'rs_access';

/** Minimal cookie read — not worth a dependency for one name. */
function cookieValue(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

/**
 * True if the caller supplied a matching access code, or the gate is disabled.
 * Accepts a header (API calls) OR a cookie — <img> requests for /figures
 * cannot set headers, and the question images are the bulk of the content
 * worth gating.
 */
function hasValidCode(req) {
  if (!ACCESS_CODE) return true;
  if ((req.get('x-access-code') || '') === ACCESS_CODE) return true;
  return cookieValue(req, ACCESS_COOKIE) === ACCESS_CODE;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, questions: BANK.questions.length, origin: BANK.origin });
});

// Host health check (Railway/Fly/Render style): cheap, ungated, no origin detail.
app.get('/healthz', (req, res) => {
  res.json({ ok: true, questions: BANK.questions.length });
});

// Client posts the code it collected on the entry screen; never echoes it back.
app.post('/api/verify-code', (req, res) => {
  const code = req.body && typeof req.body.code === 'string' ? req.body.code : '';
  if (!ACCESS_CODE) return res.json({ ok: true });
  if (code === ACCESS_CODE) {
    // Set the cookie so <img src="/figures/..."> passes the gate too. Not
    // httpOnly: the client reads it back to authenticate the socket handshake,
    // and it holds the same code the user just typed — nothing new is exposed.
    res.setHeader('Set-Cookie',
      `${ACCESS_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=2592000; SameSite=Lax`);
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'This beta is invite-only.' });
});

// Short question fragments used purely as visual texture on the lobby's paper
// decor. Deliberately NEVER includes `correct`, `rationale`, or the choices —
// only the stem prose, so nothing answerable leaks. Gated like the
// leaderboard: in a private beta the question bank should not be readable.
app.get('/api/decor', (req, res) => {
  if (!hasValidCode(req)) return res.status(401).json({ error: 'This beta is invite-only.' });
  const pool = BANK.questions.filter(q =>
    q.stem && q.stem.length > 70 && q.stem.length < 300 && !stemImageUrl(q));
  const out = [];
  const seen = new Set();
  for (let i = 0; i < 500 && out.length < 18; i++) {
    const q = pool[Math.floor(Math.random() * pool.length)];
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push({
      section: q.section,
      domain: q.domain || '',
      difficulty: q.difficulty,
      text: q.stem.replace(/\s+/g, ' ').trim().slice(0, 260),
    });
  }
  res.json(out);
});

// Domains available for the practice filters, with counts, straight from the
// loaded bank. Carries no question content, so it needs no access gate.
app.get('/api/meta', (req, res) => {
  res.json(domainMeta());
});

app.get('/api/leaderboard', (req, res) => {
  if (!hasValidCode(req)) return res.status(401).json({ error: 'This beta is invite-only.' });
  const board = {};
  for (const section of ['ela', 'math']) {
    board[section] = Object.values(PLAYERS.players)
      .filter(p => p.games[section] > 0)
      .sort((x, y) => y.ratings[section] - x.ratings[section])
      .slice(0, 50)
      .map(p => ({
        name: p.name,
        rating: p.ratings[section],
        games: p.games[section],
        wins: p.wins, losses: p.losses, draws: p.draws,
      }));
  }
  res.json(board);
});

const server = http.createServer(app);
const io = new Server(server); // serves /socket.io/socket.io.js from the local package

// Socket connections must present the access code (when the gate is enabled).
// Registering this middleware only when ACCESS_CODE is set keeps the default
// (unset) behavior byte-for-byte identical to before this gate existed.
if (ACCESS_CODE) {
  io.use((socket, next) => {
    const supplied = socket.handshake.auth && socket.handshake.auth.code;
    if (supplied === ACCESS_CODE) return next();
    next(new Error('invite-only'));
  });
}

io.on('connection', (socket) => {
  socket.data.name = null;
  socket.data.queueKey = null;
  socket.data.matchId = null;
  socket.data.playerIdx = null;

  // --- Identity -----------------------------------------------------------
  socket.on('hello', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (socket.data.queueKey || inActiveMatch(socket)) {
      return cb({ ok: false, error: 'Cannot change name while queued or in a match.' });
    }
    let name = sanitizeName(payload && payload.name);
    // Keep display names unique among CONNECTED sockets so two test windows don't collide.
    const base = name;
    let n = 2;
    while (activeNames.has(name.toLowerCase()) && activeNames.get(name.toLowerCase()) !== socket.id) {
      name = `${base} ${n++}`;
      if (n > 9) { name = `${base} ${socket.id.slice(0, 4)}`; break; }
    }
    if (socket.data.name && socket.data.name.toLowerCase() !== name.toLowerCase()) {
      activeNames.delete(socket.data.name.toLowerCase());
    }
    socket.data.name = name;
    activeNames.set(name.toLowerCase(), socket.id);
    const profile = profileFor(name);
    profile.lastSeen = new Date().toISOString();
    savePlayers([name.toLowerCase()]);
    cb({ ok: true, profile: publicProfile(profile) });
  });

  // --- Matchmaking --------------------------------------------------------
  socket.on('joinQueue', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (!socket.data.name) return cb({ ok: false, error: 'Set a display name first.' });
    const queue = payload && payload.queue;
    if (!QUEUE_DEFS[queue]) return cb({ ok: false, error: 'Unknown queue.' });
    if (socket.data.queueKey) return cb({ ok: false, error: 'Already in a queue.' });
    if (inActiveMatch(socket)) return cb({ ok: false, error: 'Already in a match.' });
    if (BANK.questions.filter(q => q.section === QUEUE_DEFS[queue].section).length === 0) {
      return cb({ ok: false, error: 'No questions available for that section.' });
    }

    // Queues are keyed by queue name only — difficulty is derived from the
    // players' average rating at match start (rules.difficultyPlanFor).
    const key = queue;
    const list = queues.get(key) || [];
    queues.set(key, list);

    const partner = list.find(e => e.socket.connected && e.socket !== socket);
    if (partner) {
      clearTimeout(partner.botTimer);
      list.splice(list.indexOf(partner), 1);
      partner.socket.data.queueKey = null;
      cb({ ok: true, matched: true });
      createMatch(queue, newHumanPlayer(partner.socket), newHumanPlayer(socket));
      return;
    }

    const entry = { socket, botTimer: null };
    entry.botTimer = setTimeout(() => {
      // Still waiting after 10s -> spawn a clearly-labeled bot opponent.
      const l = queues.get(key) || [];
      const idx = l.indexOf(entry);
      if (idx === -1 || !socket.connected) return;
      l.splice(idx, 1);
      socket.data.queueKey = null;
      createMatch(queue, newHumanPlayer(socket), newBotPlayer());
    }, BOT_WAIT_MS);
    list.push(entry);
    socket.data.queueKey = key;
    cb({ ok: true, matched: false, botWaitMs: BOT_WAIT_MS });
  });

  socket.on('leaveQueue', (payload, cb) => {
    removeFromQueue(socket);
    if (typeof cb === 'function') cb({ ok: true });
  });

  // --- Solo study ----------------------------------------------------------
  // Unrated, single player, never touches ratings/players.json/matches/queues.
  //
  // Three shapes:
  //   practice - endless, untimed, one question at a time. Optionally reveals
  //              the correct answer + rationale after each answer.
  //   module   - one timed Bluebook-shaped module (see SAT_MODULE), no
  //              feedback until the module ends.
  //   mock     - all four modules back to back, with Module 2 routed by how
  //              you did on Module 1, exactly as the adaptive test does.
  //
  // Answer keys and rationales are ONLY ever sent in response to an answer
  // already submitted, or in the end-of-module report. Questions on the wire
  // always go through publicQuestion().
  socket.on('soloStart', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    if (socket.data.queueKey || inActiveMatch(socket)) {
      return cb({ ok: false, error: 'Leave your queue or match first.' });
    }
    const p = payload || {};
    const mode = ['practice', 'module', 'mock'].includes(p.mode) ? p.mode : 'practice';
    const section = p.section === 'math' ? 'math' : 'ela';
    const filters = {
      difficulty: ['easy', 'medium', 'hard', 'hell'].includes(p.difficulty) ? p.difficulty : 'mixed',
      type: ['mcq', 'spr'].includes(p.type) ? p.type : 'any',
      age: ['new', 'original'].includes(p.age) ? p.age : 'any',
      // Validated against the bank so a stale client can't request a domain
      // that no longer exists and end up with an empty pool.
      domain: (p.domain && domainMeta()[section]
        && domainMeta()[section].some(d => d.domain === p.domain)) ? p.domain : 'any',
    };

    const s = {
      mode, section, filters,
      feedback: mode === 'practice' ? p.feedback !== false : false,
      served: new Set(), current: null, answeredCurrent: false,
      seen: 0, correct: 0,
      log: [], servedAt: 0, recycled: 0,
      queue: null, idx: 0, answers: [], endsAt: 0, moduleLabel: '',
      plan: null, planIdx: 0, results: [], done: false, report: null,
    };
    socket.data.solo = s;

    // Hell is a fixed cross-section list, so it makes no sense as a timed
    // Bluebook module or a mock exam.
    if (filters.difficulty === 'hell' && mode !== 'practice') {
      filters.difficulty = 'hard';
    }

    if (mode === 'practice') {
      if (!soloPool(s).length) {
        socket.data.solo = null;
        return cb({ ok: false, error: 'No questions match those filters.' });
      }
      soloServeOne(s);
      return cb({ ok: true, state: soloState(s) });
    }

    if (mode === 'mock') {
      // Full exam: both sections, both modules. Module 2 tiers are filled in
      // as each Module 1 is graded.
      s.plan = [
        { section: 'ela', module: 1 }, { section: 'ela', module: 2 },
        { section: 'math', module: 1 }, { section: 'math', module: 2 },
      ];
      s.planIdx = 0;
    } else {
      const module = p.module === 2 ? 2 : 1;
      const tier = p.tier === 'lower' ? 'lower' : 'upper';
      s.plan = [{ section, module, tier: module === 2 ? tier : undefined }];
      s.planIdx = 0;
    }
    const err = soloBeginModule(s);
    if (err) { socket.data.solo = null; return cb({ ok: false, error: err }); }
    cb({ ok: true, state: soloState(s) });
  });

  socket.on('soloAnswer', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const s = socket.data.solo;
    if (!s || !s.current) return cb({ ok: false, error: 'No question in play.' });
    if (s.answeredCurrent) return cb({ ok: false, error: 'Already answered.' });

    const q = s.current;
    const correct = grade(q, payload && payload.answer);
    s.answeredCurrent = true;
    s.seen++;
    if (correct) s.correct++;
    s.log.push({
      id: q.id, correct,
      difficulty: q.difficulty, domain: q.domain || '', skill: q.skill || '',
      type: q.type, section: q.section,
      ms: s.servedAt ? Date.now() - s.servedAt : 0,
    });

    if (s.mode === 'practice') {
      const out = { ok: true, state: soloState(s) };
      // withhold the key entirely when the player chose "no answers"
      if (s.feedback) {
        out.feedback = {
          correct,
          correctAnswer: q.correct,
          rationale: q.rationale || '',
          // Math rationales lose their notation to the PDF's vector art, so
          // they ship a render too (see scripts/mathcrop.py). Sent only here,
          // in the response to an already-submitted answer.
          rationaleImageUrl: rationaleImageUrl(q),
          skill: q.skill || '',
        };
      } else {
        out.feedback = { correct: null };
      }
      return cb(out);
    }

    // module / mock: record and advance immediately, no feedback mid-module
    s.answers.push({ id: q.id, answer: payload && payload.answer, correct });
    s.idx++;
    if (s.idx >= s.queue.length || soloTimeLeft(s) <= 0) soloFinishModule(s);
    else { s.current = s.queue[s.idx]; s.answeredCurrent = false; }
    cb({ ok: true, state: soloState(s) });
  });

  socket.on('soloNext', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const s = socket.data.solo;
    if (!s) return cb({ ok: false, error: 'No study session.' });
    if (s.mode === 'practice') { soloServeOne(s); return cb({ ok: true, state: soloState(s) }); }
    // module/mock: advance to the next module of the plan
    if (!s.done) return cb({ ok: false, error: 'Module still in progress.' });
    s.planIdx++;
    if (s.planIdx >= s.plan.length) return cb({ ok: true, state: soloState(s) });
    const err = soloBeginModule(s);
    if (err) return cb({ ok: false, error: err });
    cb({ ok: true, state: soloState(s) });
  });

  // A module's clock is server-authoritative like a duel's; the client only
  // displays it. Expiry is resolved whenever the client next talks to us.
  socket.on('soloSync', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const s = socket.data.solo;
    if (!s) return cb({ ok: false, error: 'No study session.' });
    if (s.queue && !s.done && soloTimeLeft(s) <= 0) soloFinishModule(s);
    cb({ ok: true, state: soloState(s) });
  });

  socket.on('soloEnd', (payload, cb) => {
    if (socket.data.solo) recordSession(socket.data.name, socket.data.solo);
    socket.data.solo = null;
    if (typeof cb === 'function') cb({ ok: true, history: historyFor(socket.data.name) });
  });

  socket.on('soloHistory', (payload, cb) => {
    if (typeof cb === 'function') cb({ ok: true, history: historyFor(socket.data.name) });
  });

  socket.on('soloClearHistory', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const key = String(socket.data.name || '').toLowerCase();
    if (!key) return cb({ ok: false, error: 'No player.' });
    const id = payload && payload.id;
    if (id) {
      SESSIONS[key] = (SESSIONS[key] || []).filter(e => e.id !== id);
    } else {
      delete SESSIONS[key];          // clear all
    }
    sessionsDirty = true;
    saveSessions();                  // deletion is deliberate; persist at once
    cb({ ok: true, history: historyFor(socket.data.name) });
  });

  // --- In-match -----------------------------------------------------------
  socket.on('answer', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const match = matches.get(socket.data.matchId);
    if (!match || match.state !== 'active') return cb({ ok: false, error: 'No active match.' });
    const p = match.players[socket.data.playerIdx];
    if (!p || p.socket !== socket) return cb({ ok: false, error: 'Not your match.' });
    const index = payload ? payload.index : -1;
    if (index !== p.qIndex) return cb({ ok: false, error: 'Wrong question index.' });
    const result = recordAnswer(match, p, index, payload.answer == null ? null : payload.answer);
    if (!result) return cb({ ok: false, error: 'Answer not accepted.' });
    // Micro-reveal: your OWN correctness only (never the correct answer itself).
    cb({ ok: true, index, correct: result.correct });
  });

  socket.on('abandonMatch', (payload, cb) => {
    const match = matches.get(socket.data.matchId);
    if (match && match.state === 'active') {
      endMatch(match, { forfeitLoser: socket.data.playerIdx, reason: 'abandon' });
    }
    if (typeof cb === 'function') cb({ ok: true });
  });

  // --- Post-match ---------------------------------------------------------
  socket.on('rematch', (payload, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    const match = matches.get(socket.data.matchId);
    if (!match || match.state !== 'ended') return cb({ ok: false, error: 'No finished match.' });
    const i = socket.data.playerIdx;
    const opp = match.players[1 - i];
    if (opp.kind === 'bot') {
      cb({ ok: true, starting: true });
      startRematch(match);
      return;
    }
    if (!opp.connected || opp.leftResults) return cb({ ok: false, error: 'Opponent left.' });
    match.rematchVotes.add(i);
    if (match.rematchVotes.size === 2) {
      cb({ ok: true, starting: true });
      startRematch(match);
    } else {
      opp.socket.emit('rematchOffered', { from: match.players[i].name });
      cb({ ok: true, starting: false });
    }
  });

  socket.on('toLobby', (payload, cb) => {
    const match = matches.get(socket.data.matchId);
    if (match && match.state === 'ended') {
      const i = socket.data.playerIdx;
      match.players[i].leftResults = true;
      const opp = match.players[1 - i];
      if (match.rematchVotes.has(1 - i) && opp.kind === 'human' && opp.connected) {
        opp.socket.emit('rematchDeclined', { reason: 'Opponent returned to the lobby.' });
      }
      cleanupIfAbandoned(match);
    }
    socket.data.matchId = null;
    socket.data.playerIdx = null;
    if (typeof cb === 'function') cb({ ok: true });
  });

  // --- Disconnect ---------------------------------------------------------
  socket.on('disconnect', () => {
    // Closing the window is the normal way to end a practice run, so save it
    // here too — otherwise only an explicit "Leave" would ever be recorded.
    if (socket.data.solo) {
      recordSession(socket.data.name, socket.data.solo);
      socket.data.solo = null;
    }
    if (socket.data.name) activeNames.delete(socket.data.name.toLowerCase());
    removeFromQueue(socket);

    const match = matches.get(socket.data.matchId);
    if (!match) return;
    const i = socket.data.playerIdx;
    const p = match.players[i];
    if (!p || p.socket !== socket) return;
    p.connected = false;

    if (match.state === 'active') {
      clearTimeout(p.pendingTimer);
      p.pendingTimer = null;
      const opp = match.players[1 - i];
      if (opp.kind === 'human' && !opp.connected) {
        // Both humans gone: void the match quietly (no one to notify, no rating change).
        match.state = 'ended';
        clearMatchTimers(match);
        matches.delete(match.id);
        return;
      }
      if (opp.kind === 'human') {
        opp.socket.emit('opponentDisconnected', { graceMs: DISCONNECT_GRACE_MS });
      }
      match.forfeitTimer = setTimeout(() => {
        endMatch(match, { forfeitLoser: i, reason: 'disconnect' });
      }, DISCONNECT_GRACE_MS);
    } else if (match.state === 'ended') {
      p.leftResults = true;
      const opp = match.players[1 - i];
      if (match.rematchVotes.has(1 - i) && opp.kind === 'human' && opp.connected) {
        opp.socket.emit('rematchDeclined', { reason: 'Opponent disconnected.' });
      }
      cleanupIfAbandoned(match);
    }
  });
});

function inActiveMatch(socket) {
  const match = matches.get(socket.data.matchId);
  return !!(match && match.state === 'active');
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  try {
    PLAYERS.players = await storage.loadAll();
  } catch (err) {
    console.error('[players] initial load failed:', err.message);
  }

  // PORT 0 asks the OS for any free port — the desktop app uses that so it
  // can never collide with something already on 3000.
  await new Promise((resolve) => server.listen(PORT, resolve));
  {
    const bySection = { ela: 0, math: 0 };
    const byDiff = { easy: 0, medium: 0, hard: 0 };
    BANK.questions.forEach(q => { bySection[q.section]++; byDiff[q.difficulty]++; });
    const bound = server.address().port;
    console.log(`RankedSat test server listening on http://localhost:${bound}`);
    console.log(`Questions: ${BANK.questions.length} from ${BANK.origin}` +
      ` (ela ${bySection.ela} / math ${bySection.math}; easy ${byDiff.easy} / medium ${byDiff.medium} / hard ${byDiff.hard};` +
      ` ${BANK.filtered} filtered, ${BANK.bad} invalid lines skipped)`);
    const storageDesc = storage.kind === 'local' ? `local (state dir: ${STATE_DIR})` : 'firestore';
    console.log(`Players on file: ${Object.keys(PLAYERS.players).length} (storage: ${storageDesc})`);
    console.log(`Figures dir: ${FIGURES_DIR}`);
    console.log(`Access gate: ${ACCESS_CODE ? 'ENABLED (private beta)' : 'disabled'}`);
    // A container with local storage and no mounted volume silently loses
    // every rating on redeploy. Say so loudly rather than let it be found
    // the hard way.
    // Not applicable to the desktop build: there the state dir is the OS
    // per-user data directory, which is genuinely persistent.
    if (storage.kind === 'local' && process.env.RANKEDSAT_STATE_DIR
        && !process.env.RANKEDSAT_DESKTOP) {
      console.warn(
        `\n[!] players.json lives at ${STATE_DIR} using LOCAL storage.\n` +
        '    If that path is not a mounted volume, every rating and record is\n' +
        '    lost on restart/redeploy. Fix: mount a disk there, or set\n' +
        '    FIREBASE_SERVICE_ACCOUNT to switch to Firestore.\n');
    }
  }
  return server;
}

// Auto-start when run directly (`node server.js`, the Docker CMD). When
// required — as the Electron desktop app does — the caller decides when to
// start and reads the bound port off the returned server.
if (require.main === module) {
  start();
}

module.exports = { start };
