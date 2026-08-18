import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as snd from '../lib/audio.js';
import Calculator from './Calculator.jsx';
import QuestionView from './QuestionView.jsx';
import SessionStats from './SessionStats.jsx';
import { loadDesmos } from '../lib/desmos.js';

/**
 * SOLO STUDY — three shapes, one surface.
 *
 *   practice : endless, untimed, filtered. Optionally reveals the answer and
 *              rationale after each question (the "answers / no answers"
 *              switch). This is the learning loop a duel deliberately denies.
 *   module   : one timed Bluebook-shaped module — 27 RW in 32 min, or 22 Math
 *              in 35 min. No feedback until the module closes.
 *   mock     : all four modules back to back, Module 2 routed by Module 1.
 *
 * All state is rendered from the server's session object; this component owns
 * only the in-progress answer. The clock is display-only — the server decides
 * when a module is actually over.
 */

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Practice({ game }) {
  const solo = game.solo;
  const fb = game.soloFb;
  const [choice, setChoice] = useState(null);
  const [spr, setSpr] = useState('');
  const [crossed, setCrossed] = useState(new Set());
  const [crossMode, setCrossMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [msLeft, setMsLeft] = useState(null);
  const [showClock, setShowClock] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [flagged, setFlagged] = useState(new Set());
  const calcPanelRef = useRef(null);

  const q = solo && solo.question;
  const isMcq = q && q.type === 'mcq';
  // Per-QUESTION, not per-session: hell mixes ELA and math in one run, so the
  // calculator has to follow the question in front of you.
  const hasCalc = !!(q && q.section === 'math');
  const timed = solo && solo.msLeft != null;
  const showFb = !!(fb && fb.correct !== null && fb.correctAnswer !== undefined);
  const answeredNoFb = !!(fb && fb.correct === null);

  useEffect(() => { if (hasCalc) loadDesmos(); }, [hasCalc]);
  useEffect(() => { setChoice(null); setSpr(''); setCrossed(new Set()); setCrossMode(false); },
    [q && q.id]);
  useEffect(() => { setReviewOpen(false); }, [solo && solo.moduleLabel, solo && solo.done]);

  // local countdown for display; server owns the real deadline
  useEffect(() => {
    if (!timed) { setMsLeft(null); return undefined; }
    setMsLeft(solo.msLeft);
    const t0 = performance.now();
    const base = solo.msLeft;
    const id = setInterval(() => setMsLeft(Math.max(0, base - (performance.now() - t0))), 250);
    return () => clearInterval(id);
  }, [timed, solo && solo.msLeft, solo && solo.moduleLabel]);

  // when the local clock hits zero, ask the server to close the module
  useEffect(() => {
    if (!timed || msLeft === null || msLeft > 0) return;
    game.soloSync();
  }, [msLeft, timed, game]);

  const [qMs, setQMs] = useState(0);
  const qFrozen = useRef(0);

  const canSubmit = !busy && !showFb && !answeredNoFb && !!q
    && (isMcq ? choice !== null : spr.trim().length > 0);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    const res = await game.soloAnswer(isMcq ? choice : spr.trim());
    setBusy(false);
    if (res && res.ok && res.feedback && res.feedback.correct !== null) snd.blip(res.feedback.correct);
  }, [canSubmit, isMcq, choice, spr, game]);

  const next = useCallback(() => game.soloNext(), [game]);
  const waiting = showFb || answeredNoFb;
  const qid = q && q.id;
  const toggleFlag = useCallback(() => {
    if (!qid) return;
    setFlagged((f) => { const n = new Set(f); n.has(qid) ? n.delete(qid) : n.add(qid); return n; });
  }, [qid]);

  // Per-question stopwatch for practice. Counts up, then freezes the instant
  // the answer lands so the number on screen matches what the server logged.
  // MUST live below `waiting` — a dependency array is evaluated during render,
  // so referencing a const declared later throws before anything mounts.
  useEffect(() => {
    if (timed || !q || waiting) return undefined;
    setQMs(0);
    const t0 = performance.now();
    const id = setInterval(() => setQMs(performance.now() - t0), 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qid, timed, waiting]);

  useEffect(() => {
    if (waiting) qFrozen.current = qMs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  useEffect(() => {
    const onKey = (e) => {
      const inCalc = !!(calcPanelRef.current && e.target instanceof Node
        && calcPanelRef.current.contains(e.target));
      if (e.key === 'Escape') { if (calcOpen) { e.preventDefault(); setCalcOpen(false); } return; }
      if (inCalc) return;
      if (e.target.matches && e.target.matches('input,textarea')) {
        if (e.key === 'Enter') { e.preventDefault(); waiting ? next() : submit(); }
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (hasCalc && (k === 'k' || (k === 'c' && !isMcq))) {
        e.preventDefault(); setCalcOpen((v) => !v); return;
      }
      if (k === 't' && timed) { e.preventDefault(); setShowClock((v) => !v); return; }
      if (k === 's' && !timed) { e.preventDefault(); setStatsOpen((v) => !v); return; }
      if (k === 'm') { e.preventDefault(); toggleFlag(); return; }
      if (waiting) { if (k === 'enter' || k === 'n') { e.preventDefault(); next(); } return; }
      if (isMcq && q && q.choices) {
        const i = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : 'abcd'.indexOf(k);
        if (i >= 0 && i < q.choices.length) {
          e.preventDefault();
          if (crossMode) setCrossed((c) => { const n = new Set(c); n.has(i) ? n.delete(i) : n.add(i); return n; });
          else setChoice(q.choices[i].label);
          return;
        }
      }
      if (k === 'enter') { e.preventDefault(); submit(); }
      else if (k === 'x') setCrossMode((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMcq, q, crossMode, submit, next, waiting, hasCalc, calcOpen, timed, toggleFlag]);

  if (!solo) return null;

  // ── leaving practice: show the session analysis before going back ───────
  if (leaving) {
    return (
      <div className="duel practice">
        <div className="results">
          <div className="res-card wide">
            <SessionStats stats={solo.stats} standalone />
            <div className="res-actions">
              <button className="primary" type="button" onClick={() => setLeaving(false)}>
                Keep practising
              </button>
              <button type="button" onClick={game.soloEnd}>Back to the hall</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── module / mock report ────────────────────────────────────────────────
  if (solo.done && solo.report) {
    const r = solo.report;
    const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
    const more = solo.planTotal && solo.planIdx < solo.planTotal - 1;
    return (
      <div className="duel practice">
        <div className="results">
          <div className="res-card wide">
            <h1 className="res-head">{r.label}</h1>
            <p className="muted">
              {r.correct} of {r.total} correct · {pct}%
              {r.unanswered > 0 && ` · ${r.unanswered} unanswered`}
            </p>

            {solo.results && solo.results.length > 1 && (
              <div className="mod-tally">
                {solo.results.map((m, i) => (
                  <div className="mod-row" key={i}>
                    <span>{m.label}</span><b>{m.correct}/{m.total}</b>
                  </div>
                ))}
              </div>
            )}

            <button className="btn ghost small" type="button" onClick={() => setReviewOpen((v) => !v)}>
              {reviewOpen ? 'Hide' : 'Review'} all {r.review.length} questions
            </button>

            {reviewOpen && (
              <div className="review-list">
                {r.review.map((x, i) => (
                  <div key={x.id} className={`rev ${x.correct ? 'ok' : 'no'}`}>
                    <div className="rev-head">
                      <span className="rev-n">{i + 1}</span>
                      <span className={`diff ${x.difficulty}`}>{x.difficulty}</span>
                      <span className="muted">{x.domain}{x.skill ? ` · ${x.skill}` : ''}</span>
                      <span className="rev-verdict">{x.correct ? 'correct' : 'incorrect'}</span>
                    </div>
                    <div className="rev-ans">
                      You: <b>{x.yourAnswer == null || x.yourAnswer === '' ? '—' : x.yourAnswer}</b>
                      {' · '}Answer: <b>{x.correctAnswer}</b>
                    </div>
                    {x.rationaleImageUrl
                      ? <img className="fb-why-img" src={x.rationaleImageUrl} alt="Explanation" />
                      : x.rationale ? <p className="fb-why">{x.rationale}</p> : null}
                  </div>
                ))}
              </div>
            )}

            <div className="res-actions">
              {more && <button className="primary" type="button" onClick={next}>Next module</button>}
              <button type="button" onClick={game.soloEnd}>Back to the hall</button>
            </div>
            {more && solo.plan !== null && (
              <p className="muted small">
                Module {solo.planIdx + 2} of {solo.planTotal} next — difficulty follows this score.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const acc = solo.seen ? Math.round((solo.correct / solo.seen) * 100) : null;

  return (
    <div className="duel practice">
      <header className="duel-top">
        <div className="dt-side">
          <span className="dt-name">{solo.moduleLabel || 'Practice'}</span>
          {!solo.moduleLabel && <>
            <span className="prac-tag">{solo.section === 'math' ? 'Math' : 'ELA'}</span>
            <span className="prac-tag">{solo.filters.difficulty}</span>
            {solo.filters.type !== 'any' && <span className="prac-tag">{solo.filters.type}</span>}
            {solo.filters.age !== 'any' && <span className="prac-tag">{solo.filters.age}</span>}
          </>}
        </div>
        <div className="dt-center">
          {timed ? (
            <>
              <span className="qcount">Q {Math.min(solo.idx + 1, solo.total)}/{solo.total}</span>
              <button type="button" className="clock" onClick={() => setShowClock((v) => !v)}
                title="Show or hide the clock (T)">
                {showClock ? fmt(msLeft == null ? 0 : msLeft) : '––:––'}
              </button>
            </>
          ) : (
            <>
              <span className="qcount">
                {solo.correct} / {solo.seen}
                {acc !== null && <span className="acc"> · {acc}%</span>}
              </span>
              <span className="qtimer" title="Time on this question">
                {((waiting ? qFrozen.current : qMs) / 1000).toFixed(1)}s
              </span>
            </>
          )}
        </div>
        <div className="dt-side dt-opp">
          <span className="unrated">
            {timed ? `Module ${(solo.planIdx || 0) + 1} of ${solo.planTotal}` : 'Unrated · no clock'}
          </span>
        </div>
      </header>

      <QuestionView
        q={q}
        index={timed ? solo.idx : solo.seen}
        total={solo.total}
        flagged={qid ? flagged.has(qid) : false}
        onToggleFlag={toggleFlag}
        choice={choice}
        onChoose={setChoice}
        crossed={crossed}
        onCross={(i) => setCrossed((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
        crossMode={crossMode}
        onToggleCross={() => setCrossMode((v) => !v)}
        spr={spr}
        onSpr={setSpr}
        disabled={waiting}
        feedback={showFb ? fb : null}
      >
        {showFb && (
          <div className={`feedback ${fb.correct ? 'ok' : 'no'}`} aria-live="polite">
            <div className="fb-head">
              {fb.correct ? 'Correct' : 'Not quite'}
              <span className="fb-ans">Answer: <b>{fb.correctAnswer}</b></span>
            </div>
            {/* Math rationales ship as a render because their notation does
                not survive text extraction; the image supersedes the text. */}
            {fb.rationaleImageUrl
              ? <img className="fb-why-img" src={fb.rationaleImageUrl} alt="Explanation" />
              : fb.rationale
                ? <p className="fb-why">{fb.rationale}</p>
                : <p className="fb-why muted">No written rationale for this one.</p>}
          </div>
        )}
        {answeredNoFb && (
          <div className="feedback" aria-live="polite">
            <div className="fb-head">Answer recorded</div>
            <p className="fb-why muted">Answers are hidden in this session.</p>
          </div>
        )}
      </QuestionView>

      {statsOpen && !timed && (
        <SessionStats stats={solo.stats} onClose={() => setStatsOpen(false)} />
      )}

      <footer className="duel-bottom">
        {!timed && (
          <button
            type="button" aria-pressed={statsOpen} className={statsOpen ? 'on' : ''}
            onClick={() => setStatsOpen((v) => !v)}
          >Stats <kbd>S</kbd></button>
        )}
        {hasCalc && (
          <button
            type="button" aria-pressed={calcOpen} className={calcOpen ? 'on' : ''}
            onClick={() => setCalcOpen((v) => !v)}
          >Calculator <kbd>K</kbd></button>
        )}
        <span className="spacer" />
        <span className="kbd-hint">
          {waiting ? 'Enter / N to continue' : '1–4 / A–D select · Enter submit · M mark'}
        </span>
        {!waiting && (
          <button type="button" className="primary" disabled={!canSubmit} onClick={submit}>
            {timed ? 'Submit' : 'Check'}
          </button>
        )}
        {waiting && <button type="button" className="primary" onClick={next}>Next <kbd>N</kbd></button>}
        <button
          type="button" className="danger"
          onClick={() => (timed ? game.soloEnd() : setLeaving(true))}
        >Leave</button>
      </footer>

      {hasCalc && (
        <Calculator open={calcOpen} onClose={() => setCalcOpen(false)} panelRef={calcPanelRef} />
      )}
    </div>
  );
}
