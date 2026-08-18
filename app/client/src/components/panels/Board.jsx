import React, { useEffect, useRef, useState } from 'react';
import { useLeaderboard } from '../../lib/useGame.js';

/** Count up to a new value, then flash. Used when a rating moves. */
function useTicker(value) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState(false);
  const raf = useRef(0);
  useEffect(() => {
    const from = shown;
    const to = value;
    if (from === to) return undefined;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setShown(to); setFlash(true); return undefined; }
    const t0 = performance.now();
    const dur = 700;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (to - from) * e));
      if (t < 1) raf.current = requestAnimationFrame(step);
      else { setFlash(true); setTimeout(() => setFlash(false), 420); }
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return [shown, flash];
}

export default function Board({ game, isOpen }) {
  const board = useLeaderboard();
  const [tab, setTab] = useState('ela');
  const p = game.profile;

  const ela = p ? p.ratings.ela : 1000;
  const math = p ? p.ratings.math : 1000;
  const [elaShown, elaFlash] = useTicker(ela);
  const [mathShown, mathFlash] = useTicker(math);

  const games = p ? p.games : { ela: 0, math: 0 };
  const total = (games.ela || 0) + (games.math || 0);
  const standing = total >= 5 ? 'Ranked' : 'Unranked';
  const rows = board[tab] || [];

  return (
    <>
      {!isOpen && (
        <div className="only-closed">
          <div className="rat-row">
            <div className="rat">
              <span className="r-k" data-tip="ELA rating|Starts at 1000. Stakes scale with the gap.">ELA</span>
              <span className={`r-v${elaFlash ? ' chroma' : ''}`}>{elaShown}</span>
              <span className="r-n">{games.ela || 0} games</span>
            </div>
            <div className="rat">
              <span className="r-k" data-tip="Math rating|Both math queues share this one rating.">Math</span>
              <span className={`r-v${mathFlash ? ' chroma' : ''}`}>{mathShown}</span>
              <span className="r-n">{games.math || 0} games</span>
            </div>
            <div className="rat">
              <span className="r-k">Record</span>
              <span className="r-v">
                {p ? `${p.wins}–${p.losses}–${p.draws}` : '0–0–0'}
              </span>
              <span className="r-n">W–L–D</span>
            </div>
            <span className="spacer" />
            <div className="rat" style={{ alignItems: 'flex-end' }}>
              <span className="r-k">Standing</span>
              <span
                className="r-v standing" style={{ fontSize: 22 }}
                data-tip="Standing|Play five rated duels to earn a standing."
              >{standing}</span>
            </div>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="only-open">
          <div className="p-head"><span>III · The Board</span><span className="rule" /></div>
          <h2 className="p-title foil">Leaderboard</h2>
          <div className="lb-tabs" role="tablist">
            {['ela', 'math'].map((s) => (
              <button
                key={s} type="button" role="tab" aria-selected={tab === s}
                className={`lb-tab${tab === s ? ' on' : ''}`}
                onClick={() => setTab(s)}
              >{s === 'ela' ? 'ELA' : 'Math'}</button>
            ))}
          </div>
          <table className="lb">
            <thead><tr>
              <th>#</th><th>Scholar</th><th>Rating</th><th>Games</th><th>W–L–D</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name} className={p && r.name === p.name ? 'me' : ''}>
                  <td className="rank">{i + 1}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.rating}</td>
                  <td className="num">{r.games}</td>
                  <td className="num">{r.wins}–{r.losses}–{r.draws}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-sub">No rated players yet — play a duel to appear here.</p>}
          <div style={{ marginTop: 18 }}>
            <button className="btn ghost" type="button" data-close>Back</button>
          </div>
        </div>
      )}
    </>
  );
}
