import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createFx, REDUCED } from '../lib/fx.js';
import * as snd from '../lib/audio.js';
import {
  DECOR_ITEMS, wreath, ornament, cornerBracket,
} from '../lib/decor.js';
import Zone from './Zone.jsx';
import Placard from './panels/Placard.jsx';
import Decal from './panels/Decal.jsx';
import Board from './panels/Board.jsx';
import Pill from './panels/Pill.jsx';
import Hud from './Hud.jsx';

/**
 * Which zone is the pointer leaning toward?
 *
 * Tested against the zones' IDLE rects, in screen space, always — never
 * against their live DOM boxes. That matters: the camera transform moves the
 * panels, so hover-based focus fed the camera's own output back into its
 * input. Near a boundary that oscillates (zoom in -> panel slides out from
 * under the cursor -> leave -> zoom out -> enter -> ...). Hit-testing fixed
 * geometry makes the camera a pure output and the loop cannot form.
 *
 * ENTER_M is a generous reach so you don't have to be precise; HOLD_M is
 * extra slack applied only to the zone you are already on, giving proper
 * hysteresis so a small jitter never flips the focus.
 */
const ENTER_M = 78;
const HOLD_M = 70;

/**
 * CPU-compositing mode (desktop shell appends ?gpu=software). Parallax and
 * tilt each re-composite full-screen layers every pointer frame, which is
 * cheap on a GPU and brutal without one — so they're switched off entirely
 * rather than merely styled away.
 */
const LOW_PERF = (() => {
  try { return new URLSearchParams(window.location.search).get('gpu') === 'software'; }
  catch { return false; }
})();

function pickZone(x, y, layout, current) {
  let best = null;
  let bestD = Infinity;
  for (const k of Object.keys(layout)) {
    const r = layout[k].rect;
    const m = ENTER_M + (k === current ? HOLD_M : 0);
    if (x < r[0] - m || x > r[0] + r[2] + m) continue;
    if (y < r[1] - m || y > r[1] + r[3] + m) continue;
    // normalised distance to centre so overlapping reaches resolve to the
    // zone you're most clearly over rather than to whichever came first
    const cx = r[0] + r[2] / 2;
    const cy = r[1] + r[3] / 2;
    const dx = (x - cx) / (r[2] / 2 + m);
    const dy = (y - cy) / (r[3] / 2 + m);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/** Zone rects as fractions of the viewport, recomputed on resize. */
function computeLayout(w, h) {
  const m = Math.round(0.055 * w);
  const pw = Math.max(96, Math.round(0.055 * w));
  return {
    placard: {
      rect: [m, Math.round(0.1 * h), Math.round(0.335 * w), Math.round(0.36 * h)],
      // tall enough that the Study tab's filters + mode buttons all fit
      // without scrolling — burying the entry point made it unfindable
      open: [m, Math.round(0.05 * h), Math.round(0.46 * w), Math.round(0.88 * h)],
    },
    // Heights are floored in px, not left purely proportional: at 0.14*h the
    // board's 31px figures were clipped mid-glyph on short viewports.
    decal: {
      rect: [m, Math.round(0.565 * h), Math.round(0.585 * w), Math.max(112, Math.round(0.15 * h))],
      open: [Math.round(0.18 * w), Math.round(0.12 * h), Math.round(0.56 * w), Math.round(0.66 * h)],
    },
    board: {
      rect: [m, Math.round(0.755 * h), Math.round(0.585 * w), Math.max(146, Math.round(0.185 * h))],
      open: [Math.round(0.17 * w), Math.round(0.1 * h), Math.round(0.56 * w), Math.round(0.72 * h)],
    },
    pill: {
      rect: [w - pw - Math.round(0.02 * w) - 14, Math.round(0.28 * h), pw, Math.round(0.46 * h)],
      // tall enough that the header/footer leave real room for the scroll list
      open: [Math.round(0.42 * w), Math.round(0.12 * h), Math.round(0.36 * w), Math.round(0.74 * h)],
    },
  };
}

export default function Hall({ game, prefs, setPrefs, onEnterMatch }) {
  const stageRef = useRef(null);
  const layersRef = useRef({});
  const zoneRefs = useRef({});
  const fxRef = useRef(null);

  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [focused, setFocused] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [fps, setFps] = useState(0);
  // real SAT stems used as the handwriting on the paper decor
  const [snippets, setSnippets] = useState([]);

  useEffect(() => {
    let alive = true;
    fetch('/api/decor')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive && Array.isArray(d)) setSnippets(d); })
      .catch(() => { /* falls back to scribbles */ });
    return () => { alive = false; };
  }, []);

  const layout = useMemo(() => computeLayout(size.w, size.h), [size]);

  // refs so the single pointermove handler always sees current values without
  // being torn down and re-bound on every focus change
  const layoutRef = useRef(layout);
  const openKeyRef = useRef(null);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { openKeyRef.current = openKey; }, [openKey]);

  // ---- fx engine ----------------------------------------------------------
  useLayoutEffect(() => {
    const fx = createFx();
    fxRef.current = fx;
    // Read the viewport from fx.state, NOT from the React `size` closure —
    // this callback is installed once, so a captured `size` would go stale on
    // the first resize and the camera would centre on the old dimensions.
    fx.state.onCam = (cam) => {
      const el = stageRef.current;
      if (!el) return;
      const x = fx.state.vw / 2 - cam.cx * cam.s;
      const y = fx.state.vh / 2 - cam.cy * cam.s;
      el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${cam.s.toFixed(4)})`;
    };
    fx.state.onPar = (px, py) => {
      if (LOW_PERF) return;      // 3 full-screen layer composites per frame
      const L = layersRef.current;
      const depths = { far: 8, mid: 17, near: 28 };
      Object.keys(depths).forEach((k) => {
        const el = L[k];
        if (el) el.style.transform = `translate3d(${(-px * depths[k]).toFixed(2)}px,${(-py * depths[k]).toFixed(2)}px,0)`;
      });
    };
    fx.state.onFoil = (pct) => {
      document.documentElement.style.setProperty('--foilx', pct.toFixed(1) + '%');
    };
    fx.state.onFps = setFps;
    fx.resize(window.innerWidth, window.innerHeight);
    fx.state.cam.cx = fx.state.tgt.cx = window.innerWidth / 2;
    fx.state.cam.cy = fx.state.tgt.cy = window.innerHeight / 2;
    fx.state.cam.s = fx.state.tgt.s = 1;
    fx.state.onCam(fx.state.cam);   // paint frame zero without waiting for rAF
    fx.kick();
    return () => fx.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // resize
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setSize({ w, h });
      const fx = fxRef.current;
      if (fx) fx.resize(w, h);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Pointer drives fx, focus and tilt from ONE handler, all off fixed geometry.
  const focusedRef = useRef(null);
  useEffect(() => { focusedRef.current = focused; }, [focused]);

  useEffect(() => {
    const onMove = (e) => {
      const fx = fxRef.current;
      if (fx) fx.pointer(e.clientX, e.clientY);
      if (openKeyRef.current) return;

      const pick = pickZone(e.clientX, e.clientY, layoutRef.current, focusedRef.current);
      if (pick !== focusedRef.current) {
        focusedRef.current = pick;
        setFocused(pick);
        if (pick) { snd.tick(); snd.hum(0.012); } else snd.hum(0);
      }

      if (!fx || LOW_PERF) return;
      if (pick && !REDUCED) {
        const z = zoneRefs.current[pick];
        const r = layoutRef.current[pick].rect;
        if (z && z.panel) fx.setTilt(z.panel, z.shadow);
        fx.aimTilt(
          Math.max(-0.5, Math.min(0.5, (e.clientX - (r[0] + r[2] / 2)) / r[2])),
          Math.max(-0.5, Math.min(0.5, (e.clientY - (r[1] + r[3] / 2)) / r[3])),
        );
      } else {
        fx.releaseTilt();
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // audio unlock on first gesture
  useEffect(() => {
    const un = () => snd.unlock();
    window.addEventListener('pointerdown', un);
    window.addEventListener('keydown', un);
    return () => { window.removeEventListener('pointerdown', un); window.removeEventListener('keydown', un); };
  }, []);

  // prefs -> fx / body classes
  useEffect(() => {
    const fx = fxRef.current;
    if (fx) { fx.setAmbient(prefs.ambient); fx.setFps(prefs.fps); }
    snd.setEnabled(prefs.sound);
    document.body.classList.toggle('no-blur', !prefs.blur);
    document.body.classList.toggle('no-ambient', !prefs.ambient);
  }, [prefs]);

  // camera retarget whenever focus/open/layout changes
  useEffect(() => {
    const fx = fxRef.current;
    if (!fx) return;
    const key = openKey || focused;
    const t = fx.state.tgt;
    if (!key) {
      t.cx = size.w / 2; t.cy = size.h / 2; t.s = 1;
    } else {
      const r = openKey ? layout[key].open : layout[key].rect;
      const zx = r[0] + r[2] / 2;
      const zy = r[1] + r[3] / 2;
      const pad = 46;
      const fit = Math.max(1.02, Math.min(Math.min(size.w / (r[2] + pad), size.h / (r[3] + pad)), 2.1));
      if (openKey) {
        t.cx = zx; t.cy = zy; t.s = fit;
      } else {
        // lean is capped below every open scale so committing always zooms IN
        t.s = Math.min(1.12, 1 + (fit - 1) * 0.2);
        t.cx = size.w / 2 + (zx - size.w / 2) * 0.5;
        t.cy = size.h / 2 + (zy - size.h / 2) * 0.5;
      }
    }
    fx.kick();
  }, [focused, openKey, layout, size]);

  useEffect(() => {
    document.body.classList.toggle('focused', !!(focused || openKey));
    document.body.classList.toggle('opened', !!openKey);
  }, [focused, openKey]);

  // ---- zone interaction ---------------------------------------------------
  // Keyboard-only focus. Pointer focus is handled entirely by the pointermove
  // hit-test above, so these are NOT wired to pointerenter/leave any more.
  const enter = useCallback((key) => {
    if (openKeyRef.current) return;
    focusedRef.current = key;
    setFocused(key);
    snd.tick();
  }, []);

  const leave = useCallback((key) => {
    if (openKeyRef.current) return;
    setFocused((f) => (f === key ? null : f));
  }, []);

  const open = useCallback((key) => {
    openKeyRef.current = key;
    setOpenKey(key);
    setFocused(key);
    const fx = fxRef.current;
    if (fx) fx.releaseTilt();
    snd.thump();
  }, []);

  const close = useCallback(() => {
    openKeyRef.current = null;
    setOpenKey(null);
    setFocused(null);
    focusedRef.current = null;
    snd.swoosh();
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const registerZone = useCallback((key, refs) => { zoneRefs.current[key] = refs; }, []);

  const zoneProps = (key) => ({
    zKey: key,
    rect: openKey === key ? layout[key].open : layout[key].rect,
    isOpen: openKey === key,
    isFocus: focused === key && !openKey,
    onEnter: enter, onLeave: leave, onOpen: open, onClose: close,
    register: registerZone,
  });

  return (
    <div
      className="viewport"
      onClick={(e) => { if (!e.target.closest('.zone')) close(); }}
    >
      <div className="stage" ref={stageRef} style={{ width: size.w, height: size.h }}>
        <div className="bg">
          <div className="bg-base" />
          <div className="scrap s1" /><div className="scrap s2" />
          <div className="scrap s3" /><div className="scrap s4" />
          <div className="bg-grain" />
        </div>

        {/* 3 parallax layers, not 5 — each is a full-viewport composited
            layer, so merging the watermarks and crest into the far/mid
            layers drops 2 screens of permanently-held GPU memory. */}
        <div className="plax" ref={(el) => { layersRef.current.far = el; }}>
          {DECOR_ITEMS.map((d, i) => (d[0] === 'far'
            ? <DecorItem key={i} item={d} snippet={snippets[i % (snippets.length || 1)]} />
            : null))}
          <div className="watermark wm-tl">
            <div className="wm-spin" dangerouslySetInnerHTML={{ __html: ornament() }} />
          </div>
          <div className="watermark wm-br">
            <div className="wm-spin" dangerouslySetInnerHTML={{ __html: ornament() }} />
          </div>
        </div>

        <div className="plax" ref={(el) => { layersRef.current.mid = el; }}>
          {DECOR_ITEMS.map((d, i) => (d[0] === 'mid'
            ? <DecorItem key={i} item={d} snippet={snippets[i % (snippets.length || 1)]} />
            : null))}
          <Crest w={size.w} h={size.h} />
        </div>

        <div className="plax" ref={(el) => { layersRef.current.near = el; }}>
          {DECOR_ITEMS.map((d, i) => (d[0] === 'near'
            ? <DecorItem key={i} item={d} snippet={snippets[i % (snippets.length || 1)]} />
            : null))}
        </div>

        <div className="frame" />
        {['tl', 'tr', 'bl', 'br'].map((c) => (
          <div key={c} className={`corner ${c}`} dangerouslySetInnerHTML={{ __html: cornerBracket() }} />
        ))}

        <Zone {...zoneProps('placard')} label="Queue for a duel">
          <Placard game={game} onEnterMatch={onEnterMatch} isOpen={openKey === 'placard'} />
        </Zone>
        <Zone {...zoneProps('decal')} label="Past practice sessions">
          <Decal isOpen={openKey === 'decal'} game={game} />
        </Zone>
        <Zone {...zoneProps('board')} label="Ratings and leaderboard">
          <Board game={game} isOpen={openKey === 'board'} />
        </Zone>
        <Zone {...zoneProps('pill')} label="Who is in the hall">
          <Pill game={game} isOpen={openKey === 'pill'} fx={fxRef} />
        </Zone>
      </div>

      <div className="vignette" />
      <div className="fog"><i /><i /><i /></div>
      <div className="scan" />

      <div className="hint-bar">Lean toward a panel · click to open · Esc to step back</div>
      <Hud fps={fps} prefs={prefs} setPrefs={setPrefs} />
    </div>
  );
}

function DecorItem({ item, snippet }) {
  const [, make, left, top, width, rot, extra] = item;
  const text = snippet && snippet.text;
  // regenerate only when the text arrives, not on every render — the
  // generators use Math.random for torn edges and would otherwise reshuffle
  const html = useMemo(() => make(text), [make, text]);
  return (
    <div
      className="decor-item"
      style={{ left: left + '%', top: top + '%', width: width + '%', transform: `rotate(${rot}deg)`, ...extra }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Crest({ w, h }) {
  const size = Math.min(0.3 * w, 0.52 * h);
  const html = useMemo(() => wreath(), []);
  return (
    <div
      className="crest"
      style={{ width: size, height: size, left: 0.625 * w - size / 2, top: 0.315 * h - size / 2 }}
    >
      <div className="wreath" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="crest-in">
        <div className="mono">RS</div>
        <div className="motto">Disce · Certa · Vince</div>
      </div>
    </div>
  );
}
