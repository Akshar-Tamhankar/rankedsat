import React, { useEffect, useState } from 'react';
import { useLeaderboard } from '../../lib/useGame.js';

/**
 * "The Record" — your own practice history.
 *
 * The leaderboard already lives in the Board zone, so this zone shows what
 * only you can see: every finished study session, with the option to drop one
 * or clear the lot. Sessions are summarised server-side (see recordSession)
 * and persist across restarts.
 */

function when(ts) {
  const d = new Date(ts);
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dur(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function label(e) {
  if (e.mode === 'mock') return 'Mock exam';
  if (e.mode === 'module') return 'Timed module';
  const sec = e.section === 'math' ? 'Math' : 'ELA';
  const bits = [sec];
  if (e.filters) {
    if (e.filters.difficulty && e.filters.difficulty !== 'mixed') bits.push(e.filters.difficulty);
    if (e.filters.type && e.filters.type !== 'any') bits.push(e.filters.type === 'spr' ? 'grid-in' : 'MCQ');
    if (e.filters.age && e.filters.age !== 'any') bits.push(e.filters.age);
  }
  return bits.join(' · ');
}

export default function Decal({ isOpen, game }) {
  const board = useLeaderboard();
  const [confirmAll, setConfirmAll] = useState(false);
  const [openId, setOpenId] = useState(null);
  const history = (game && game.history) || [];

  useEffect(() => {
    if (isOpen && game && game.loadHistory) game.loadHistory();
    if (!isOpen) { setConfirmAll(false); setOpenId(null); }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const rated = [...(board.ela || []), ...(board.math || [])]
    .sort((a, b) => b.rating - a.rating).slice(0, 8);

  const items = history.length
    ? history.slice(0, 6).map((e) => (
        <span className="tick" key={e.id}>
          <b>{label(e)}</b> · {e.correct}/{e.seen}
          {e.accuracy !== null && ` · ${e.accuracy}%`}
        </span>
      ))
    : rated.length
      ? rated.map((p) => (
          <span className="tick" key={p.name + p.rating}>
            <b>{p.name}</b> · {p.rating}
          </span>
        ))
      : [<span className="tick" key="none">No sessions yet — study alone to fill this in</span>];

  return (
    <>
      {!isOpen && (
        <div className="only-closed">
          <div className="decal-idle">
            <span className="di-mark">{history.length ? 'Sessions' : 'Standing'}</span>
            <div className="ticker">
              <div className="ticker-row">{items}{items}</div>
            </div>
            <span className="di-mark">The record</span>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="only-open">
          <div className="p-head"><span>II · The Record</span><span className="rule" /></div>
          <h2 className="p-title foil">Past sessions</h2>

          {history.length === 0 ? (
            <p className="p-sub">
              Nothing recorded yet. Finish a practice run, a timed module or a mock exam
              and it will appear here — with the full breakdown.
            </p>
          ) : (
            <>
              <div className="hist-top">
                <p className="p-sub">{history.length} session{history.length === 1 ? '' : 's'} kept.</p>
                {confirmAll ? (
                  <span className="hist-confirm">
                    Delete all?
                    <button type="button" className="btn ghost small danger-text"
                      onClick={() => { game.clearHistory(); setConfirmAll(false); }}>Yes, clear</button>
                    <button type="button" className="btn ghost small"
                      onClick={() => setConfirmAll(false)}>Cancel</button>
                  </span>
                ) : (
                  <button type="button" className="btn ghost small"
                    onClick={() => setConfirmAll(true)}>Clear all</button>
                )}
              </div>

              <div className="hist-list">
                {history.map((e) => (
                  <div className={`hist${openId === e.id ? ' open' : ''}`} key={e.id}>
                    <button type="button" className="hist-row"
                      onClick={() => setOpenId(openId === e.id ? null : e.id)}>
                      <span className="h-when">{when(e.at)}</span>
                      <span className="h-label">{label(e)}</span>
                      <span className="h-score">{e.correct}/{e.seen}</span>
                      <span className={`h-pct ${e.accuracy >= 80 ? 'good' : e.accuracy >= 60 ? 'ok' : 'bad'}`}>
                        {e.accuracy === null ? '—' : `${e.accuracy}%`}
                      </span>
                    </button>
                    <button type="button" className="hist-del" title="Delete this session"
                      onClick={() => game.clearHistory(e.id)}>✕</button>

                    {openId === e.id && (
                      <div className="hist-detail">
                        <div className="hist-meta">
                          <span>Median {dur(e.timing && e.timing.median)}</span>
                          <span>Total {dur(e.timing && e.timing.totalMs)}</span>
                          <span>Best streak {e.bestStreak}</span>
                        </div>
                        {e.weakSkill && (
                          <p className="hist-weak">
                            Weakest: <b>{e.weakSkill.key}</b> — {e.weakSkill.correct}/{e.weakSkill.seen}
                          </p>
                        )}
                        {(e.byDomain || []).slice(0, 5).map((d) => (
                          <div className="st-row" key={d.key}>
                            <span className="st-key">{d.key}</span>
                            <span className="st-track">
                              <span className={`st-fill ${d.pct >= 80 ? 'good' : d.pct >= 60 ? 'ok' : 'bad'}`}
                                style={{ width: `${d.pct}%` }} />
                            </span>
                            <span className="st-pct">{d.pct}%</span>
                            <span className="st-n">{d.correct}/{d.seen}</span>
                          </div>
                        ))}
                        {e.results && (
                          <div className="hist-mods">
                            {e.results.map((m, i) => (
                              <div className="mod-row" key={i}><span>{m.label}</span><b>{m.correct}/{m.total}</b></div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 18 }}>
            <button className="btn ghost" type="button" data-close>Back</button>
          </div>
        </div>
      )}
    </>
  );
}
