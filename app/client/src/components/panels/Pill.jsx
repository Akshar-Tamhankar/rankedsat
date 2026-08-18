import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useLeaderboard } from '../../lib/useGame.js';

/**
 * The expandable mini pill. Drag-scrolls with inertia and a rubber-band
 * overscroll, driven by the shared fx loop rather than its own rAF.
 *
 * The server exposes no presence feed, so this lists rated scholars from the
 * leaderboard plus you. Marked clearly as "on the board", not "online" —
 * inventing a fake presence list would be a lie in the UI.
 */
export default function Pill({ game, isOpen, fx }) {
  const board = useLeaderboard();
  const vpRef = useRef(null);
  const listRef = useRef(null);
  const pillRef = useRef({ y: 0, v: 0, min: 0, max: 0, active: false, dragging: false, lastY: 0, lastT: 0, el: null });

  const seen = new Map();
  [...(board.ela || []), ...(board.math || [])].forEach((p) => {
    if (!seen.has(p.name)) seen.set(p.name, p);
  });
  if (game.profile && !seen.has(game.profile.name)) {
    seen.set(game.profile.name, { name: game.profile.name, rating: game.profile.ratings.ela, games: 0 });
  }
  const people = [...seen.values()];

  // measure twice — once now, once after the .6s zone transition settles
  const measure = () => {
    const vp = vpRef.current;
    const list = listRef.current;
    const p = pillRef.current;
    if (!vp || !list) return;
    p.el = list;
    p.y = 0; p.v = 0;
    p.min = Math.min(0, vp.clientHeight - list.scrollHeight);
    p.max = 0;
    list.style.transform = 'translate3d(0,0,0)';
    if (fx && fx.current) fx.current.state.pill = p;
  };

  useLayoutEffect(() => {
    if (!isOpen) {
      if (fx && fx.current) fx.current.state.pill = null;
      return undefined;
    }
    measure();
    const t = setTimeout(measure, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, people.length]);

  const onDown = (e) => {
    const p = pillRef.current;
    p.dragging = true; p.active = true; p.v = 0;
    p.lastY = e.clientY; p.lastT = performance.now();
    vpRef.current.setPointerCapture(e.pointerId);
    if (fx && fx.current) fx.current.kick();
  };
  const onMove = (e) => {
    const p = pillRef.current;
    if (!p.dragging) return;
    const dy = e.clientY - p.lastY;
    const now = performance.now();
    const out = p.y > p.max || p.y < p.min ? 0.4 : 1;
    p.y += dy * out;
    p.v = (dy / Math.max(1, now - p.lastT)) * 16;
    p.lastY = e.clientY; p.lastT = now;
  };
  const onUp = () => {
    const p = pillRef.current;
    p.dragging = false;
    if (fx && fx.current) fx.current.kick();
  };
  const onWheel = (e) => {
    e.preventDefault();
    const p = pillRef.current;
    p.v = 0; p.active = true;
    p.y = Math.max(p.min - 40, Math.min(p.max + 40, p.y - e.deltaY * 0.6));
    if (fx && fx.current) fx.current.kick();
  };

  // non-passive wheel so preventDefault actually applies
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || !isOpen) return undefined;
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <>
      {!isOpen && (
        <div className="only-closed">
          <div className="pill-idle">
            <span className={`dot${game.connected ? '' : ' off'}`} data-tip="Connection|Live link to the hall." />
            <span className="n">{people.length}</span>
            <span className="lbl">On the board</span>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="only-open">
          <div className="p-head"><span>IV · Present</span><span className="rule" /></div>
          <h2 className="p-title foil">On the board</h2>
          <p className="p-sub">
            {people.length} {people.length === 1 ? 'scholar' : 'scholars'} ·{' '}
            {game.connected ? 'connected' : 'reconnecting…'}
          </p>
          <div
            className="who-viewport" ref={vpRef}
            onPointerDown={onDown} onPointerMove={onMove}
            onPointerUp={onUp} onPointerCancel={onUp}
          >
            <div className="who" ref={listRef}>
              {people.map((w) => (
                <div className="who-r" key={w.name}>
                  <span className={`st ${w.games > 0 ? 'q' : 'i'}`} />
                  <span className="nm">{w.name}</span>
                  <span className="mt">{w.games > 0 ? `${w.rating}` : 'unrated'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="drag-hint">Drag to scroll</div>
          <div style={{ marginTop: 10 }}>
            <button className="btn ghost" type="button" data-close>Back</button>
          </div>
        </div>
      )}
    </>
  );
}
