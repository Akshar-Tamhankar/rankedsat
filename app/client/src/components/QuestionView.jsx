import React from 'react';

/**
 * The question surface, laid out 1:1 with Bluebook (the digital SAT app) in
 * this project's palette. Shared by the duel and by solo study so the two
 * never drift apart.
 *
 * Bluebook's anatomy, top to bottom:
 *   - Reading & Writing splits the screen: passage left, question right.
 *     Math is a single centred column.
 *   - A question-number badge, "Mark for Review" with a bookmark, and the
 *     ABC cross-out toggle sit on one row, above a full-width rule.
 *   - The stem.
 *   - Choices are full-width bordered cards, each with a circled letter.
 *     Selected = filled letter + heavy border. Crossed out = struck through
 *     with an "Undo" affordance on the right.
 *
 * MATH NOTATION CAVEAT: College Board's PDF export draws math as vector art,
 * not text, so 74% of math MCQs come through with empty choice strings and
 * every math question carries a rendered page image instead of a text stem.
 * When the choice strings are empty the image already shows the options, so
 * rendering four blank cards would be nonsense — we fall back to a compact
 * letter picker and say why.
 */
export default function QuestionView({
  q, index, total, flagged, onToggleFlag,
  choice, onChoose, crossed, onCross, crossMode, onToggleCross,
  spr, onSpr, disabled, feedback, children,
}) {
  if (!q) return null;
  const isMcq = q.type === 'mcq';
  const choices = q.choices || [];
  const art = q.choiceImages || null;
  // Only fall back to a bare letter picker if a choice has NEITHER text nor
  // its own notation image — with per-choice crops this is now rare.
  const textless = isMcq && choices.length > 0
    && choices.every((c) => !(c.text || '').trim() && !(art && art[c.label]));

  const letterState = (c, i) => {
    if (!feedback) return choice === c.label ? 'sel' : '';
    if (c.label === feedback.correctAnswer) return 'right';
    if (choice === c.label) return 'wrong';
    return '';
  };

  return (
    <div className={`bb ${q.passage ? 'bb-split' : 'bb-single'}`}>
      {q.passage && (
        <section className="bb-pane bb-passage">
          <div className="bb-passage-inner">{q.passage}</div>
        </section>
      )}

      <section className="bb-pane bb-question">
        <div className="bb-qhead">
          <span className="bb-num">{index != null ? index + 1 : '·'}</span>
          <button
            type="button"
            className={`bb-mark${flagged ? ' on' : ''}`}
            aria-pressed={!!flagged}
            onClick={onToggleFlag}
            disabled={!onToggleFlag}
          >
            <svg viewBox="0 0 14 18" width="11" height="14" aria-hidden="true">
              <path
                d="M1 1h12v16l-6-4.5L1 17z"
                fill={flagged ? 'currentColor' : 'none'}
                stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
              />
            </svg>
            Mark for Review
          </button>
          <span className="bb-spacer" />
          {isMcq && !textless && (
            <button
              type="button"
              className={`bb-abc${crossMode ? ' on' : ''}`}
              aria-pressed={!!crossMode}
              onClick={onToggleCross}
              title="Cross out answer choices (X)"
            >
              <span className="abc">ABC</span>
            </button>
          )}
        </div>
        <div className="bb-rule" />

        <div className="bb-body">
          <div className="bb-meta">
            <span className={`diff ${q.difficulty}`}>{q.difficulty}</span>
            {q.domain && <span className="muted">{q.domain}</span>}
            {q.skill && <span className="muted">· {q.skill}</span>}
          </div>

          {/* The stem crop already contains the prose as well as the notation,
              so it replaces the text rather than accompanying it. */}
          {q.stemImageUrl
            ? <img className="bb-stem-img" src={q.stemImageUrl} alt="Question" />
            : <div className="bb-stem">{q.stem}</div>}
          {q.figureUrl && <img className="bb-figure" src={q.figureUrl} alt="Figure for this question" />}

          {isMcq && !textless && (
            <div className="bb-choices" role="radiogroup" aria-label="Answer choices">
              {choices.map((c, i) => {
                const out = crossed && crossed.has(i);
                const st = letterState(c, i);
                return (
                  <div className={`bb-choice-row${out ? ' out' : ''}`} key={c.label}>
                    <button
                      type="button" role="radio" aria-checked={choice === c.label}
                      disabled={disabled}
                      className={`bb-choice ${st}`}
                      onClick={() => {
                        if (disabled) return;
                        if (crossMode) onCross(i);
                        else onChoose(c.label);
                      }}
                    >
                      <span className="bb-letter">{c.label}</span>
                      {art && art[c.label]
                        ? <img className="bb-choice-img" src={art[c.label]} alt={`Choice ${c.label}`} />
                        : <span className="bb-text">{c.text}</span>}
                      {feedback && c.label === feedback.correctAnswer
                        && <span className="bb-tag">correct</span>}
                    </button>
                    {out && (
                      <button type="button" className="bb-undo" onClick={() => onCross(i)}>
                        Undo
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isMcq && textless && (
            <>
              <p className="bb-imgnote">
                This question&apos;s choices are part of the image above — College Board
                exports math notation as artwork, not text. Pick the letter.
              </p>
              <div className="bb-letters" role="radiogroup" aria-label="Answer choices">
                {choices.map((c) => {
                  const st = letterState(c);
                  return (
                    <button
                      key={c.label} type="button" role="radio"
                      aria-checked={choice === c.label} disabled={disabled}
                      className={`bb-lonly ${st}`}
                      onClick={() => !disabled && onChoose(c.label)}
                    >{c.label}</button>
                  );
                })}
              </div>
            </>
          )}

          {!isMcq && (
            <div className="bb-spr">
              <label htmlFor="bbSpr">Enter your answer</label>
              <input
                id="bbSpr" className="bb-sprin" inputMode="decimal" autoComplete="off"
                value={spr} disabled={disabled}
                onChange={(e) => onSpr(e.target.value)}
              />
              <p className="bb-sprnote">Fractions and decimals both accepted.</p>
            </div>
          )}

          {children}
        </div>
      </section>
    </div>
  );
}
