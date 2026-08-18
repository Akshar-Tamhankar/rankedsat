/**
 * The single rAF loop that drives every continuous effect: camera, parallax,
 * panel tilt, foil highlight, pill inertia, and the particle canvas.
 *
 * One loop, not one-per-effect. It parks itself when nothing is moving, so an
 * idle hall costs zero frames.
 *
 * The canvas dust-mote / cursor-trail system was removed: at low density it
 * was invisible, at high density it read as a starfield, and either way it
 * fought the paper-collage look. The hall's depth now comes from parallax,
 * the decor layers and the vignette instead.
 */

export const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createFx() {
  const state = {
    vw: 1, vh: 1,
    ambient: true,
    running: false,
    rafId: 0,
    fpsOn: true,
    fps: 0,
    onFps: null,

    // pointer
    px: 0, py: 0, pointerDirty: false,

    // camera
    cam: { cx: 0, cy: 0, s: 1 },
    tgt: { cx: 0, cy: 0, s: 1 },
    onCam: null,

    // parallax
    par: { x: 0, y: 0, tx: 0, ty: 0 },
    onPar: null,

    // foil sweep position (0-100)
    onFoil: null,

    // tilt
    tiltEl: null, shadowEl: null,
    tilt: { x: 0, y: 0, tx: 0, ty: 0, sx: 0, sy: 10, stx: 0, sty: 10 },

    // pill inertia
    pill: null,
  };

  let frames = 0;
  let lastFpsAt = 0;

  function resize(vw, vh) {
    state.vw = vw;
    state.vh = vh;
  }

  function pointer(x, y) {
    state.px = x;
    state.py = y;
    state.par.tx = (x / state.vw - 0.5) * 2;
    state.par.ty = (y / state.vh - 0.5) * 2;
    state.pointerDirty = true;
    kick();
  }

  function loop(now) {
    state.running = true;
    let active = false;

    // camera
    const k = REDUCED ? 1 : 0.18;
    const c = state.cam, t = state.tgt;
    c.cx += (t.cx - c.cx) * k;
    c.cy += (t.cy - c.cy) * k;
    c.s += (t.s - c.s) * k;
    const camMoving =
      Math.abs(t.cx - c.cx) > 0.25 || Math.abs(t.cy - c.cy) > 0.25 || Math.abs(t.s - c.s) > 0.0004;
    if (!camMoving) { c.cx = t.cx; c.cy = t.cy; c.s = t.s; }
    if (state.onCam) state.onCam(c);
    active = active || camMoving;

    // parallax + foil
    if (!REDUCED) {
      const p = state.par;
      p.x += (p.tx - p.x) * 0.06;
      p.y += (p.ty - p.y) * 0.06;
      const parMoving = Math.abs(p.tx - p.x) > 0.002 || Math.abs(p.ty - p.y) > 0.002;
      if ((parMoving || state.pointerDirty) && state.onPar) state.onPar(p.x, p.y);
      active = active || parMoving;
    }
    if (state.pointerDirty) {
      state.pointerDirty = false;
      if (state.onFoil) state.onFoil((state.px / state.vw) * 100);
    }

    // tilt
    if (state.tiltEl && !REDUCED) {
      const ti = state.tilt;
      ti.x += (ti.tx - ti.x) * 0.18;
      ti.y += (ti.ty - ti.y) * 0.18;
      ti.sx += (ti.stx - ti.sx) * 0.18;
      ti.sy += (ti.sty - ti.sy) * 0.18;
      state.tiltEl.style.transform =
        `perspective(950px) rotateX(${ti.x.toFixed(2)}deg) rotateY(${ti.y.toFixed(2)}deg)`;
      if (state.shadowEl) {
        state.shadowEl.style.transform = `translate3d(${ti.sx.toFixed(1)}px,${ti.sy.toFixed(1)}px,0)`;
      }
      const settled = Math.abs(ti.tx - ti.x) < 0.02 && Math.abs(ti.ty - ti.y) < 0.02;
      if (!settled) active = true;
      // when target is zero and we've settled, release the element
      if (settled && ti.tx === 0 && ti.ty === 0 && state.tiltReleasing) {
        state.tiltEl.style.transform = '';
        if (state.shadowEl) state.shadowEl.style.transform = 'translate3d(0,10px,0)';
        state.tiltEl = null;
        state.shadowEl = null;
        state.tiltReleasing = false;
      }
    }

    // pill inertia
    if (state.pill && state.pill.active) { stepPill(state.pill); active = true; }

    if (state.fpsOn) {
      frames++;
      if (!lastFpsAt) lastFpsAt = now;
      if (now - lastFpsAt >= 500) {
        state.fps = Math.round((frames * 1000) / (now - lastFpsAt));
        if (state.onFps) state.onFps(state.fps);
        frames = 0;
        lastFpsAt = now;
      }
      active = true;
    }

    if (active) state.rafId = requestAnimationFrame(loop);
    else state.running = false;
  }

  function stepPill(pill) {
    if (!pill.dragging) {
      pill.v *= 0.94;
      pill.y += pill.v;
      if (pill.y > pill.max) { pill.y += (pill.max - pill.y) * 0.18; pill.v *= 0.6; }
      if (pill.y < pill.min) { pill.y += (pill.min - pill.y) * 0.18; pill.v *= 0.6; }
      const settled =
        Math.abs(pill.v) < 0.05 && pill.y <= pill.max + 0.4 && pill.y >= pill.min - 0.4;
      if (settled) {
        pill.y = Math.max(pill.min, Math.min(pill.max, pill.y));
        pill.active = false;
      }
    }
    if (pill.el) pill.el.style.transform = `translate3d(0,${pill.y.toFixed(1)}px,0)`;
  }

  function kick() {
    if (!state.running) state.rafId = requestAnimationFrame(loop);
  }

  function setTilt(panelEl, shadowEl) {
    state.tiltEl = panelEl;
    state.shadowEl = shadowEl;
    state.tiltReleasing = false;
    kick();
  }
  function releaseTilt() {
    state.tilt.tx = 0;
    state.tilt.ty = 0;
    state.tilt.stx = 0;
    state.tilt.sty = 10;
    state.tiltReleasing = true;
    kick();
  }
  function aimTilt(nx, ny) {
    state.tilt.tx = -ny * 5;
    state.tilt.ty = nx * 6.5;
    state.tilt.stx = -nx * 18;
    state.tilt.sty = 10 - ny * 13;
  }

  function setAmbient(on) {
    state.ambient = on;
    kick();
  }

  function destroy() {
    cancelAnimationFrame(state.rafId);
    state.running = false;
  }

  return {
    state, resize, pointer, kick, setTilt, releaseTilt, aimTilt,
    setAmbient, destroy,
    setFps(on) { state.fpsOn = on; frames = 0; lastFpsAt = 0; kick(); },
  };
}
