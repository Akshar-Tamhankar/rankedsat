import React, { useEffect, useState } from 'react';
import { useGame } from './lib/useGame.js';
import Hall from './components/Hall.jsx';
import Duel from './components/Duel.jsx';
import Practice from './components/Practice.jsx';
import Results from './components/Results.jsx';
import Tooltip from './components/Tooltip.jsx';
import Gate from './components/Gate.jsx';

const PREF_KEY = 'rankedsat.prefs';

// The desktop shell appends ?gpu=software when Chromium fell back to CPU
// compositing. Blur and layer animation are catastrophic in that mode, so the
// expensive layers start off rather than letting the machine grind.
const GPU_MODE = (() => {
  try { return new URLSearchParams(window.location.search).get('gpu') || ''; }
  catch { return ''; }
})();
const SOFTWARE_GPU = GPU_MODE === 'software';

// NOTE: fps defaults to FALSE. The meter needs a frame every frame, which
// pins the rAF loop open forever and defeats the whole "an idle hall costs
// nothing" design — it was measuring a cost it was itself creating.
const DEFAULT_PREFS = {
  blur: !SOFTWARE_GPU,
  ambient: !SOFTWARE_GPU,
  sound: true,
  fps: false,
};

export default function App() {
  const game = useGame();
  const [prefs, setPrefs] = useState(() => {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
    } catch {
      return DEFAULT_PREFS;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  // Hard cap on the costly layers when there is no GPU to draw them with.
  useEffect(() => {
    document.body.classList.toggle('perf-low', SOFTWARE_GPU);
  }, []);

  // The duel is a different world: drop every hall class so no ambient layer,
  // blur or camera state leaks into the reading surface.
  // practice uses the same stripped surface as a duel, so it takes the same
  // hall-suppressing treatment
  const inDuel = game.view === 'match' || game.view === 'results' || game.view === 'practice';
  useEffect(() => {
    document.body.classList.toggle('in-duel', inDuel);
    if (inDuel) {
      document.body.classList.remove('focused', 'opened');
    }
  }, [inDuel]);

  // The gate covers everything — no point rendering a hall you can't play in.
  if (game.locked) return <Gate onUnlocked={game.unlock} />;

  return (
    <>
      {!inDuel && (
        <Hall game={game} prefs={prefs} setPrefs={setPrefs} />
      )}
      {game.view === 'match' && <Duel game={game} />}
      {game.view === 'practice' && <Practice game={game} />}
      {game.view === 'results' && <Results game={game} />}

      {!inDuel && <Tooltip />}

      {!game.connected && (
        <div className="conn-toast" role="status">
          {game.connError ? `Disconnected — ${game.connError}` : 'Connecting…'}
        </div>
      )}
    </>
  );
}
