/**
 * Lazy loader for the Desmos graphing calculator.
 *
 * Desmos ships as a hosted script, not an npm package, so this is the one
 * runtime dependency in the app that is NOT baked into the container image.
 * Consequences worth knowing:
 *   - A Desmos match needs outbound internet. If the script cannot load, the
 *     panel shows a fallback notice and the duel continues uninterrupted —
 *     it never blocks play.
 *   - The key below is Desmos's public demo API key from their published
 *     docs. Fine for local testing; for production get your own key from
 *     desmos.com/api and check their terms.
 *
 * Concurrent callers share one in-flight load: every caller gets the same
 * resolution rather than each appending its own <script>.
 */

const DESMOS_URL =
  'https://www.desmos.com/api/v1.11/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6';

let status = 'unloaded'; // unloaded | loading | ready | failed
let waiters = [];

export function desmosStatus() {
  return window.Desmos ? 'ready' : status;
}

export function loadDesmos() {
  return new Promise((resolve) => {
    if (window.Desmos) { status = 'ready'; return resolve(true); }
    if (status === 'failed') return resolve(false);

    waiters.push(resolve);
    if (status === 'loading') return;

    status = 'loading';
    const s = document.createElement('script');
    s.src = DESMOS_URL;
    s.async = true;
    s.onload = () => {
      status = window.Desmos ? 'ready' : 'failed';
      const ok = status === 'ready';
      waiters.forEach((w) => w(ok));
      waiters = [];
    };
    s.onerror = () => {
      status = 'failed';
      waiters.forEach((w) => w(false));
      waiters = [];
    };
    document.head.appendChild(s);
  });
}
