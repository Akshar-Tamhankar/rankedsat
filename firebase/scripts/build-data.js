'use strict';
/**
 * RankedSat Firebase data build.
 *
 * Reads the master question bank (data/questions.jsonl) and produces:
 *   (a) firebase/functions/bank.json  — the PRIVATE full bank (correct answers +
 *       rationales included). This file is bundled with Cloud Functions only and
 *       must NEVER be placed under hosting/public or any client-readable path.
 *   (b) firebase/hosting/public/figures/  — copies of the figure/stem-image PNGs
 *       (public content: images contain question stems/figures, never answers).
 *
 * Validation/filter rules mirror app/server.js loadQuestions():
 *   - drop unparseable/invalid/duplicate-id lines
 *   - drop suspect questions and figure-required-but-missing questions UNLESS
 *     they ship a stemImagePath (the rendered image is the full question)
 *   - normalize choices for stem-image MCQs
 *
 * Idempotent: bank.json is rewritten deterministically; figures are copied only
 * when missing or when size/mtime differ.
 *
 * Run: node firebase/scripts/build-data.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');           // repo root
const FIREBASE_DIR = path.resolve(__dirname, '..');
const QUESTIONS_PATH = path.join(ROOT, 'data', 'questions.jsonl');
const FIGURES_SRC = path.join(ROOT, 'data', 'figures');
const BANK_OUT = path.join(FIREBASE_DIR, 'functions', 'bank.json');
const FIGURES_OUT = path.join(FIREBASE_DIR, 'hosting', 'public', 'figures');

function isValidQuestion(q, hasStemImage) {
  if (!q || typeof q !== 'object') return false;
  if (typeof q.id !== 'string' || !q.id) return false;
  if (q.section !== 'ela' && q.section !== 'math') return false;
  if (!['easy', 'medium', 'hard'].includes(q.difficulty)) return false;
  if (q.type !== 'mcq' && q.type !== 'spr') return false;
  if (typeof q.correct !== 'string' || !q.correct) return false;
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

/** Normalize a jsonl figure path into a hosting URL under /figures/. */
function figuresRouteUrl(rawPath) {
  if (!rawPath) return null;
  let p = String(rawPath).replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.startsWith('data/')) p = p.slice(5);
  if (p.startsWith('figures/')) p = p.slice(8);
  return '/figures/' + p;
}

/** Filesystem path (under data/figures) for a jsonl figure path. */
function figuresSrcPath(rawPath) {
  let p = String(rawPath).replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.startsWith('data/')) p = p.slice(5);
  if (p.startsWith('figures/')) p = p.slice(8);
  return path.join(FIGURES_SRC, p);
}

function loadBank() {
  const raw = fs.readFileSync(QUESTIONS_PATH, 'utf8');
  const questions = [];
  const seen = new Set();
  let bad = 0, filtered = 0;
  raw.split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (!t) return;
    let q;
    try { q = JSON.parse(t); } catch { bad++; return; }
    const hasStemImage = typeof q.stemImagePath === 'string' && q.stemImagePath.trim() !== '';
    if (!isValidQuestion(q, hasStemImage) || seen.has(q.id)) { bad++; return; }
    if (!hasStemImage && (q.suspect === true || (q.hasFigure && !q.figurePath))) { filtered++; return; }
    if (hasStemImage && typeof q.stem !== 'string') q.stem = '';
    if (hasStemImage && q.type === 'mcq') {
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
    // Keep only the fields the functions need; precompute hosting URLs.
    questions.push({
      id: q.id,
      section: q.section,
      domain: q.domain || '',
      skill: q.skill || '',
      difficulty: q.difficulty,
      type: q.type,
      passage: q.passage || null,
      stem: q.stem || '',
      choices: q.type === 'mcq' ? (q.choices || []).map(c => ({ label: String(c.label), text: typeof c.text === 'string' ? c.text : '' })) : null,
      correct: q.correct,                       // PRIVATE — functions only
      rationale: q.rationale || null,           // PRIVATE — functions only
      hasFigure: !!q.hasFigure,
      figureUrl: q.hasFigure && q.figurePath ? figuresRouteUrl(q.figurePath) : null,
      stemImageUrl: hasStemImage ? figuresRouteUrl(q.stemImagePath) : null,
      _figureSrc: q.hasFigure && q.figurePath ? q.figurePath : null,
      _stemImageSrc: hasStemImage ? q.stemImagePath : null,
    });
  });
  return { questions, bad, filtered };
}

function copyFigures(questions) {
  fs.mkdirSync(FIGURES_OUT, { recursive: true });
  const wanted = new Set();
  questions.forEach(q => {
    if (q._figureSrc) wanted.add(q._figureSrc);
    if (q._stemImageSrc) wanted.add(q._stemImageSrc);
  });
  let copied = 0, skipped = 0, missing = 0;
  for (const rawPath of wanted) {
    const src = figuresSrcPath(rawPath);
    if (!fs.existsSync(src)) { missing++; continue; }
    const dst = path.join(FIGURES_OUT, path.basename(src));
    const s = fs.statSync(src);
    let need = true;
    if (fs.existsSync(dst)) {
      const d = fs.statSync(dst);
      if (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 2000) need = false;
    }
    if (need) {
      fs.copyFileSync(src, dst);
      fs.utimesSync(dst, s.atime, s.mtime);
      copied++;
    } else {
      skipped++;
    }
  }
  return { copied, skipped, missing, wanted: wanted.size };
}

function main() {
  if (!fs.existsSync(QUESTIONS_PATH)) {
    console.error('FATAL: question bank not found at ' + QUESTIONS_PATH);
    process.exit(1);
  }
  const { questions, bad, filtered } = loadBank();

  // Strip the build-only source-path fields before writing the functions bank.
  const bankQuestions = questions.map(q => {
    const { _figureSrc, _stemImageSrc, ...rest } = q;
    return rest;
  });
  fs.mkdirSync(path.dirname(BANK_OUT), { recursive: true });
  fs.writeFileSync(BANK_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), count: bankQuestions.length, questions: bankQuestions }));

  const fig = copyFigures(questions);

  const bySec = { ela: 0, math: 0 };
  const byDiff = { easy: 0, medium: 0, hard: 0 };
  bankQuestions.forEach(q => { bySec[q.section]++; byDiff[q.difficulty]++; });
  console.log('bank.json: ' + bankQuestions.length + ' questions ' +
    '(ela ' + bySec.ela + ' / math ' + bySec.math +
    '; easy ' + byDiff.easy + ' / medium ' + byDiff.medium + ' / hard ' + byDiff.hard +
    '; ' + filtered + ' filtered, ' + bad + ' invalid/duplicate lines skipped)');
  console.log('figures: ' + fig.wanted + ' referenced, ' + fig.copied + ' copied, ' +
    fig.skipped + ' up-to-date, ' + fig.missing + ' missing sources');
  console.log('PRIVATE bank written to ' + path.relative(ROOT, BANK_OUT) + ' (never serve this from hosting)');
  if (fig.missing > 0) process.exitCode = 2;
}

main();
