import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as snd from '../lib/audio.js';
import Calculator from './Calculator.jsx';
import QuestionView from './QuestionView.jsx';
import { loadDesmos } from '../lib/desmos.js';

/**
 * THE DUEL — deliberately stripped.
 *
 * No camera, no parallax, no particles, no tilt, no translucency, no ambient
 * motion. A match is a timed test under a 5:00 clock; drifting watermarks and
 * cursor-follow zoom while someone reads a passage would cost them points.
 * The hall is decorated, this is a still, high-contrast reading surface.
 *
 * The only motion is the clock, and even that can be hidden with T.
 */

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Duel({ game }) {
  const { match, question, answered, oppCompleted, clockMs, clockDead, banner } = game;
  const [choice, setChoice] = useState(null);
  const [spr, setSpr] = useState('');
  const [crossed, setCrossed] = useState(new Set());
  const [crossMode, setCrossMode] = useState(false);
  const [flagged, setFlagged] = useState(new Set());
  const [showClock, setShowClock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const calcPanelRef = useRef(null);

  const hasCalc = !!(match && match.desmos);

  // Warm the script as soon as a Desmos match starts so the first open is
  // instant rather than a cold fetch under the clock.
  useEffect(() => { if (hasCalc) loadDesmos(); }, [hasCalc]);
  useEffect(() => { setCalcOpen(false); }, [match && match.matchId]);

  const q = question && question.question;
  const idx = question ? question.index : 0;
  const total = (question && question.total) || (match && match.totalQuestions) || 5;
  const isMcq = q && q.type === 'mcq';

  // reset per-question UI state
  useEffect(() => { setChoice(null); setSpr(''); setCrossed(new Set()); setCrossMode(false); }, [idx, q && q.id]);

  const canSubmit = !busy && !!q && (isMcq ? choice !== null : spr.trim().length > 0);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    const ans = isMcq ? choice : spr.trim();
    const res = await game.submitAnswer(idx, ans);
    setBusy(false);
    if (res && res.ok) snd.blip(res.correct);
  }, [canSubmit, isMcq, choice, spr, idx, game]);

  // keyboard: 1-4/A-D select, Enter submit, X cross-out, F flag, T clock,
  // K calculator (see the C/K note below)
  useEffect(() => {
    const onKey = (e) => {
      // While focus is inside the calculator, every key belongs to Desmos —
      // otherwise typing an expression would fire duel shortcuts.
      // `instanceof Node` matters: contains() throws on a non-Node target,
      // which would take the whole handler down with it.
      const inCalc = !!(calcPanelRef.current
        && e.target instanceof Node
        && calcPanelRef.current.contains(e.target));
      if (e.key === 'Escape') {
        if (calcOpen) { e.preventDefault(); setCalcOpen(false); }
        return;
      }
      if (inCalc) return;

      if (e.target.matches && e.target.matches('input,textarea')) {
        if (e.key === 'Enter') submit();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();

      // K is the universal calculator toggle. The legacy client used C, but on
      // an MCQ 'c' is consumed by choice C first, so C silently did nothing on
      // exactly the math questions that have a calculator. C still works where
      // it is unambiguous (non-MCQ), for muscle memory.
      if (hasCalc && (k === 'k' || (k === 'c' && !isMcq))) {
        e.preventDefault();
        setCalcOpen((v) => !v);
        return;
      }
      if (isMcq && q.choices) {
        const byNum = '1234'.indexOf(k);
        const byLtr = 'abcd'.indexOf(k);
        const i = byNum >= 0 ? byNum : byLtr;
        if (i >= 0 && i < q.choices.length) {
          e.preventDefault();
          if (crossMode) {
            setCrossed((c) => { const n = new Set(c); n.has(i) ? n.delete(i) : n.add(i); return n; });
          } else setChoice(q.choices[i].label);
          return;
        }
      }
      if (k === 'enter') { e.preventDefault(); submit(); }
      else if (k === 'x') setCrossMode((v) => !v);
      else if (k === 'f') setFlagged((f) => { const n = new Set(f); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
      else if (k === 't') setShowClock((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMcq, q, crossMode, submit, idx, hasCalc, calcOpen]);

  const pips = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);
  const done = answered.filter(Boolean).length;

  if (!match) return null;

  return (
    <div className="duel">
      <header className="duel-top">
        <div className="dt-side">
          <span className="dt-name">{match.you.name}</span>
          <span className="pips">
            {pips.map((i) => (
              <span key={i} className={`pip${i < done ? ' on' : ''}${i === idx ? ' cur' : ''}`} />
            ))}
          </span>
        </div>
        <div className="dt-center">
          <span className="qcount">Q {Math.min(idx + 1, total)}/{total}</span>
          <button
            type="button" className="clock" aria-pressed={showClock}
            onClick={() => setShowClock((v) => !v)} title="Show or hide the clock (T)"
          >
            {showClock ? fmt(clockMs) : '––:––'}
          </button>
          {match.stake != null && <span className="stake">±{match.stake}</span>}
        </div>
        <div className="dt-side dt-opp">
          <span className="dt-name">
            {match.opponent.name}
            {match.opponent.isBot && <span className="bot">BOT</span>}
          </span>
          <span className="pips">
            {pips.map((i) => (
              <span key={i} className={`pip${i < oppCompleted ? ' on' : ''}`} />
            ))}
          </span>
        </div>
      </header>

      {(banner || clockDead) && (
        <div className="duel-banner" role="status">
          {banner || 'Your clock ran out.'}
        </div>
      )}

      {!q && (
        <div className="duel-wait">
          <h2>{done >= total ? 'All done.' : 'Loading…'}</h2>
          <p>{done >= total ? 'Waiting for your opponent to finish…' : 'Fetching the next question.'}</p>
        </div>
      )}

      {/* Same Bluebook surface as solo study — one component, so the duel and
          practice can't drift apart. */}
      <QuestionView
        q={q}
        index={idx}
        total={total}
        flagged={flagged.has(idx)}
        onToggleFlag={() => setFlagged((f) => {
          const n = new Set(f); n.has(idx) ? n.delete(idx) : n.add(idx); return n;
        })}
        choice={choice}
        onChoose={setChoice}
        crossed={crossed}
        onCross={(i) => setCrossed((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
        crossMode={crossMode}
        onToggleCross={() => setCrossMode((v) => !v)}
        spr={spr}
        onSpr={setSpr}
        disabled={false}
        feedback={null}
      />

      <footer className="duel-bottom">
        <button
          type="button" aria-pressed={flagged.has(idx)}
          className={flagged.has(idx) ? 'on' : ''}
          onClick={() => setFlagged((f) => { const n = new Set(f); n.has(idx) ? n.delete(idx) : n.add(idx); return n; })}
        >Flag <kbd>F</kbd></button>
        <button
          type="button" aria-pressed={crossMode}
          className={crossMode ? 'on' : ''}
          onClick={() => setCrossMode((v) => !v)}
          disabled={!isMcq}
        >Cross-out <kbd>X</kbd></button>
        {hasCalc && (
          <button
            type="button" aria-pressed={calcOpen}
            className={calcOpen ? 'on' : ''}
            onClick={() => setCalcOpen((v) => !v)}
            title="Toggle the Desmos calculator (K)"
          >Calculator <kbd>K</kbd></button>
        )}
        <span className="spacer" />
        <span className="kbd-hint">
          1–4 / A–D select · Enter submit · T clock{hasCalc ? ' · K calculator' : ''}
        </span>
        <button type="button" className="primary" disabled={!canSubmit} onClick={submit}>Submit</button>
        <button type="button" className="danger" onClick={game.forfeit}>Forfeit</button>
      </footer>

      {/* mounted for the whole Desmos match so expressions survive toggling */}
      {hasCalc && (
        <Calculator open={calcOpen} onClose={() => setCalcOpen(false)} panelRef={calcPanelRef} />
      )}
    </div>
  );
}
