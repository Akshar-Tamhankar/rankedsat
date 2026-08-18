import React from 'react';

/**
 * Practice-session analytics. Every bucket is sorted weakest-first by the
 * server, so the top row of each list is the thing to work on.
 *
 * Buckets with fewer than 3 attempts are shown but not called out as a
 * weakness — one miss on one question is noise, and telling someone their
 * "weakest skill" off a single item would be actively misleading.
 */

function pctClass(p) {
  if (p >= 80) return 'good';
  if (p >= 60) return 'ok';
  return 'bad';
}

function Bar({ row }) {
  return (
    <div className="st-row">
      <span className="st-key" title={row.key}>{row.key}</span>
      <span className="st-track">
        <span className={`st-fill ${pctClass(row.pct)}`} style={{ width: `${row.pct}%` }} />
      </span>
      <span className={`st-pct ${pctClass(row.pct)}`}>{row.pct}%</span>
      <span className="st-n">{row.correct}/{row.seen}</span>
    </div>
  );
}

function Section({ title, rows, empty }) {
  if (!rows || !rows.length) return <div className="st-block"><h3>{title}</h3><p className="st-empty">{empty}</p></div>;
  return (
    <div className="st-block">
      <h3>{title}</h3>
      {rows.map((r) => <Bar key={r.key} row={r} />)}
    </div>
  );
}

function dur(ms) {
  if (!ms) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export default function SessionStats({ stats, onClose, standalone }) {
  if (!stats) return null;
  const s = stats;
  const t = s.timing || {};
  const avg = dur(s.avgMs);

  return (
    <div className={`stats${standalone ? ' standalone' : ''}`}>
      <div className="st-head">
        <h2>Session analysis</h2>
        {onClose && <button type="button" className="st-x" onClick={onClose} aria-label="Close">✕</button>}
      </div>

      {s.seen === 0 ? (
        <p className="st-empty">Answer a question and the breakdown starts here.</p>
      ) : (
        <>
          <div className="st-tiles">
            <div className="st-tile">
              <span className="st-t-k">Answered</span>
              <span className="st-t-v">{s.seen}</span>
            </div>
            <div className="st-tile">
              <span className="st-t-k">Correct</span>
              <span className="st-t-v">{s.correct}</span>
            </div>
            <div className="st-tile">
              <span className="st-t-k">Accuracy</span>
              <span className={`st-t-v ${pctClass(s.accuracy || 0)}`}>{s.accuracy}%</span>
            </div>
            <div className="st-tile">
              <span className="st-t-k">Streak</span>
              <span className="st-t-v">{s.streak}<small> best {s.bestStreak}</small></span>
            </div>
            <div className="st-tile">
              <span className="st-t-k">Avg time</span>
              <span className="st-t-v">{avg}</span>
            </div>
          </div>

          {(s.weakSkill || s.weakDomain) && (
            <div className="st-callout">
              <span className="st-c-k">Struggling most with</span>
              <span className="st-c-v">
                {s.weakSkill
                  ? `${s.weakSkill.key} — ${s.weakSkill.correct}/${s.weakSkill.seen} (${s.weakSkill.pct}%)`
                  : `${s.weakDomain.key} — ${s.weakDomain.correct}/${s.weakDomain.seen} (${s.weakDomain.pct}%)`}
              </span>
            </div>
          )}

          {s.recent && s.recent.length > 1 && (
            <div className="st-block">
              <h3>Last {s.recent.length}</h3>
              <div className="st-dots">
                {s.recent.map((ok, i) => <span key={i} className={`st-dot ${ok ? 'good' : 'bad'}`} />)}
              </div>
            </div>
          )}

          {t.n > 0 && (
            <div className="st-block">
              <h3>Timing</h3>
              <div className="st-grid">
                <span>Mean</span><b>{dur(t.mean)}</b>
                <span>Median</span><b>{dur(t.median)}</b>
                <span>Fastest</span><b>{dur(t.fastest)}</b>
                <span>Slowest</span><b>{dur(t.slowest)}</b>
                <span>Middle 50%</span><b>{dur(t.p25)} – {dur(t.p75)}</b>
                <span>Total time</span><b>{dur(t.totalMs)}</b>
              </div>
              {t.meanCorrect > 0 && t.meanIncorrect > 0 && (
                <>
                  <div className="st-grid split">
                    <span>When correct</span>
                    <b>{dur(t.medianCorrect)} <small>median</small></b>
                    <span>When wrong</span>
                    <b>{dur(t.medianIncorrect)} <small>median</small></b>
                  </div>
                  <p className="st-note">
                    {t.medianIncorrect > t.medianCorrect * 1.25
                      ? 'You spend noticeably longer on the ones you miss — worth practising when to move on.'
                      : t.medianIncorrect < t.medianCorrect * 0.75
                        ? 'Your misses are your fastest answers — those are likely rushed rather than unknown.'
                        : 'Time spent is similar whether you get it right or wrong.'}
                  </p>
                </>
              )}
              {t.byDifficulty && t.byDifficulty.length > 1 && (
                <div className="st-grid" style={{ marginTop: 8 }}>
                  {t.byDifficulty.map((d) => (
                    <React.Fragment key={d.key}>
                      <span>{d.key}</span>
                      <b>{dur(d.median)} <small>median · {d.n}</small></b>
                    </React.Fragment>
                  ))}
                </div>
              )}
              {t.outliersExcluded > 0 && (
                <p className="st-note">
                  {t.outliersExcluded} question{t.outliersExcluded === 1 ? '' : 's'} over 15 minutes
                  excluded as idle time.
                </p>
              )}
            </div>
          )}

          <Section title="By difficulty" rows={s.byDifficulty} empty="—" />
          <Section title="By domain" rows={s.byDomain} empty="—" />
          <Section title="By skill (weakest first)" rows={s.bySkill}
            empty="Skill tags appear once you've answered a few." />
          <Section title="By question type" rows={s.byType} empty="—" />

          {s.recycled > 0 && (
            <p className="st-note">
              You've worked through every question matching these filters {s.recycled}
              {s.recycled === 1 ? ' time' : ' times'} — the pool has recycled.
            </p>
          )}
        </>
      )}
    </div>
  );
}
