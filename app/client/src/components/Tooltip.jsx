import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Gold-foil tooltip driven by [data-tip="Kicker|Body"] anywhere in the tree.
 *
 * Two bugs the first version had, both visible in a screenshot:
 *   - It positioned with a hard-coded 66px vertical offset, so any tooltip
 *     whose wrapped height wasn't 66px landed in the wrong place. It now
 *     measures its own box after render and positions from that.
 *   - It kept the tip alive when the target was UNMOUNTED (closing a panel
 *     removes the element without ever firing pointerout), leaving a tooltip
 *     stranded mid-screen. It now tracks the target node and hides as soon as
 *     the node leaves the document or moves.
 */
export default function Tooltip() {
  const [tip, setTip] = useState(null);
  const boxRef = useRef(null);
  const targetRef = useRef(null);

  useEffect(() => {
    let hideTimer = 0;
    const over = (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) return;
      clearTimeout(hideTimer);
      const raw = t.getAttribute('data-tip') || '';
      const [k, body = ''] = raw.split('|');
      targetRef.current = t;
      setTip({ k, body });
    };
    const out = (e) => {
      if (!(e.target.closest && e.target.closest('[data-tip]'))) return;
      hideTimer = setTimeout(() => { targetRef.current = null; setTip(null); }, 60);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    return () => {
      clearTimeout(hideTimer);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
    };
  }, []);

  // Measure the rendered box, then place it relative to the live target rect.
  useLayoutEffect(() => {
    if (!tip) return undefined;
    const place = () => {
      const t = targetRef.current;
      const box = boxRef.current;
      if (!t || !box) return;
      // target gone (panel closed / re-rendered) -> drop the tip
      if (!t.isConnected) { targetRef.current = null; setTip(null); return; }
      const r = t.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { targetRef.current = null; setTip(null); return; }
      const bw = box.offsetWidth;
      const bh = box.offsetHeight;
      const x = Math.max(10, Math.min(window.innerWidth - bw - 10, r.left + r.width / 2 - bw / 2));
      const above = r.top - bh - 12;
      const y = above >= 10 ? above : Math.min(window.innerHeight - bh - 10, r.bottom + 12);
      // direct style write — no React render for a position nudge
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    };
    place();
    // The camera keeps moving after the pointer stops, so the tip has to
    // track its target for a while. Writing style directly instead of going
    // through setState: the previous version re-rendered React 20x/sec for
    // the whole time a tooltip was visible, almost always to the same value.
    let n = 0;
    const id = setInterval(() => { place(); if (++n > 40) clearInterval(id); }, 60);
    window.addEventListener('resize', place);
    return () => { clearInterval(id); window.removeEventListener('resize', place); };
  }, [tip]);

  if (!tip) return null;
  // starts offscreen; the layout effect places it before paint
  return (
    <div className="tooltip show" ref={boxRef} style={{ left: -9999, top: -9999 }}>
      <span className="tt-k">{tip.k}</span>
      {tip.body}
    </div>
  );
}
