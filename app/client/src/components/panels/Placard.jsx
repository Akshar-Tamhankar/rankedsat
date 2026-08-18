import React, { useEffect, useRef, useState } from 'react';
import * as snd from '../../lib/audio.js';

// The digital SAT has no no-calculator module — Desmos is available for the
// whole Math section — so that queue is gone. The server still accepts
// math-nocalc so any in-flight client keeps working.
const QUEUES = {
  ela: { t: 'Reading & Writing', s: 'Evidence & conventions', tip: 'Reading & Writing|Evidence, craft, and conventions.' },
  'math-desmos': { t: 'Math', s: 'Desmos throughout', tip: 'Math|Full graphing calculator, as on the digital SAT.' },
};

const TERMS = {
  ela: ['Reading & Writing', 'Evidence, craft, and conventions.'],
  'math-desmos': ['Math', 'Desmos available throughout, as on the real test.'],
};


// College Board's domain names are long enough to wreck a compact filter row,
// so each gets a short label. Keyed by the exact bank value.
const DOMAIN_SHORT = {
  'Algebra': 'Algebra',
  'Advanced Math': 'Advanced',
  'Problem-Solving and Data Analysis': 'Data analysis',
  'Geometry and Trigonometry': 'Geometry & trig',
  'Information and Ideas': 'Info & ideas',
  'Craft and Structure': 'Craft',
  'Expression of Ideas': 'Expression',
  'Standard English Conventions': 'Conventions',
};

function FilterRow({ label, value, onChange, opts }) {
  return (
    <div className="filter-row">
      <span className="filter-label">{label}</span>
      <div className="levels" role="group" aria-label={label}>
        {opts.map(([v, text]) => (
          <button
            key={v} type="button"
            className={`level${value === v ? ' on' : ''}`}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >{text}</button>
        ))}
      </div>
    </div>
  );
}

export default function Placard({ game, isOpen }) {
  const [draft, setDraft] = useState(game.name || '');
  const [queue, setQueue] = useState(null);
  const [err, setErr] = useState('');
  const [level, setLevel] = useState('mixed');
  const [qtype, setQtype] = useState('any');
  const [age, setAge] = useState('any');
  const [answers, setAnswers] = useState(true);
  // Duel and Study are separate tabs. Stacked in one column the study controls
  // ended up below the fold of a scrolling panel and were simply not findable.
  const [tab, setTab] = useState('duel');
  const [studySection, setStudySection] = useState('ela');
  const [domain, setDomain] = useState('any');
  const [meta, setMeta] = useState(null);
  const rippleRef = useRef(null);

  // Domain list comes from the bank, so it can't drift from the data.
  useEffect(() => {
    let alive = true;
    fetch('/api/meta').then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (alive && m) setMeta(m); })
      .catch(() => { /* filter just stays on "any" */ });
    return () => { alive = false; };
  }, []);

  // Domains are section-specific, so switching section invalidates the choice.
  useEffect(() => { setDomain('any'); }, [studySection]);

  useEffect(() => { setDraft(game.name || ''); }, [game.name]);

  const queuing = game.view === 'queue';

  async function find() {
    if (!queue) { setErr('Choose a discipline first.'); return; }
    setErr('');
    if (draft && draft !== game.name) await game.saveName(draft);
    const res = await game.joinQueue(queue);
    if (res && !res.ok) setErr(res.error || 'Could not join the queue.');
    else snd.chord();
  }

  // Study has its own section picker — it only needs ELA vs Math, not the
  // three rated queues, and requiring a queue choice first was a dead end.
  async function study(extra) {
    setErr('');
    const res = await game.soloStart({
      mode: 'practice',
      section: studySection,
      difficulty: level,
      type: qtype,
      age,
      domain,
      feedback: answers,
      ...extra,
    });
    if (res && !res.ok) setErr(res.error || 'Could not start.');
  }

  function pop(e) {
    e.stopPropagation();
    const r = rippleRef.current;
    if (r) { r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }
    snd.thump();
  }

  return (
    <>
      <div className="wax" onClick={pop} data-tip="Sigil|Your seal. Cosmetic, earned through play.">
        <span>Sigil</span>
        <span className="ripple" ref={rippleRef} />
      </div>

      <div className="p-head"><span>I · The Hall</span><span className="rule" /></div>
      <h2 className="p-title foil">Enter the lists</h2>

      {!isOpen && (
        <div className="only-closed">
          <p className="p-sub">Choose a discipline and be matched against a scholar of your standing.</p>
          <p className="p-sub" style={{ marginTop: 14, opacity: 0.72 }}>
            Playing as <b>{game.name || '…'}</b>
            {!game.connected && <span className="warn"> · reconnecting…</span>}
          </p>
        </div>
      )}

      {isOpen && (
        <div className="only-open">
          {queuing ? (
            <div className="seeking">
              <div className="search-ring" aria-hidden="true" />
              <p className="p-sub">Finding an opponent…</p>
              <p className="p-sub" style={{ opacity: 0.7 }}>
                If nobody joins within 10 seconds, <b>Ghost Bot</b> steps in.
              </p>
              <button className="btn ghost" type="button" onClick={game.leaveQueue}>Cancel</button>
            </div>
          ) : (
            <>
              <div className="tabs" role="tablist" aria-label="Play mode">
                <button
                  type="button" role="tab" aria-selected={tab === 'duel'}
                  className={`tab${tab === 'duel' ? ' on' : ''}`}
                  onClick={() => setTab('duel')}
                >Duel</button>
                <button
                  type="button" role="tab" aria-selected={tab === 'study'}
                  className={`tab${tab === 'study' ? ' on' : ''}`}
                  onClick={() => setTab('study')}
                >Study alone</button>
              </div>

              {tab === 'duel' && (
              <>
              <div className="field">
                <label htmlFor="nm">Display name</label>
                <input
                  className="input" id="nm" maxLength={20} value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => { if (draft && draft !== game.name) game.saveName(draft); }}
                />
              </div>

              <div className="field">
                <label>Discipline {queue && <span style={{ opacity: 0.6 }}>— its terms</span>}</label>
                <div className={`flip${queue ? ' flipped' : ''}`}>
                  <div className="flip-inner">
                    <div className="flip-face flip-front">
                      <div className="cards">
                        {Object.entries(QUEUES).map(([k, q]) => (
                          <label key={k} className="card-opt" data-tip={q.tip}>
                            <input
                              type="radio" name="q" value={k}
                              checked={queue === k}
                              onChange={() => { setQueue(k); snd.tick(); }}
                            />
                            <span className="co-t">{q.t}</span>
                            <span className="co-s">{q.s}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flip-face flip-back">
                      <div className="params">
                        <div>
                          <div className="pr-t">{queue ? TERMS[queue][0] : '—'}</div>
                          <div className="pr-l">
                            {queue ? TERMS[queue][1] : ''}<br />
                            One clock for the whole match: 5:00, or 7:00 when the average rating is 1500+.<br />
                            Stake: ±2–30 by rating gap.
                          </div>
                        </div>
                        <button
                          className="btn ghost small pr-b" type="button"
                          onClick={() => { setQueue(null); snd.tick(); }}
                        >Change discipline</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {err && <p className="err">{err}</p>}

              <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
                <button className="btn" type="button" onClick={find} disabled={!game.connected}>
                  Find opponent
                </button>
                <button className="btn ghost" type="button" data-close>Back</button>
              </div>
              </>
              )}

              {tab === 'study' && (
              <div className="solo-block">
                <FilterRow label="Section" value={studySection} onChange={setStudySection}
                  opts={[['ela', 'Reading & Writing'], ['math', 'Math']]} />
                {/* Topic filter, built from whatever the bank actually holds. */}
                {meta && meta[studySection] && meta[studySection].length > 0 && (
                  <FilterRow label="Topic" value={domain} onChange={setDomain}
                    opts={[['any', 'all topics'],
                      ...meta[studySection].map((d) => [
                        d.domain,
                        `${DOMAIN_SHORT[d.domain] || d.domain} (${d.count})`,
                      ])]} />
                )}

                <FilterRow label="Difficulty" value={level} onChange={setLevel}
                  opts={[['mixed', 'mixed'], ['easy', 'easy'], ['medium', 'medium'],
                    ['hard', 'hard'], ['hell', '🔥 hell']]} />
                <FilterRow label="Type" value={qtype} onChange={setQtype}
                  opts={[['any', 'any'], ['mcq', 'multiple choice'], ['spr', 'grid-in']]} />
                <FilterRow label="Content" value={age} onChange={setAge}
                  opts={[['any', 'all'], ['new', 'newest release'], ['original', 'earlier']]} />
                <FilterRow label="Answers" value={answers ? 'on' : 'off'}
                  onChange={(v) => setAnswers(v === 'on')}
                  opts={[['on', 'show + explain'], ['off', 'hide']]} />

                {err && <p className="err">{err}</p>}

                <div className="solo-row solo-actions">
                  <button className="btn" type="button"
                    onClick={() => study()} disabled={!game.connected}>Practice</button>
                  <button className="btn ghost" type="button" data-close>Back</button>
                </div>

                <div className="solo-rule tight"><span>or sit a timed section</span></div>
                <div className="solo-row solo-actions">
                  <button className="btn ghost" type="button" disabled={!game.connected}
                    onClick={() => study({ mode: 'module', module: 1 })}>Module 1</button>
                  <button className="btn ghost" type="button" disabled={!game.connected}
                    onClick={() => study({ mode: 'module', module: 2, tier: 'upper' })}>Module 2 · upper</button>
                  <button className="btn ghost" type="button" disabled={!game.connected}
                    onClick={() => study({ mode: 'module', module: 2, tier: 'lower' })}>Module 2 · lower</button>
                  <button className="btn" type="button" disabled={!game.connected}
                    onClick={() => study({ mode: 'mock' })}>Full mock exam</button>
                </div>

                {level === 'hell' && (
                  <p className="p-sub hell-note">
                    <b>Hell</b> is the 100 hardest questions in the bank, the worst 50
                    from each section, ranked by our own scoring: grid-ins first (no
                    choices to eliminate), then long multi-step explanations, then
                    figures. College Board only publishes three tiers, so this ranking
                    is ours, not theirs. Section, topic and type filters do not apply.
                  </p>
                )}

                <p className="p-sub solo-note">
                  Practice is untimed and filtered. A module is Bluebook-shaped —
                  27 Reading &amp; Writing in 32:00, or 22 Math in 35:00 — freshly drawn each
                  time, with answers held back until it ends. The mock runs all four
                  modules, and Module 2&apos;s difficulty follows how you did on Module 1,
                  as the real adaptive test does. Modules set their own difficulty and
                  question types; only the content filter carries over.
                </p>
              </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
