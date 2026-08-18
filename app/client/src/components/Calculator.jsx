import React, { useEffect, useRef, useState } from 'react';
import { loadDesmos } from '../lib/desmos.js';

/**
 * Configured to match the calculator in Bluebook (the digital SAT app), which
 * embeds the Desmos graphing calculator.
 *
 * ON, because the test has them — students who practise without these are
 * practising the wrong tool:
 *   sliders, tables, regressions, statistics/distributions, degree-mode
 *   toggle via the settings menu, zoom controls, points of interest (the
 *   grey dots for intercepts/intersections that make graphing worth using).
 *
 * OFF, because the test does not have them and they leak out of the exam
 * environment: image upload, folders, notes, clickable links, pasting a
 * graph link, and Desmos "actions".
 *
 * Every option is stated explicitly rather than left to library defaults, so
 * a future Desmos release changing a default cannot silently change what a
 * student practises against.
 *
 * Verify against a live Bluebook session before trusting it for high-stakes
 * prep — Desmos and College Board can revise the embedded build, and this is
 * matched to publicly documented behaviour, not to an official spec.
 */
export const TEST_CONFIG = {
  // core surface
  expressions: true,
  keypad: true,
  graphpaper: true,
  settingsMenu: true,      // degree/radian toggle lives here — present on the test
  expressionsTopbar: true,
  zoomButtons: true,
  border: false,
  autosize: true,
  lockViewport: false,

  // features the SAT calculator DOES have
  sliders: true,
  pointsOfInterest: true,
  trace: true,
  plotInequalities: true,
  plotImplicits: true,
  plotSingleVariableImplicitEquations: true,
  distributions: true,
  substitutions: true,
  restrictedFunctions: false,
  pasteTableData: true,
  decimalToFraction: true,

  // features it does NOT have / must not have in an exam context
  images: false,
  folders: false,
  notes: false,
  links: false,
  actions: false,
  pasteGraphLink: false,
  administerSecretFolders: false,

  // presentation
  degreeMode: false,       // radians, matching the Desmos/SAT default
  projectorMode: false,
  invertedColors: false,
  fontSize: 16,
  language: 'en',
};

/**
 * The Desmos panel for math-desmos duels.
 *
 * The panel stays MOUNTED for the whole match once it has been opened, and
 * toggling only hides it. Unmounting would destroy the calculator and throw
 * away every expression the player has typed — losing your working mid-duel,
 * under the clock, would be much worse than the cost of keeping it around.
 * Desmos needs a laid-out host to size itself, so we create it on first open
 * and call resize() on each reopen.
 */
export default function Calculator({ open, onClose, panelRef }) {
  const hostRef = useRef(null);
  const calcRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const dragRef = useRef(null);

  // Bluebook lets you drag the calculator around and resize it, and where you
  // put it genuinely changes how you work a problem (over the choices vs.
  // beside the stem), so the panel moves here too. Written straight to style
  // — this runs during a pointer drag and has no business re-rendering React.
  const startDrag = (e, mode) => {
    const panel = panelRef.current;
    if (!panel || e.button !== 0) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height };
    panel.setPointerCapture(e.pointerId);
  };
  const onDrag = (e) => {
    const d = dragRef.current;
    const panel = panelRef.current;
    if (!d || !panel) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === 'move') {
      const l = Math.max(4, Math.min(window.innerWidth - d.w - 4, d.l + dx));
      const t = Math.max(4, Math.min(window.innerHeight - d.h - 4, d.t + dy));
      panel.style.left = l + 'px';
      panel.style.top = t + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    } else {
      panel.style.width = Math.max(320, Math.min(window.innerWidth - d.l - 8, d.w + dx)) + 'px';
      panel.style.height = Math.max(300, Math.min(window.innerHeight - d.t - 8, d.h + dy)) + 'px';
    }
  };
  const endDrag = (e) => {
    const panel = panelRef.current;
    if (dragRef.current && panel) {
      try { panel.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      // Desmos re-measures its host only when told to
      if (dragRef.current.mode === 'size' && calcRef.current) calcRef.current.resize();
    }
    dragRef.current = null;
  };

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    loadDesmos().then((ok) => {
      if (!alive) return;
      if (!ok) { setStatus('failed'); return; }
      if (!calcRef.current && hostRef.current && window.Desmos) {
        calcRef.current = window.Desmos.GraphingCalculator(hostRef.current, TEST_CONFIG);
      } else if (calcRef.current) {
        calcRef.current.resize();
      }
      setStatus('ready');
    });
    return () => { alive = false; };
  }, [open]);

  // destroy exactly once, when the match view goes away
  useEffect(() => () => {
    if (calcRef.current) {
      try { calcRef.current.destroy(); } catch { /* already gone */ }
      calcRef.current = null;
    }
  }, []);

  return (
    <aside
      ref={panelRef}
      className={`calc-panel${open ? ' open' : ''}`}
      aria-label="Desmos graphing calculator"
      aria-hidden={!open}
      onPointerMove={onDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="calc-head" onPointerDown={(e) => startDrag(e, 'move')}>
        <span>Desmos</span>
        <button
          type="button" onClick={onClose} aria-label="Close calculator"
          onPointerDown={(e) => e.stopPropagation()}
        >✕</button>
      </div>
      <div className="calc-host" ref={hostRef} />
      <div
        className="calc-grip" aria-hidden="true" title="Drag to resize"
        onPointerDown={(e) => startDrag(e, 'size')}
      />
      {status === 'failed' && (
        <p className="calc-fallback">
          Calculator unavailable — the Desmos script could not be loaded.
          Your duel is unaffected; answer as normal.
        </p>
      )}
      {status === 'loading' && <p className="calc-fallback">Loading calculator…</p>}
    </aside>
  );
}
