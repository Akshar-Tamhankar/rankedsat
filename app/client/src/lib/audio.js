/**
 * Synthesized UI sound. No audio files — oscillators and noise buffers only,
 * so nothing extra ships in the image.
 *
 * Browsers require a user gesture before an AudioContext may start, so the
 * context is created lazily on the first pointerdown/keydown.
 */

let AC = null;
let master = null;
let humGain = null;
let enabled = true;

export function unlock() {
  if (AC) {
    if (AC.state === 'suspended') AC.resume();
    return;
  }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  AC = new Ctor();
  master = AC.createGain();
  master.gain.value = 0.6;
  master.connect(AC.destination);

  // Low focus hum: looped noise through a lowpass, silent until asked for.
  const len = AC.sampleRate * 2;
  const buf = AC.createBuffer(1, len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = AC.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = AC.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 180;
  humGain = AC.createGain();
  humGain.gain.value = 0;
  src.connect(lp);
  lp.connect(humGain);
  humGain.connect(master);
  src.start();
}

export function setEnabled(on) {
  enabled = on;
  if (!on) hum(0);
}

function env(g, t0, attack, peak, decay) {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

let lastTick = 0;
export function tick() {
  if (!AC || !enabled) return;
  const now = performance.now();
  if (now - lastTick < 90) return;
  lastTick = now;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = 'triangle';
  o.frequency.value = 170;
  o.connect(g);
  g.connect(master);
  env(g, t, 0.004, 0.05, 0.06);
  o.start(t);
  o.stop(t + 0.09);
}

export function thump() {
  if (!AC || !enabled) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(96, t);
  o.frequency.exponentialRampToValueAtTime(62, t + 0.14);
  o.connect(g);
  g.connect(master);
  env(g, t, 0.006, 0.16, 0.18);
  o.start(t);
  o.stop(t + 0.22);
}

export function swoosh() {
  if (!AC || !enabled) return;
  const t = AC.currentTime;
  const len = Math.floor(AC.sampleRate * 0.22);
  const buf = AC.createBuffer(1, len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = AC.createBufferSource();
  src.buffer = buf;
  const bp = AC.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(520, t);
  bp.frequency.exponentialRampToValueAtTime(150, t + 0.2);
  const g = AC.createGain();
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  env(g, t, 0.008, 0.12, 0.19);
  src.start(t);
}

export function chord() {
  if (!AC || !enabled) return;
  const t = AC.currentTime;
  [98, 147, 196].forEach((f, i) => {
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    g.connect(master);
    env(g, t + i * 0.02, 0.05, 0.12, 0.7);
    o.start(t + i * 0.02);
    o.stop(t + 1);
  });
  const o2 = AC.createOscillator();
  const g2 = AC.createGain();
  o2.type = 'triangle';
  o2.frequency.value = 1175;
  o2.connect(g2);
  g2.connect(master);
  env(g2, t + 0.12, 0.004, 0.05, 0.3);
  o2.start(t + 0.12);
  o2.stop(t + 0.5);
}

/** Correct/incorrect nudge for the duel view — deliberately plain. */
export function blip(ok) {
  if (!AC || !enabled) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = 'sine';
  o.frequency.value = ok ? 660 : 220;
  o.connect(g);
  g.connect(master);
  env(g, t, 0.004, 0.07, 0.14);
  o.start(t);
  o.stop(t + 0.2);
}

export function hum(v) {
  if (!AC || !humGain) return;
  humGain.gain.cancelScheduledValues(AC.currentTime);
  humGain.gain.linearRampToValueAtTime(enabled ? v : 0, AC.currentTime + 0.35);
}
