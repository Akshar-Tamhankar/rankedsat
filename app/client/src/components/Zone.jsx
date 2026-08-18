import React, { useEffect, useRef } from 'react';

/**
 * One dormant panel in the hall.
 *
 * Two hard rules learned from the prototype, both about backdrop-filter:
 *   1. NEVER put `opacity` on the zone. An ancestor opacity isolates the
 *      backdrop group and silently kills backdrop-filter on the panel inside,
 *      which reads as the glass turning into a sharp see-through ghost.
 *      Dimming is done by .dimmer, INSIDE the panel.
 *   2. NEVER put `perspective` on the zone, for the same reason. The tilt
 *      transform carries its own perspective() function instead.
 */
export default function Zone({
  zKey, rect, isOpen, isFocus, label, children,
  onEnter, onLeave, onOpen, onClose, register,
}) {
  const elRef = useRef(null);
  const panelRef = useRef(null);
  const shadowRef = useRef(null);

  useEffect(() => {
    register(zKey, { el: elRef.current, panel: panelRef.current, shadow: shadowRef.current });
  }, [zKey, register]);

  // release any lingering keyboard focus ring when the zone closes
  useEffect(() => {
    if (!isOpen && elRef.current && document.activeElement === elRef.current) elRef.current.blur();
  }, [isOpen]);

  const cls = ['zone', isOpen ? 'is-open' : '', isFocus ? 'is-focus' : ''].filter(Boolean).join(' ');

  return (
    <div
      ref={elRef}
      className={cls}
      tabIndex={0}
      role="button"
      aria-label={label}
      aria-expanded={isOpen}
      style={{ left: rect[0], top: rect[1], width: rect[2], height: rect[3] }}
      onFocus={() => onEnter(zKey)}
      onBlur={() => onLeave(zKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(zKey); }
      }}
      onClick={(e) => {
        if (e.target.closest('[data-close]')) { onClose(); return; }
        if (isOpen) return;
        if (e.target.closest('input,button,label,textarea,select,a')) return;
        onOpen(zKey);
      }}
    >
      <div className="zglow" />
      <div className="zshadow" ref={shadowRef} />
      <div className="panel" ref={panelRef}>
        <div className="sheen" />
        {children}
        <div className="dimmer" />
      </div>
    </div>
  );
}
