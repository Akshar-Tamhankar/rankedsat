# RankedSat — UI/UX Design & Accessibility Brainstorm

> **Doc scope:** Screen-by-screen UI, the match screen in depth, design language,
> WCAG 2.2 AA accessibility, user-driven-design mechanisms, responsive strategy,
> and empty/edge states.
> **North star:** *Bluebook-familiar, esports-legible, accessibility-first.* A
> student who has taken a real digital SAT should feel at home in a duel within
> 5 seconds; a screen-reader or keyboard-only user should be able to queue, play,
> and review a full ranked match with zero mouse input.

---

## 0. Guiding principles (the opinionated part)

1. **Familiarity beats novelty inside the question frame.** The area where a
   student reads the passage and picks an answer should be a near-clone of
   Bluebook's ergonomics (left/right split, cross-out elimination, mark-for-review,
   hideable timer, math reference sheet, embedded Desmos). The competitive
   "esports" layer lives in a **thin chrome around** that frame, never inside it.
2. **Competition must motivate, not panic.** Opponent state is shown as *progress,
   not proximity to losing*. We never render a live "you're behind" red bar. We
   show pace and completion, framed as information, and we default to a calmer
   presentation with an opt-in "hype" mode.
3. **Color is decoration, never the message.** Every state that matters
   (rank tier, difficulty, correct/incorrect, opponent status) is encoded by at
   least two of {text label, icon/shape, position} so it survives colorblindness,
   grayscale, and screen readers.
4. **Keyboard and screen reader are first-class play modes, not a compliance
   afterthought.** If a sighted mouse user can do it in a duel, a keyboard-only or
   SR user can do it within the same time budget. We design the keymap *before* the
   visuals.
5. **Accommodations are a fairness feature, not a charity mode.** Extended time
   students get a first-class, dignity-preserving experience with a rating system
   that stays honest (see §4.7).

---

## 1. Full screen inventory

Notation: `┌─┐` boxes are regions; `[Button]` is a control; `→` is primary flow.

### 1.1 Landing / marketing (logged-out)
Purpose: convert a curious student in <15s; communicate "ranked SAT duels" instantly.

```
┌───────────────────────────────────────────────────────────┐
│ RankedSat            Practice  Leaderboard  How it works  [Log in][Sign up] │
├───────────────────────────────────────────────────────────┤
│  HERO                                                       │
│  "Climb the ranks. One SAT question at a time."             │
│  Subhead: real-style Digital SAT questions, live 1v1.       │
│  [ Play a demo duel → ]   [ How ranking works ]             │
│                                                             │
│  ┌ Live demo tile ──────────────┐  (auto-playing, muted,   │
│  │ mini match screen, reduced-   │   respects reduced-motion:│
│  │ motion static fallback)       │   shows a still frame)   │
│  └───────────────────────────────┘                          │
├───────────────────────────────────────────────────────────┤
│  3 pillars row: [Elo rating] [5 queue types] [Free to play] │
│  Social proof: leaderboard snapshot (top 5, anonymized-opt) │
│  FAQ accordion · Accessibility statement link · Footer      │
└───────────────────────────────────────────────────────────┘
```
Opinion: the hero CTA is **"Play a demo duel"** against a bot, *before* auth. Let
them feel the loop first; ask for an account only when they want a rating to stick.
This is the single highest-leverage conversion decision on the site.

### 1.2 Auth (sign up / log in)
Purpose: lowest-friction account creation for teens; **WCAG 2.2 Accessible
Authentication** compliant.

```
┌─────────────────────────────┐
│  Log in / Sign up (tabbed)   │
│  [ Continue with Google ]    │  ← primary; teens have school Google accounts
│  [ Continue with Apple  ]    │
│  ── or ──                    │
│  Email  [__________]         │
│  (magic link, no password)   │  ← passwordless by default
│  [ Send me a link ]          │
│                              │
│  On first login only:        │
│   Display name  [_______]    │
│   Grade / test date (opt)    │
│   Accommodations? [Set up]   │  ← links to §4.7, never required
└─────────────────────────────┘
```
Opinions:
- **Passwordless (magic link) + SSO by default.** No password field means we
  satisfy WCAG 2.2 *3.3.8 Accessible Authentication* trivially — no cognitive
  test, no CAPTCHA. If we ever add passwords, allow paste + password managers, no
  "retype your password" (2.2 *3.3.7 Redundant Entry*).
- **No CAPTCHA.** If we need bot defense, use invisible/behavioral or email
  verification, never a puzzle the accessibility guidelines and our own values
  forbid.
- **Under-13 gate + guardian note** for COPPA-ish caution (product/legal decision;
  flag it — target is 14–18 so default to 13+).

### 1.3 Home / lobby (the hub)
Purpose: the logged-in default. One glance = "what's my rank, and how do I play now."

```
┌───────────────────────────────────────────────────────────┐
│ RankedSat   Home  Leaderboard  Practice  Roadmap   [◑] [⚙] [avatar] │
├───────────────────────────────────────────────────────────┤
│  ┌ Rank card ─────────────┐   ┌ Big play panel ──────────┐ │
│  │ [Tier badge shape]      │   │  QUEUE FOR A DUEL         │ │
│  │ Gold III · 1240 (icon)  │   │  Category:               │ │
│  │ ▓▓▓▓▓░░ to next tier    │   │  ( ) Full Mock SAT       │ │
│  │ W 42 · L 30 · streak ▲3 │   │  ( ) ELA (R&W)           │ │
│  └─────────────────────────┘   │  ( ) Math                │ │
│  ┌ Recent matches list ────┐   │  ( ) Math — Desmos OK    │ │
│  │ vs Player · +18 · review│   │  ( ) Math — No calc      │ │
│  │ vs Player · −12 · review│   │  Difficulty: Adaptive ▾  │ │
│  └─────────────────────────┘   │  [  FIND OPPONENT  ▶ ]   │ │
│                                └──────────────────────────┘ │
│  Daily goals · Practice suggestion · What's new (changelog) │
└───────────────────────────────────────────────────────────┘
```
Opinions:
- The **queue category selector lives on Home**, not behind a menu. Five categories
  as radio cards (labelled with icon + text). Selected state uses border + checkmark
  + text, not color alone.
- **One primary CTA per screen.** Here it's `FIND OPPONENT`. Everything else is
  secondary.
- Show rating as a **number + tier name + tier shape badge**, always together.

### 1.4 Queue / matchmaking
Purpose: hold attention during the (hopefully short) wait; set expectations;
allow graceful bail.

```
┌───────────────────────────────────────────────────────────┐
│              Finding an opponent…                          │
│         [ animated but reduced-motion-safe ring ]          │
│                                                            │
│   Category: Math — Desmos OK   ·   Adaptive difficulty     │
│   Searching near your rating: 1200–1280                    │
│   Elapsed 0:07 · avg wait ~0:12                            │
│                                                            │
│   [ Widen rating range ]     [ Cancel ]                    │
│                                                            │
│   Tip while you wait: "Cross out choices with the X tool"  │
│   ┌ Warm-up question (optional) ───────────────────────┐  │
│   │  1 practice Q so your hands are warm (not scored)   │  │
│   └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```
Opinions:
- **Expose the search band** ("near your rating: 1200–1280") — transparency builds
  trust in the ranking and explains waits.
- **Optional warm-up question** during queue kills two birds: dead-time engagement +
  reduces the "cold start" disadvantage in the first real question.
- Match-found = a **3-2-1 "get ready" interstitial** (skippable/auto for SR users)
  with the opponent's display name, rank badge, and a "Ready" affirmation so nobody
  is dumped into Q1 mid-blink.

### 1.5 Match screen
The heart of the app — full treatment in **§2**.

### 1.6 Post-match review
Purpose: the learning payload. This is where an SAT-prep app earns retention; a duel
you can't learn from is just a game.

```
┌───────────────────────────────────────────────────────────┐
│  RESULT: You won · +18 → 1258   [Gold III badge]           │
│  ┌ Summary strip ─────────────────────────────────────────┐│
│  │ You  8/10 · 9:41    Opponent  7/10 · 10:20              ││
│  │ Rating: 1240 → 1258 (▲18)  · new tier progress bar      ││
│  └────────────────────────────────────────────────────────┘│
│  Question-by-question review (accordion list):             │
│  ┌ Q1  ✓ You right · Opp right · Medium  [Review ▾]────────┐│
│  │   [full question] your choice ✓ · correct answer ·      ││
│  │   rationale · [Report this question] [Rate ★]           ││
│  └────────────────────────────────────────────────────────┘│
│  ┌ Q2  ✗ You wrong · Opp right · Hard  [Review ▾] ─────────┐│
│  ...                                                        │
│  [ Add missed Qs to Practice ]  [ Rematch ]  [ Home ]       │
│  Micro-survey: "How fair did this match feel?" (1 tap)     │
└───────────────────────────────────────────────────────────┘
```
Opinions:
- **Default the accordion to open on the questions you got wrong.** That's the
  learning surface; don't make them hunt.
- Each question shows **your answer, correct answer, rationale, difficulty, and
  both players' outcomes** — the last one makes losses feel fair ("they got the hard
  one too, I just missed the medium").
- **"Add missed Qs to Practice"** turns every loss into a study action. Retention
  gold.
- Per-question **Report** and **Rate** live here (also inline in-match; see §5).

### 1.7 Profile
Purpose: identity + progress + self-diagnosis.

```
┌───────────────────────────────────────────────────────────┐
│ [avatar] DisplayName  ·  Gold III · 1258  ·  joined 2026   │
│ [Edit profile] [Share]                                     │
├───────────────────────────────────────────────────────────┤
│  Rating over time (line chart, labelled points, table alt) │
│  Skill breakdown:                                          │
│   ELA  ▓▓▓▓▓▓▓░  strong: Craft & Structure                 │
│   Math ▓▓▓▓░░░░  weak: Advanced Math (nonlinear)           │
│  Accuracy by difficulty: Easy 92% · Med 74% · Hard 51%     │
│  Badges / achievements (shape+label, not color-only)       │
│  Match history (filterable) · Accommodation status (private)│
└───────────────────────────────────────────────────────────┘
```
Opinion: the **skill breakdown by SAT domain** is the profile's reason to exist for
a test-prep audience — it converts "I'm Gold III" into "I should drill nonlinear
equations." Every chart ships with a screen-reader data table (see §4.4).

### 1.8 Leaderboard
Purpose: aspiration + social proof, without being demoralizing to the 90th percentile.

```
┌───────────────────────────────────────────────────────────┐
│  Leaderboard   [Global ▾][Friends][My school][This week ▾] │
│  Category filter: [All][Math][ELA][Mock] (chips)           │
├───────────────────────────────────────────────────────────┤
│  #   Player            Tier        Rating   W/L            │
│  1   ▮ Player          [Grandmaster] 2410    ...           │
│  2   ▮ Player          [Master]      2360    ...           │
│  ...                                                        │
│  ── your neighborhood ──                                    │
│  842 ▮ You             [Gold III]    1258    ...  ← pinned  │
│  843 ▮ Player          ...                                  │
└───────────────────────────────────────────────────────────┘
```
Opinions:
- **Always pin the user's own row + a window around it** ("your neighborhood"), so
  rank #842 sees a reachable #838 above them, not just the untouchable top 10. This
  single pattern is the difference between motivating and crushing.
- **Segments**: Global / Friends / My school / Weekly. Weekly and school ladders give
  mid-pack players a *winnable* board.
- Tiers shown by **badge shape + tier name**, never hue alone.
- Privacy: default display name is user-chosen; offer "hide from global board / show
  as Anonymous####" so ranking is opt-in-visible.

### 1.9 Settings
Purpose: put accessibility and fairness controls front-and-center, not buried.

```
┌───────────────────────────────────────────────────────────┐
│  Settings                                                  │
│  ▸ Accessibility   ← FIRST, and reachable in ≤1 click      │
│      Text size (slider 100–200%)                           │
│      Dyslexia-friendly font [toggle]                       │
│      High-contrast theme [toggle]                          │
│      Reduce motion [toggle: Auto / On / Off]               │
│      Colorblind-safe tier icons [Auto/On]                  │
│      Screen-reader math verbosity [Terse/Verbose]          │
│      Timer default: [Show/Hide]                            │
│      Keyboard shortcuts [view/remap]                       │
│      Extended-time accommodations [Set up →] (§4.7)        │
│  ▸ Account · ▸ Notifications · ▸ Privacy · ▸ Appearance     │
│  ▸ Theme: Light / Dark / System                            │
└───────────────────────────────────────────────────────────┘
```
Opinion: **Accessibility is the first settings group.** Also expose the most-used
toggles (text size, reduce motion, dyslexia font, timer default) via a **quick
"Aa / accessibility" button in the global top bar** so a student can change them
*mid-lobby* without spelunking. WCAG 2.2 *3.2.6 Consistent Help*: a help/accessibility
affordance sits in the same top-bar slot on every screen.

### 1.10 Practice mode
Purpose: pressure-free reps; the on-ramp and the cool-down; unranked.

```
┌───────────────────────────────────────────────────────────┐
│  Practice (unranked)                                       │
│  Pick focus:                                               │
│   [Domain ▾ Algebra] [Difficulty ▾ Mixed] [Length ▾ 10]    │
│   [ My weak spots ]  [ Missed-in-duels queue ]             │
│  Modes:                                                    │
│   ( ) Untimed  ( ) Timed solo  ( ) vs Bot (ranked-feel)    │
│  [ Start practice ]                                        │
│  Uses the exact same question frame as duels (no relearn). │
└───────────────────────────────────────────────────────────┘
```
Opinion: Practice **must reuse the match screen's question component verbatim** so
practicing *is* rehearsing the duel UI. The only differences: no opponent bar
(or a ghost/bot), timer optional, and immediate answer feedback available.

---

## 2. The match screen (deep dive)

This is the product. Design goal: **Bluebook's calm, familiar question frame,
wrapped in a thin, legible competitive chrome.**

### 2.1 Overall anatomy

```
┌── TOP CHROME (thin, ~56px) ───────────────────────────────────────┐
│ [You ● Gold III]      Q 4 / 10     ⏱ 09:12 [hide]     [Opp ● Gold II]│
│  ▓▓▓▓░░░░░░ your progress            (opponent progress: dots ●●●●○) │
├── QUESTION FRAME (Bluebook-like) ──────────────────────────────────┤
│                              │                                       │
│   LEFT: passage / stimulus   │  RIGHT: question stem + choices       │
│   (ELA long text, scrolls)   │   Q: ...                              │
│   [highlight] [annotate]     │   [A] ....         ⓧ  ← cross-out     │
│                              │   [B] ....         ⓧ                  │
│   —or— math figure/table     │   [C] ....         ⓧ                  │
│   centered, zoomable         │   [D] ....         ⓧ                  │
│                              │                                       │
├── BOTTOM CHROME (~52px) ───────────────────────────────────────────┤
│ [⚑ Mark for review]  [🖩 Calculator] [ƒ Reference]   [Q-nav ▾] [Next ▶]│
└────────────────────────────────────────────────────────────────────┘
```

Layout rules:
- **Two-pane split for reading (ELA) questions**, single centered column for math.
  This mirrors Bluebook exactly and is the single most important familiarity cue.
- Split is **user-resizable** (drag handle) *and* keyboard-adjustable, with a
  **stacked single-column fallback** at narrow widths / high zoom (see §4.5, §6).
- The question frame owns the majority of vertical space. Chrome is deliberately thin.

### 2.2 Showing the SAT question

**Long ELA passages:**
- Passage in the **left pane, independently scrollable**, generous measure
  (~65–75 characters/line), serif or high-legibility sans (see §3.1).
- **Highlight + annotate** tools (like Bluebook): select text → popover with
  highlight colors *and a text-note field*. Highlights persist per question and show
  in review. Annotations must be keyboard-invokable (select via keyboard caret,
  press `H` to highlight).
- **Line references** ("as used in line 12"): render line numbers in the passage
  gutter and make in-stem references jump/scroll-and-flash to the line.
- Sticky question stem: when the passage is long, the **stem stays pinned** at the
  top of the right pane so the student never loses the actual question while scrolling
  choices.

**Math figures / tables:**
- Figure **centered, on a clean card**, with a **zoom/lightbox** (pinch on touch,
  `+`/`-` or click on desktop). Never rely on tiny inline SVG.
- **Every figure has alt text** authored by the question author (mandatory field in
  the CMS) — this is both accessibility and a hedge against "the graph didn't load."
- Math notation rendered with **MathJax → MathML** (see §4.3), never as flat images,
  so it scales, reflows, and reads aloud.
- The **SAT reference sheet** (formulas) available via `ƒ Reference` button, in a
  dismissible panel, matching Bluebook.

**Answer choices:**
- Four choices, each a **large hit target (min 44×44 CSS px; never below WCAG 2.2
  2.5.8's 24px floor)**, full-row clickable, labelled **A–D with the letter in a
  circle**.
- **Selected** = filled circle + bold border + checkmark + "Selected" to SR — three
  redundant cues.
- **Cross-out / answer elimination** (Bluebook's signature): each row has an `ⓧ`
  toggle that strikes the choice through and dims it; press again to restore. Keyboard:
  focus a choice, press `X`. This is a *huge* familiarity and strategy feature — ship
  it day one.
- **Student-produced-response (grid-in) math**: numeric entry field with a live
  "your answer will be recorded as 3/4 = 0.75" echo, matching Bluebook's SPR preview.

### 2.3 The timer (without panic)

- **Single match clock** counting *down* (e.g., 10:00 for a 10-question duel),
  centered in the top chrome — **exactly where Bluebook puts it, and hideable exactly
  like Bluebook** (`[hide]` collapses it to a small clock icon; state persists per user
  as a default).
- **Per-question soft pacing** is shown subtly (a thin sub-bar that fills as you sit
  on one question) rather than a scary per-question countdown. Pace guidance
  ("~1:00/question") is available but off by default.
- **Last-60-seconds** treatment: the timer gets a **subtle** emphasis — it grows
  slightly and a single, gentle chime (respect audio settings). No red flashing, no
  screen shake. Reduced-motion users get a static bold state; SR users get **one**
  polite announcement at 1:00 and 0:30, not a running clock read-out.
- **Never** auto-submit-and-humiliate. At time-up, unanswered questions are marked
  and the match resolves to review calmly.

### 2.4 Your progress vs opponent progress (the anti-panic problem)

This is the subtlest design challenge. We want the *thrill* of a race without the
*dread* of watching yourself lose in real time.

Decisions:
- **Show opponent PROGRESS (how far along), not opponent SCORE (how many right).**
  You see "Opponent is on Q6" as **six dots, five filled** — you do **not** see
  whether they got them right. This preserves suspense (the outcome stays unknown
  until the end) and removes the demoralizing "I'm losing 3–6" live feed.
- **Represent opponent as position/pace, framed neutrally.** A small avatar+badge
  with a dotted progress track. No shared "racetrack" where two avatars visibly chase
  each other — that's maximal panic. Two *separate*, parallel progress indicators
  (yours = bar, theirs = dots) read as "status," not "chase."
- **Debounce and soften updates.** Opponent progress updates on question *completion*
  only, not keystroke-by-keystroke, and animates in gently (fade, ~200ms), never a
  jarring pop. For SR: opponent progress is an `aria-live="polite"`, **heavily
  throttled** region — announce at most on your *own* question transitions, phrased
  "Opponent has completed 5 of 10," never a live ticker (see §4.6).
- **"Focus mode" toggle**: one tap hides the opponent indicator entirely for students
  who play better solo. The match still resolves competitively; you just don't watch.
  Default is *shown but calm*; this makes it opt-out.
- **Two vibes, user-choice**: a **"Calm"** default (muted chrome, no sound, gentle
  motion) and an opt-in **"Hype"** mode (more color, a subtle crowd ambience, richer
  win/loss animation) for students who *want* the esports adrenaline. Store as a
  preference. Never force hype on anyone; never deny it to those who love it. This is
  the "user-driven design" value made concrete.

### 2.5 Embedded Desmos (calc-allowed queues only)

- **Floating, draggable, resizable Desmos panel** launched from the `🖩 Calculator`
  button — same mental model as Bluebook's built-in Desmos. Default position:
  docked right, ~40% width; drag to move, or **snap-dock left/right/float** (avoids
  WCAG 2.2 *2.5.7 Dragging Movements* traps by offering dock buttons, not drag-only).
- **Keyboard-openable and operable** (`C` toggles it), focus moves into it, `Esc`
  returns focus to the question. Desmos itself is reasonably a11y-instrumented; we
  wrap it with clear focus management and a visible "close/return to question" control.
- **Only present in `Math — Desmos OK` and `Full Mock` (calc section) queues.** In
  `Math — No calc`, the button is absent (not disabled-and-confusing), and we state
  "No calculator — this is a no-calc round" once at match start. Enforcement is a
  fairness feature: no calc button = no calc.
- **State is scratch-only and per-match** (not saved), matching test conditions.

### 2.6 Flag / skip / navigation mechanics

- **⚑ Mark for review** (Bluebook parity): flags the current question; flagged
  questions get a badge in the question navigator. Keyboard: `M`.
- **Skip = "Next without answering."** Students can move on and come back **within
  the same section** (matching real SAT module behavior), using the **Q-nav dropdown**
  (Bluebook's bottom navigator): a grid of question numbers showing *answered /
  unanswered / flagged* via **icon + label**, not color (e.g., ○ empty, ● filled,
  ⚑ flag).
- Guard rail: if you try to **finish** with unanswered/flagged questions, a
  **non-blocking confirm** ("You have 2 unanswered and 1 flagged — review or submit?")
  with keyboard focus landing on the safe default ("Review").
- **No destructive surprises**: navigating away never loses an answer; answers save
  on selection (optimistic + server-confirmed).

### 2.7 Bluebook fidelity checklist (ship these to feel "real")
- [x] Left/right passage-question split, resizable
- [x] Cross-out answer elimination (`X`)
- [x] Mark for review flag (`M`)
- [x] Hideable countdown timer, top-center
- [x] Bottom question-navigator grid
- [x] Highlight + annotate on passages
- [x] Embedded Desmos + math reference sheet
- [x] Student-produced-response (grid-in) with answer preview
- [x] Line-reference jump behavior

---

## 3. Design language

### 3.1 Typography (passage readability is the whole game)

- **Reading/passage font:** a high-legibility, generous-x-height sans such as
  **Inter, Source Sans 3, or Atkinson Hyperlegible** (Atkinson is literally designed
  for low-vision legibility — strong candidate for the default, and it doubles as an
  accessibility win). Body passage size **~18–20px default**, line-height **1.6–1.7**,
  measure capped at **~70ch**. These are non-negotiable for 200-word+ passages.
- **UI/chrome font:** same family or a tightly paired one; keep it to **one or two
  families** total to reduce cognitive load and payload.
- **Math:** rendered via MathJax; inline math matches surrounding size and scales
  with the text-size slider.
- **Dyslexia toggle:** switch the reading font to **OpenDyslexic** *and* bump
  letter/word spacing (the spacing matters as much as the glyphs). This is a **toggle,
  not the default** — evidence on OpenDyslexic is mixed, so we offer it, we don't
  impose it. Atkinson-Hyperlegible-as-default + OpenDyslexic-as-option is a defensible,
  research-aware stance.
- **Never** justify passage text (rivers hurt dyslexic readers); left-align, ragged
  right. Respect user text-size and OS-level font scaling.

### 3.2 Color system (rank & difficulty are NOT color-only)

Core rule: **information is carried by label + shape/icon + (optionally) position.
Color is the fourth, redundant channel.**

- **Difficulty tiers** (easy/medium/hard):
  - Easy = **● one-dot icon + "Easy"** (calm green-teal *as accent only*)
  - Medium = **◆ two-dot / diamond + "Medium"** (amber)
  - Hard = **▲ three-dot / triangle + "Hard"** (magenta-red)
  - The **shape + word** is the signal; hue reinforces. In grayscale you can still
    tell them apart by the dot-count/shape and the word.
- **Rank tiers** (Bronze→…→Grandmaster): each tier has a **distinct badge silhouette**
  (Bronze = shield, Silver = hex, Gold = star, Platinum = wing, Diamond = gem,
  Master = crown, Grandmaster = laurel) **plus the tier name**. Colorblind-safe by
  construction — remove all color and the badges are still distinguishable, and every
  badge has an SR label "Gold tier, division 3."
- **Correct/incorrect** in review: ✓/✗ **glyph + "Correct/Incorrect" text**, plus
  color. Never a bare green/red cell.
- **Contrast:** all text ≥ **4.5:1** (AA), large text ≥ 3:1, UI components/graphics
  ≥ 3:1 (2.2 *1.4.11 Non-text Contrast*). Provide a **High-contrast theme** that
  pushes to ~7:1 (AAA-ish) for low-vision users.
- Maintain a **colorblind-safe palette** validated against protanopia/deuteranopia/
  tritanopia (avoid red/green as the *only* differentiator anywhere; our shape system
  means we never rely on it).

### 3.3 Dark mode
- **First-class, not an afterthought** — teens study at night. Provide **Light /
  Dark / System**, defaulting to System (`prefers-color-scheme`).
- Dark mode uses a **near-black-but-not-pure-black** surface (~#12141A) to reduce
  halation; text at ~#E6E8EE (not pure white) — pure #000/#FFF at high contrast causes
  eye strain and ghosting, especially bad for long passages and for astigmatism.
- **Re-verify contrast independently in each theme** (a palette that passes in light
  can fail in dark). High-contrast theme available in both.
- Figures/charts must ship **theme-aware assets or CSS-tintable SVG** so a white-bg
  graph doesn't blind a dark-mode reader.

### 3.4 Motion design (exciting but respectful)
- **Where motion earns its place:** match-found reveal, question transitions,
  correct-answer confirmation, rank-up celebration, win/loss result. These are the
  "juice" moments that make it feel like a game.
- **`prefers-reduced-motion` is a hard gate**, not a nicety: when set, we
  **replace** motion with instant state changes or a simple cross-fade — never just
  "reduce." Specifically:
  - Rank-up confetti → a **static celebratory badge + text**.
  - Progress-bar fills → **instant** set, no easing.
  - Opponent-progress updates → no animation, just the new value.
  - Match-found "3-2-1" → a static "Match found — starting" panel.
- Motion budget: keep essential transitions **≤200ms**, celebrations **≤1.5s and
  skippable**. Nothing that flashes more than 3×/sec (seizure safety, 2.3.1).
- Never convey **required information via motion alone** (a pulsing element must also
  have a static label).

---

## 4. Accessibility (WCAG 2.2 AA as the floor)

We treat **keyboard-only** and **screen-reader** as primary personas who must be able
to complete a *ranked* match at the same competitive standard as anyone else.

### 4.1 Keyboard-only full play
Design the keymap first. Proposed defaults (all **remappable** in settings):

| Key | Action |
|-----|--------|
| `1`–`4` or `A`–`D` | Select answer choice |
| `X` | Cross out the focused choice (toggle) |
| `M` | Mark/flag for review |
| `Enter` / `N` | Next question |
| `P` | Previous question |
| `C` | Toggle calculator (calc queues) |
| `H` | Highlight current text selection |
| `F` | Toggle reference sheet |
| `T` | Toggle timer visibility |
| `G` | Open question-navigator grid |
| `?` | Open shortcuts help overlay |
| `Esc` | Close panel / return focus to question |

Rules:
- **Visible focus indicator everywhere**, ≥3:1 contrast, never removed. WCAG 2.2
  *2.4.11 Focus Not Obscured*: sticky headers/timer must **never cover the focused
  element** — we reserve scroll padding so a focused choice is always fully visible.
- **Logical tab order**: stem → choices A–D → cross-out toggles → mark/skip → nav.
- **No keyboard traps**; the Desmos panel and any modal trap focus *intentionally*
  and release on `Esc` back to the triggering control.
- A **`?` shortcuts overlay** is discoverable from the match screen and the help
  affordance.
- **Answer-with-number-keys is the headline feature** for competitive keyboard play —
  a keyboard user picks C by pressing `3`, as fast as a mouse user clicks.

### 4.2 Target sizes & pointer (2.2 additions)
- **2.5.8 Target Size (Minimum, AA):** every control ≥24×24px with adequate spacing;
  our answer rows and buttons target **≥44px** comfortably.
- **2.5.7 Dragging Movements (AA):** anything drag-based (split resizer, Desmos move,
  highlight selection) has a **non-drag alternative** (dock buttons, keyboard resize,
  tap-to-highlight-word).

### 4.3 Screen-reader strategy for MATH
This is the hardest accessibility surface in the app.

- Render all math with **MathJax outputting MathML** (with a11y extensions), so
  assistive tech reads expressions natively ("x squared plus 3 x") and users can
  **explore** expressions term-by-term (MathJax's built-in explorer). Provide a
  spoken-math verbosity setting (Terse/Verbose) in accessibility settings.
- **Figures, graphs, tables:** mandatory **author-written alt text / long
  description** in the CMS. A scatterplot gets a real description ("Scatterplot; as x
  increases from 0 to 10, y rises roughly linearly from 2 to 20") **plus**, where the
  data is small, an **accessible data table** the SR can read. A geometry figure gets
  a structural description ("Right triangle ABC, right angle at B, AB = 6, BC = 8").
- **Grid-in answers:** the numeric field has a clear label and an SR-friendly echo
  ("Recorded as three-quarters, 0.75").
- **No math-as-image, ever** (except decorative), because images don't scale, reflow,
  or read. This is a hard content rule enforced at authoring time.

### 4.4 Charts (profile/leaderboard) for SR
Every chart (rating-over-time, skill breakdown, accuracy-by-difficulty) ships with:
- a text summary ("Rating rose from 1100 to 1258 over 30 days, biggest jump on May 3"),
- a **toggle to an accessible data table** of the same data,
- non-color encodings (labels/markers).

### 4.5 Text scaling without layout breakage
- **1.4.4 Resize Text** + **1.4.10 Reflow:** the whole app must be usable at **200%
  zoom / 200% text** with **no horizontal scrolling** at 320px-equivalent width.
- Build in **rem/em units and CSS container queries**; the two-pane match layout
  **collapses to a single stacked column** (passage above, question below, tab between
  them) when width/zoom demands it — passage and question become **swipeable/tabbable
  panels** rather than shrinking to unreadable columns.
- **1.4.12 Text Spacing:** honor user overrides of line-height/letter/word/paragraph
  spacing without clipping — test with the text-spacing bookmarklet values.
- Our in-app **text-size slider (100–200%)** is redundant-but-friendly on top of
  browser zoom, because teens don't all know about browser zoom.

### 4.6 Focus management & aria-live etiquette during a LIVE match
The danger: a live 1v1 spams a screen reader into uselessness. Discipline:

- **Question changes** (your own navigation): move focus to the new question's stem,
  and let an `aria-live="polite"` region announce "Question 4 of 10, Medium." One
  concise message.
- **Opponent progress**: a **single, throttled** `aria-live="polite"` region.
  - Announce **at most on your own question transitions**, or debounced to **≤1
    update per ~20–30s**, phrased **"Opponent has completed 6 of 10."**
  - **Never** `assertive`. Never per-keystroke. Never "opponent answered question 3
    correctly" (we don't reveal correctness live anyway — see §2.4 — which
    conveniently also protects the SR experience).
  - Provide a setting to **mute opponent announcements entirely** (pairs with visual
    "Focus mode").
- **Timer**: **not** a live region (a ticking clock read aloud is torture). Announce
  only **at 1:00 and 0:30 remaining**, politely, and on demand via `T`.
- **Result/score**: on match end, focus moves to the result heading; `aria-live`
  announces "Match complete. You won. Rating 1258, up 18." Then focus is parked on the
  review controls.
- **Errors/disconnects**: `role="alert"` (assertive) is reserved for these
  genuinely-urgent, rare events only.

### 4.7 Extended-time accommodations (504/IEP) — and keeping ranked fair
The hard product+ethics problem: honor accommodations **and** keep the ladder honest.

Design:
- **A dignified setup flow** in Settings → Accommodations: choose your standard SAT
  accommodation (e.g., **+50% time / time-and-a-half**, **+100% / double time**,
  extra breaks). No documentation upload required to *play*; it's self-attested (we
  can't and shouldn't gatekeep like the College Board — but see fairness below).
  Status is **private** (never shown on profile/leaderboard).
- **Time is scaled per the accommodation** everywhere timed: a 10:00 duel becomes
  15:00 at time-and-a-half. Breaks are honored between sections in Full Mock.
- **Fairness model — recommended approach: a hybrid.**
  1. **Matchmaking respects accommodation as a bracket dimension.** By default, the
     matcher **pairs like-with-like** (a +50% player is preferentially matched to
     another +50% player) so both play under identical clocks — this is the cleanest,
     least-gameable fairness guarantee and needs **no score fudging**. When the pool
     is thin, fall back to cross-accommodation matches using rule 2.
  2. **Time-scaled scoring for cross matches.** When accommodation levels differ, the
     rating math evaluates **accuracy and pace-relative-to-your-own-clock**, not raw
     wall-clock finish. Practically: the "time" component of the outcome is normalized
     to each player's allotted time, so finishing your 15:00 in 12:00 counts like
     finishing a 10:00 in 8:00. Rating (Elo) is driven primarily by **who answered
     more correctly**, with pace as a **secondary tiebreaker**, computed per-clock.
  3. **A dedicated "Accommodated" ranked pool is offered as an opt-in** for students
     who prefer to only ever match like-with-like and see an accommodated leaderboard.
     Ratings can be unified or separate — **recommend a single unified rating** with
     accommodation-aware matching, because a separate pool risks feeling like a
     lesser/segregated ladder (against our dignity value) — but *offer* the segregated
     view for those who want it.
- **Anti-abuse (light touch):** accommodations aren't a "cheat to more time" because
  the primary path matches you against others with the *same* clock (rule 1) and cross
  matches normalize by clock (rule 2) — so claiming double-time gains you nothing
  competitively; it only changes *who you're matched with* and *your own comfort*.
  That removes the incentive to falsely claim it. Monitor for anomalies, but lead with
  design that makes cheating pointless rather than surveillance.
- **The whole thing is reversible and re-configurable** anytime, and clearly explained
  ("How accommodations affect ranked" help link, satisfying 3.2.6 Consistent Help).

### 4.8 Other WCAG 2.2 AA touchpoints
- **3.3.7 Redundant Entry:** never re-ask info we have (display name, email) within a
  flow; autofill where possible.
- **3.3.8 Accessible Authentication:** passwordless/SSO, no cognitive puzzle, no
  CAPTCHA (see §1.2).
- **2.4.11 Focus Not Obscured / 2.4.12:** sticky chrome never hides focus.
- **1.3.5 Identify Input Purpose:** autocomplete tokens on all profile fields.
- **Captions/transcripts** for any explainer video (how-it-works, rationale videos).
- **Language of page/parts** set correctly (matters for SR pronunciation of math and
  any non-English passage snippets).

---

## 5. User-driven design mechanisms (baked into the UI)

The "user-driven design" pillar becomes real only if feedback is **frictionless and
visible**.

- **Per-question "Report / Rate this question"** — available **both** inline in-match
  (a small `⋯` on each question → "Report issue" / "Rate difficulty") **and** in
  post-match review (larger affordance). In-match reporting is **one tap, non-blocking**
  (never interrupts the timer; it queues the report and you keep playing). Categories:
  *typo/error, ambiguous, wrong answer key, offensive, mis-tagged difficulty, other*.
  Reports feed a moderation queue and auto-lower a question's trust score at a threshold
  (pull suspect questions from ranked automatically).
- **Post-match micro-surveys** — a **single-tap** question on the results screen,
  rotated (e.g., "How fair did this match feel? 😞→😀", "Were the questions realistic?",
  "Right difficulty?"). One tap, optional, dismissible; never gates the flow. Sampled
  (don't show every match; ~1 in 5) to avoid fatigue.
- **Public roadmap + feature voting** (`/roadmap`): a Trello/Canny-style board with
  columns **Considering → Planned → In progress → Shipped**, each card **upvotable and
  commentable**. This *is* the user-driven-design promise made literal. Reachable from
  the top nav.
- **Changelog** (`/changelog` and a "What's new" card on Home): human-readable,
  student-friendly release notes; links each shipped item back to its roadmap card and
  credits "requested by the community" where true — closes the feedback loop visibly,
  which is what actually sustains contribution.
- **In-app feedback fab**: a persistent, unobtrusive "Feedback" affordance (also the
  Consistent-Help slot) so any screen can send a thought.

Opinion: **close the loop publicly.** The changelog crediting community requests is
what turns one-time reporters into repeat contributors — it's the highest-ROI
user-driven-design mechanic, cheaper than any survey.

---

## 6. Mobile / responsive strategy

**Can a live duel work on a phone? Yes — with deliberate degradation, not a shrunk
desktop.** Many teens will *only* have a phone.

- **Match screen on phone = stacked, tabbed single column:**
  - A segmented control at top: **[ Passage | Question ]** (for ELA). Math questions
    are single-column already (figure on top, choices below).
  - Choices are **full-width, thumb-sized rows** (≥48px), reachable in the bottom
    two-thirds of the screen (thumb zone). Primary `Next` is a bottom bar.
  - Timer + progress collapse into a **compact top strip**; opponent progress becomes a
    small "Opp: 6/10" chip (still non-panic).
- **Cross-out on touch:** long-press a choice or a small `ⓧ` on the row (with a
  non-drag tap alternative, per 2.5.7).
- **Desmos on phone:** opens as a **full-screen sheet** (not a tiny floating panel),
  with a clear "Back to question" bar; the question state is preserved.
- **Highlighting on phone:** native text-selection → highlight/ note popover; keep
  targets big.
- **What degrades gracefully / what we restrict:**
  - **Full Mock SAT (long, multi-module) is *discouraged but allowed* on phone** —
    we show a one-time "This is a long match; a larger screen is comfier" nudge, but
    don't block it.
  - **Landscape ELA** gets an optional two-pane if the phone is wide enough; otherwise
    tabbed.
  - **Orientation-agnostic** (1.3.4): never force portrait/landscape.
- **PWA / installable**, offline-tolerant for *practice* (queueing a ranked duel needs
  connectivity; practice packs can be cached).
- **Network reality:** duels are **turn/answer-synced, not twitch-synced**, so they
  tolerate mobile latency fine. We sync on answer-submit, show optimistic UI, and
  reconcile — a 200ms mobile ping never costs you a match (unlike a shooter).
- **Reduce data/motion on cellular:** lighter assets, and reduced-motion honored.

---

## 7. Empty, edge & failure states

Design these *first-class* — they're where trust is won or lost.

### 7.1 No opponents in the queue
- After a threshold (e.g., ~20–30s), offer graceful options **in priority order**:
  1. **"Widen rating range"** button (already visible) — matches you to a slightly
     broader band.
  2. **"Play a ranked bot match"** — a difficulty-calibrated bot that awards
     **provisional/reduced rating stakes** (clearly labeled "vs Bot — counts, reduced
     rating change"), so off-peak players still climb and never hit a dead end. *Opinion:
     this is essential for a cold-start marketplace.*
  3. **"Notify me when matched"** — queue in the background, get a ping, keep browsing/
     practicing.
- Never a spinner-forever. Always show elapsed time, expected wait, and an exit.

### 7.2 Disconnect mid-match
The trust-critical edge. Rules:
- **Grace + auto-reconnect:** on drop, show a **calm "Reconnecting…" overlay** (not
  "YOU LOST"), preserve local answer state, and attempt reconnect for a **grace window**
  (e.g., 30–60s). Server holds the match.
- **If you return in time**, you resume at your current question with your clock adjusted
  for fairness (pause or credit the lost seconds — recommend *pausing your clock during
  the outage* so a dropout isn't a time penalty).
- **If your opponent drops**, you're told "Opponent disconnected — waiting for them to
  return (0:45)…", with an option to **claim the win / take a draw** if they don't return,
  and **you are never forced to sit idle** — you can bank the current standing.
- **Rating protection:** a genuine disconnect (detected server-side) shouldn't tank your
  rating. Recommend: if you reconnect and finish, normal scoring; if the network truly
  fails, resolve to the **fairest partial outcome** (based on questions completed) with
  **damped rating impact**, and never award a "loss by disconnect" for a first offense.
  **Serial rage-quitters** get escalating penalties (pattern-detected), so the protection
  isn't abusable.
- **Full transparency in review:** the match record shows "ended early — disconnect" so
  the result never feels arbitrary.

### 7.3 First-time user with no rank
- **No scary "Unranked 0" void.** New players enter **placement**: their first
  **~5 duels are "Placement matches"** with a **provisional badge (a "?" tier / dashed
  outline)** and a "Placing you — X of 5" progress. Rating swings are larger during
  placement so they converge fast, then we assign a starting tier with a little
  celebration.
- **First-run onboarding**: a **≤60s interactive tutorial duel vs a bot** that teaches
  the four controls that matter (select answer, cross-out, flag, calculator) *by doing*,
  not a wall of text. Skippable, and the tutorial *is* a real practice question so it
  never feels like busywork.
- **Leaderboard for a new user** shows "Play your placement matches to appear on the
  board" rather than a demoralizing "#4,000,000."
- **Empty profile / history** states are encouraging and action-oriented ("No matches
  yet — your rating history will grow here. [Play your first duel]").

### 7.4 Other edges (quick hits)
- **Match found but you're AFK** at the ready screen → auto-decline after a countdown,
  no penalty the first time, return to lobby.
- **Question fails to load / image broken** → the mandatory alt text renders, plus a
  "Report load issue" and the question is **voided from scoring** (never penalize a
  student for our bug).
- **Tie / draw** on questions → resolve by our secondary metric (per-clock pace);
  surface "Tiebreak: pace" transparently.
- **Both players finish** → immediate transition to a shared "calculating result…"
  (≤1.5s) then review.
- **Server maintenance** → a friendly banner, ranked paused, practice still available
  offline where cached.

---

## 8. Summary of strongest recommendations
(See final message.)
