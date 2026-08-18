/**
 * Generated decorative SVG. Everything here is drawn from code — no image
 * assets, so the container stays self-contained and works offline.
 *
 * Paper fills are deliberately DARKER than any glass panel: the papers are
 * the hall, the panels sit on top of it. v2 of the prototype had this
 * inverted and the papers stole the composition.
 */

function wiggle(x0, y, w, amp, segs) {
  let p = 'M' + x0 + ' ' + y;
  let x = x0;
  const dx = w / segs;
  for (let i = 0; i < segs; i++) {
    x += dx;
    p += ` q${dx / 2} ${((Math.random() * 2 - 1) * amp).toFixed(1)} ${dx} 0`;
  }
  return p;
}

function scribbleRows(x, y0, w, rows, gap, color, op) {
  let out = '';
  for (let i = 0; i < rows; i++) {
    const wl = w * (0.55 + Math.random() * 0.45);
    out += `<path d="${wiggle(x, y0 + i * gap, wl, 1.6, Math.max(4, Math.round(wl / 22)))}" fill="none" stroke="${color}" stroke-width="1.1" opacity="${op}" stroke-linecap="round"/>`;
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Real SAT stem prose set on the ruled lines. Falls back to the handwriting
 * scribbles when no text is available (offline, or the gate rejected us), so
 * the decor never renders blank.
 */
function bodyRows(x, y0, w, rows, gap, text, color, op) {
  if (!text) return scribbleRows(x, y0, w, rows, gap, color, op);
  const size = Math.min(8.2, Math.max(5.4, gap * 0.52));
  const maxChars = Math.max(10, Math.floor(w / (size * 0.46)));
  return wrapText(text, maxChars)
    .slice(0, rows)
    .map((ln, i) =>
      `<text x="${x}" y="${y0 + i * gap}" font-family="Georgia,'Times New Roman',serif" font-size="${size.toFixed(1)}" fill="${color}" opacity="${op}" xml:space="preserve">${esc(ln)}</text>`)
    .join('');
}

function tornEdge(w, h, jag) {
  const pts = [];
  const n = Math.round(w / 26);
  pts.push('0 ' + (jag + Math.random() * jag));
  for (let i = 1; i <= n; i++) {
    pts.push(`${((w * i) / n).toFixed(0)} ${(Math.random() * jag * 2).toFixed(1)}`);
  }
  pts.push(`${w} ${h}`);
  pts.push(`0 ${h}`);
  return 'M' + pts.join(' L') + ' Z';
}

export function ruledCard(w, h, opts = {}, text) {
  let rules = '';
  for (let y = 26; y < h - 8; y += 15) {
    rules += `<line x1="5" y1="${y}" x2="${w - 5}" y2="${y}" stroke="rgba(80,110,150,.30)" stroke-width="1"/>`;
  }
  let s =
    `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${w}" height="${h}" rx="3" fill="#d6c9a8"/>` +
    `<rect width="${w}" height="${h}" rx="3" fill="none" stroke="rgba(42,32,24,.30)"/>` +
    rules +
    `<line x1="16" y1="4" x2="16" y2="${h - 4}" stroke="rgba(160,60,60,.4)" stroke-width="1.2"/>` +
    bodyRows(22, 24, w - 42, Math.floor((h - 40) / 15), 15, text, '#3a3050', 0.62);
  if (opts.ring) {
    s += `<circle cx="${w - 34}" cy="${h - 30}" r="17" fill="none" stroke="rgba(124,80,40,.28)" stroke-width="4.5"/>`;
  }
  if (opts.tape) {
    s += `<rect x="${w / 2 - 26}" y="-8" width="52" height="17" rx="2" fill="rgba(230,224,200,.55)" transform="rotate(-2 ${w / 2} 0)"/>`;
  }
  return s + '</svg>';
}

export function graphCard(w, h, text) {
  let grid = '';
  for (let i = 10; i < w; i += 12) grid += `<line x1="${i}" y1="6" x2="${i}" y2="${h - 6}" stroke="rgba(90,120,90,.16)"/>`;
  for (let i = 10; i < h; i += 12) grid += `<line x1="6" y1="${i}" x2="${w - 6}" y2="${i}" stroke="rgba(90,120,90,.16)"/>`;
  const cx = w / 2;
  const cy = h * 0.72;
  const a = 0.011;
  let para = `M${cx - 70} ${cy - a * 70 * 70 * 10}`;
  for (let i = -70; i <= 70; i += 10) para += ` L${cx + i} ${(cy - a * i * i * 10).toFixed(1)}`;
  return (
    `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${w}" height="${h}" rx="3" fill="#cfc7ab"/>` +
    `<rect width="${w}" height="${h}" rx="3" fill="none" stroke="rgba(42,32,24,.25)"/>` +
    grid +
    `<line x1="12" y1="${cy}" x2="${w - 12}" y2="${cy}" stroke="rgba(42,32,24,.4)"/>` +
    `<line x1="${cx}" y1="10" x2="${cx}" y2="${h - 10}" stroke="rgba(42,32,24,.4)"/>` +
    `<path d="${para}" fill="none" stroke="rgba(124,45,45,.6)" stroke-width="1.6"/>` +
    bodyRows(14, 20, w - 70, 3, 11, text, '#3a3050', 0.6) +
    `<ellipse cx="${w - 48}" cy="24" rx="34" ry="12" fill="none" stroke="rgba(124,45,45,.45)" stroke-width="1.2" transform="rotate(-4 ${w - 48} 24)"/>` +
    '</svg>'
  );
}

export function tornSheet(w, h, text) {
  return (
    `<svg viewBox="0 -4 ${w} ${h + 4}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${tornEdge(w, h, 5)}" fill="#c9bc9e" stroke="rgba(42,32,24,.26)"/>` +
    bodyRows(14, 30, w - 30, Math.floor((h - 46) / 14), 14, text, '#2f2a3e', 0.58) +
    `<ellipse cx="${w * 0.78}" cy="${h * 0.8}" rx="9" ry="6" fill="rgba(35,30,55,.5)"/>` +
    `<ellipse cx="${w * 0.78 + 9}" cy="${h * 0.8 + 6}" rx="3" ry="2" fill="rgba(35,30,55,.45)"/>` +
    '</svg>'
  );
}

export function stampMark(size) {
  return (
    `<svg viewBox="0 0 120 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs><path id="stc" d="M60 16 a44 44 0 1 1 -0.01 0"/></defs>' +
    '<circle cx="60" cy="60" r="55" fill="none" stroke="rgba(124,45,45,.55)" stroke-width="2"/>' +
    '<circle cx="60" cy="60" r="40" fill="none" stroke="rgba(124,45,45,.5)" stroke-width="1"/>' +
    '<text font-family="Georgia,serif" font-size="12.5" letter-spacing="4" fill="rgba(124,45,45,.6)">' +
    '<textPath href="#stc">EX LIBRIS · RANKEDSAT · MMXXVI ·</textPath></text>' +
    '<path d="M45 60 l10 10 l20 -22" fill="none" stroke="rgba(124,45,45,.55)" stroke-width="2.4" stroke-linecap="round"/>' +
    '</svg>'
  );
}

export function twine(w, h) {
  return (
    `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M8 10 C ${w * 0.3} ${h * 0.9}, ${w * 0.7} ${h * 0.1}, ${w - 8} ${h - 10}" fill="none" stroke="rgba(179,146,79,.5)" stroke-width="1.6"/>` +
    '<circle cx="8" cy="10" r="5" fill="#8a3030"/><circle cx="8" cy="10" r="2" fill="#c96a5a"/>' +
    `<circle cx="${w - 8}" cy="${h - 10}" r="5" fill="#8a3030"/><circle cx="${w - 8}" cy="${h - 10}" r="2" fill="#c96a5a"/>` +
    '</svg>'
  );
}

export function quill(size) {
  return (
    `<svg viewBox="0 0 120 120" width="${size}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="rgba(179,146,79,.55)" stroke-width="1.6">` +
    '<path d="M22 104 C 40 60, 74 26, 104 12 C 92 44, 66 84, 34 100 Z" stroke-linejoin="round"/>' +
    '<path d="M28 100 C 52 72, 78 42, 100 18" stroke-width="1"/>' +
    '<path d="M22 104 l-8 10" stroke-width="2"/>' +
    '</svg>'
  );
}

function laurelBranch(mirror) {
  const R = 150;
  let out = '';
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const a = ((100 + t * 145) * Math.PI) / 180;
    const x = 190 + Math.cos(a) * R;
    const y = 190 + Math.sin(a) * R;
    const rot = (a * 180) / Math.PI + 108;
    const len = 20 - t * 7;
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${len.toFixed(1)}" ry="6.4" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    if (i < 10) {
      const a2 = a + 0.072;
      const x2 = 190 + Math.cos(a2) * (R * 0.82);
      const y2 = 190 + Math.sin(a2) * (R * 0.82);
      out += `<ellipse cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" rx="${(len * 0.78).toFixed(1)}" ry="5.2" transform="rotate(${(rot + 16).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)})"/>`;
    }
  }
  const sx = (190 + Math.cos((100 * Math.PI) / 180) * R).toFixed(1);
  const sy = (190 + Math.sin((100 * Math.PI) / 180) * R).toFixed(1);
  const ex = (190 + Math.cos((245 * Math.PI) / 180) * R).toFixed(1);
  const ey = (190 + Math.sin((245 * Math.PI) / 180) * R).toFixed(1);
  return (
    `<g${mirror ? ' transform="scale(-1,1) translate(-380,0)"' : ''}>` +
    `<path d="M${sx} ${sy} A${R} ${R} 0 0 0 ${ex} ${ey}" fill="none" stroke="currentColor" stroke-width="2.2" opacity=".75"/>` +
    `<g fill="currentColor" opacity=".9">${out}</g></g>`
  );
}

export function wreath() {
  return `<svg viewBox="0 0 380 380" width="100%" height="100%">${laurelBranch(false)}${laurelBranch(true)}</svg>`;
}

export function ornament() {
  let s = '<svg viewBox="0 0 260 260" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.5">';
  for (let i = 0; i < 12; i++) {
    s += `<ellipse cx="130" cy="130" rx="118" ry="34" transform="rotate(${i * 30} 130 130)"/>`;
  }
  return s + '<circle cx="130" cy="130" r="46"/><circle cx="130" cy="130" r="118"/></svg>';
}

export function cornerBracket() {
  return (
    '<svg viewBox="0 0 74 74" fill="none" stroke="#b3924f" stroke-width="1.4">' +
    '<path d="M2 26V2h24"/><path d="M9 33V9h24"/>' +
    '<circle cx="16.5" cy="16.5" r="2.6" fill="#b3924f" stroke="none"/></svg>'
  );
}

/**
 * Scatter list: [layer, make(text), left%, top%, width%, rotateDeg, extraStyle]
 * `make` receives one real SAT stem (or undefined -> scribble fallback).
 */
export const DECOR_ITEMS = [
  ['far', (t) => tornSheet(240, 180, t), 40, 66, 14, -5, { opacity: 0.4 }],
  ['far', (t) => ruledCard(220, 130, {}, t), 2.2, 2.5, 12, -7, { opacity: 0.42 }],
  ['far', () => stampMark(110), 47, 6, 7, -12, { opacity: 0.55, filter: 'none' }],
  ['mid', (t) => graphCard(230, 160, t), 68.5, 61, 13, 4, { opacity: 0.68 }],
  ['mid', (t) => ruledCard(210, 140, { ring: true, tape: true }, t), 71, 80, 12, -3, { opacity: 0.68 }],
  ['mid', () => twine(320, 90), 63, 52, 18, 0, { opacity: 0.7, filter: 'none' }],
  ['near', (t) => tornSheet(200, 150, t), 0.8, 46, 10, 6, { opacity: 0.6 }],
  ['near', (t) => ruledCard(190, 120, { tape: true }, t), 44, 2, 10.5, 3, { opacity: 0.6 }],
  ['near', () => quill(96), 55.5, 44, 6, 14, { opacity: 0.6, filter: 'none' }],
];
