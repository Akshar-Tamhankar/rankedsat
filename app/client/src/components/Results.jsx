import React from 'react';

const HEADLINE = { win: 'Victory', loss: 'Defeat', draw: 'Drawn' };

export default function Results({ game }) {
  const r = game.result;
  if (!r) return null;
  const rating = r.rating || {};
  const delta = rating.delta || 0;
  const sign = delta > 0 ? '+' : '';

  return (
    <div className="duel results">
      <div className="res-card">
        <h1 className={`res-head ${r.outcome}`} tabIndex={-1}>
          {HEADLINE[r.outcome] || 'Result'}
        </h1>

        {r.forfeit && (
          <p className="forfeit">
            {r.forfeit.youForfeited ? 'You forfeited.' : 'Your opponent forfeited.'}
            {r.forfeit.reason ? ` (${r.forfeit.reason})` : ''}
          </p>
        )}

        <div className="score">
          <div className="s-side">
            <div className="s-name">{r.you.name}</div>
            <div className="s-num">{r.you.correct}</div>
          </div>
          <div className="s-vs">vs</div>
          <div className="s-side">
            <div className="s-name">
              {r.opponent.name}{r.opponent.isBot && <span className="bot">BOT</span>}
            </div>
            <div className="s-num">{r.opponent.correct}</div>
          </div>
        </div>

        <p className="rating-line">
          {rating.section ? rating.section.toUpperCase() : ''} rating{' '}
          <b>{rating.before}</b> → <b>{rating.after}</b>{' '}
          <span className={delta >= 0 ? 'up' : 'down'}>({sign}{delta})</span>
          {rating.stake != null && <span className="muted"> · stake ±{rating.stake}</span>}
        </p>
        {rating.opponentIsBot && (
          <p className="muted small">Bot matches are rated in this build.</p>
        )}

        <div className="res-actions">
          <button type="button" className="primary" onClick={game.askRematch} disabled={game.rematch.sent}>
            {game.rematch.sent ? 'Waiting…' : 'Rematch'}
          </button>
          <button type="button" onClick={game.toLobby}>Back to the hall</button>
        </div>
        {(game.rematch.note || game.rematch.offered) && (
          <p className="muted small" aria-live="polite">
            {game.rematch.offered ? 'Your opponent wants a rematch.' : game.rematch.note}
          </p>
        )}
      </div>
    </div>
  );
}
