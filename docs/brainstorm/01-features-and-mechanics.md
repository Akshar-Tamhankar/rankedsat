# RankedSat — Product Features & Competitive Game Mechanics

**Status:** v0.1 brainstorm · **Date:** 2026-07-17
**Scope:** Product features and competitive game mechanics for a ranked 1v1 digital-SAT duel app.

---

## 0. Design North Star (read this first)

Every decision below is filtered through three questions:

1. **Does it make the student solve more real SAT questions?** The moat is *practice volume disguised as competition*. If a feature adds fun but reduces questions-solved-per-session, it loses.
2. **Does a loss teach?** Every duel must end with the loser one concept closer to a higher score. A ranked-anxiety app that doesn't raise scores dies on word-of-mouth.
3. **Is it fair to a slow-but-accurate student?** The SAT rewards accuracy, not raw reflex. A mechanic that turns the digital SAT into a twitch reaction game trains the wrong skill and will be (correctly) resented. Speed is a *tiebreaker and a tension source*, never the primary axis.

**Opinionated stance:** The two biggest failure modes for this genre are (a) becoming a reflex-clicking game that doesn't transfer to the real test, and (b) mismatched matchmaking that makes 90% of duels feel unfair. We design against both explicitly.

---

## 1. The Core 1v1 Match Loop

### The tension we're engineering
A duel needs a *live "I'm ahead / I'm behind" signal* to create adrenaline, but it must not punish careful reading. The design trick: **let players see pace, not answers.** You know your opponent has answered 3 of 5; you don't know if they're right. This preserves suspense to the last reveal and rewards accuracy over panic.

### Three candidate formats

#### Format A — "Sprint" (Race-to-N, first-to-lock scoring) — *NOT recommended as launch*
- Both players get the **same ordered question set**, served one at a time.
- First to correctly answer question *k* earns the point and both advance; wrong answer locks you out of that question for the round and lets the opponent steal.
- First to **N=5 correct** (ELA/Math-only) or a time cap wins.
- **Why it's tempting:** maximum head-to-head tension, clean "steal" moments.
- **Why we reject it for launch:** it's a speed-reading game. On real SAT reading passages (long, dense), race-to-lock rewards skimming and guessing over comprehension — trains the wrong instinct and feels unfair to strong-but-methodical students. Keep it as a **later "Blitz" party mode**, not core.

#### Format B — "Standard Duel" (simultaneous fixed set, speed-as-tiebreaker) — ✅ **RECOMMENDED LAUNCH FORMAT**
- Both players receive the **same set of questions simultaneously**, can move at their own pace within the round, cannot see each other's answers.
- **Scoring is accuracy-first, speed-second:**
  - Each correct answer = **100 base points**.
  - **Speed bonus** = up to **+30 points**, scaled by *how much of the allotted per-question time you had left when you locked* (linear decay). A correct-but-slow answer still beats a fast wrong answer by a wide margin (100 vs 0).
  - Wrong answer = **0** (no negative marking — matches real digital SAT, which has no guessing penalty).
- **Difficulty tier multiplier:** Easy ×1.0, Medium ×1.15, Hard ×1.35 applied to the *base + speed bonus*. This makes hard questions worth chasing and lets a player who nails one hard item claw back from two easy misses.
- **Live UI:** progress pips for both players ("opponent: 3/5 answered") + a **hidden score bar** that only fills on the post-answer micro-reveal, so momentum swings feel earned.
- **Why this wins:** it's the closest to real test conditions (accuracy dominant), it's fair to methodical students, and speed still creates genuine tension and a reason to build fluency — which *is* a real SAT skill (pacing).

#### Format C — "Best-of-3 Rounds" (momentum format) — *recommended as a ranked variant in v2*
- Match = best of 3 short rounds; each round is a mini Standard Duel of 3 questions with escalating difficulty (Easy → Medium → Hard).
- Win a round by higher round-score; first to 2 round-wins takes the match.
- **Why keep it in reserve:** the round structure creates comeback narratives and natural "clutch" moments (the Hard question decides it), which is great for retention and highlight moments — but it roughly doubles match length. Ship it once we have enough concurrent players that matchmaking is fast, so total session time stays reasonable.

### Recommended launch spec (Format B, concrete numbers)

| Queue | Questions | Per-question soft timer | Hard match cap | Notes |
|---|---|---|---|---|
| Math (No-Calc) | 6 | 60s | 7 min | |
| Math (Desmos allowed) | 6 | 75s | 8 min | Desmos embedded; timer accounts for tool use |
| ELA (Reading & Writing) | 5 | 90s | 8 min | Longer passages get more time |
| Full Mock Duel | 12 (6 ELA + 6 Math) | mixed | 18 min | "Boss match," see §8 |

- **Per-question soft timer:** when it expires, you *can still answer* but earn **zero speed bonus** and a subtle "overtime" flag. This keeps slow-accurate players in the game (no auto-fail) while still rewarding pace.
- **Overall winner:** highest total score at match end.

### Tie-breakers (in order)
1. **Higher accuracy** (count of correct answers) — accuracy is the sport.
2. **Higher combined difficulty** attempted-and-correct (rewards choosing/answering hard items well).
3. **Total time** (faster wins) — only now does raw speed matter.
4. **Sudden-death question:** one fresh Hard question, first correct lock wins; if both wrong, first to answer next one. (Rare, but guarantees resolution and makes a fun spectator moment.)

### How difficulty tiers factor in (summary)
- Tiers set **point multipliers** (×1.0 / ×1.15 / ×1.35).
- Matchmaking uses tiers to **compose fair sets**: two similarly-rated players get sets of matched difficulty distribution; a higher-rated player in a cross-rating match gets a slightly harder set (a built-in handicap that keeps rating changes meaningful).
- Tiers feed the **rating expected-score model** (harder set = higher variance, damped rating swing).

---

## 2. Ranked System

### Rating engine
- **Glicko-2 over raw Elo.** Glicko-2 adds a *rating deviation* (confidence) and *volatility*, which matters a lot for teenagers who binge then vanish for two weeks — it prevents a rusty returner from being brutally mismatched and rewards consistency. Publicly, we still *call* it "Elo" in marketing copy because students know that word (chess/League cachet).
- **Hidden MMR drives matchmaking; visible rank drives emotion.** Standard live-service split: matchmaking uses the true Glicko number; the player sees a friendlier tier/division ladder.

### Tier ladder (visible)
Named to feel aspirational and SAT-flavored without being cringe:

| Tier | Divisions | Vibe |
|---|---|---|
| **Bronze — "Warm-Up"** | III → I | Everyone starts here after placements |
| **Silver — "Scholar"** | III → I | |
| **Gold — "Honors"** | III → I | |
| **Platinum — "AP"** | III → I | |
| **Diamond — "Dean's List"** | III → I | |
| **Ascendant — "Valedictorian"** | III → I | Top ~2% |
| **Perfect Score (1600 Club)** | single, leaderboard-ranked | Top 200 globally, live ranked #1…#200 |

- **Divisions** climb III → II → I within a tier; each promotion is a small celebration, tier promotions are a *big* one (see feel-good below).
- **1600 Club** is a pure ladder (numeric rank) to give the top a visible race — this is the aspirational screenshot that spreads on social.

### Placement matches
- **5 placement duels** on first play (per rating pool — see §3). Wider matchmaking net during placements. Opponent-rating-weighted results place you Bronze → Gold depending on performance. Show a "Calibrating…" bar, not a rank, until placements finish — avoids demoralizing a strong player stuck at Bronze I on game one.

### Seasons
- **6-week seasons** (aligns with test-prep cadence and the actual SAT test-date calendar — a season can crescendo into a real test weekend).
- **Soft reset** each season: compress toward the mean (e.g., new_display = mean + (old − mean) × 0.6) rather than hard reset, so grinders keep most of their standing but everyone re-climbs enough to re-engage.
- **Season rewards:** cosmetic borders, animated name effects, a profile badge ("Season 3 — Diamond"), and an end-of-season **"Score Report Card"** (see §4) that doubles as a shareable flex *and* a study summary.

### Rank decay
- **Diamond and above only**, and gentle: after **14 days inactive**, lose a small amount of division progress (never drop a full tier from decay). Below Diamond: **no decay** — casual students must never feel punished for having a busy week. Decay is a top-of-ladder integrity tool, not a retention whip.

### Promotion / demotion "feel-good" mechanics
- **Promotion series optional, not mandatory:** hit the threshold and you're promoted immediately (no stressful best-of-3 gate that modern players resent). Reserve a *celebratory* "Promo Match" only for tier-ups, framed as a victory lap vs a bot-boosted or slightly-below opponent so it usually succeeds.
- **Demotion shield:** on entering a new tier you get a **3-game shield** — you can't demote out of a tier immediately after promoting. Kills the yo-yo frustration.
- **Loss-streak mercy:** after 3 straight losses, next matchmaking is nudged slightly easier and you get a "Bounce-Back Bonus" (extra XP for the next win). Quietly counter-tilts.
- **Never show LP/rating dropping in red as the last thing on a loss screen.** Lead the loss screen with *what you learned* (missed-question review, §4), then the small rating change. Emotional sequencing matters for teens.

---

## 3. Per-Category vs Unified Rating

### Recommendation: **Separate ELA and Math ratings, plus a derived "Overall."**

- **Two primary ratings: `ELA Elo` and `Math Elo`.** These are genuinely different skills; a strong-math/weak-verbal student and the reverse both exist in huge numbers. Unifying them would create chronically unfair duels (a math ace queuing ELA gets crushed) and hides the diagnostic signal students actually want.
- **Sub-queues share their parent rating.** Math No-Calc, Math Desmos, and Math-only all draw from **one Math Elo** (with a small per-mode adjustment offset, since Desmos changes difficulty). Rationale: splitting into 5 separate ladders fragments the matchmaking pool and makes queues slow — fatal at launch when population is small. One Math number, one ELA number.
- **Overall / Composite = a transparent blend** shown on the profile and used for the *global* leaderboard: `Composite = round((ELA + Math) / 2)`, mirroring how the real SAT reports a combined score out of 1600. This gives one number to flex while preserving two numbers to train.
- **Full Mock Duel uses Composite** for matchmaking and updates *both* ELA and Math ratings (weighted by the section that produced each result), so the "boss mode" feeds everything.

**Nice side effect:** the ELA-vs-Math gap is itself a coaching insight — "Your Math is Diamond but ELA is Silver; here's where your points are." That's a differentiator vs generic quiz apps (§7).

---

## 4. Retention & Progression

### Post-match review — *the single most important retention feature*
- **"Rematch the Question" review screen** immediately after every duel: every missed question, with the correct answer, a short worked explanation, and *the distractor logic* ("you picked B — that's the trap if you misread the graph axis").
- **"Turn losses into learning" loop:** each missed question can be **banked to a personal Mistake Deck**. Clearing your Mistake Deck (re-solving banked questions correctly later) grants XP and a "Redemption" cosmetic streak. This literally converts losing into a progression currency — the emotional judo that makes ranked losses tolerable for teens.
- **Concept tagging:** every question is tagged (e.g., "linear equations," "command of evidence," "comma splices"). Post-match shows a mini weakness heat-map. Over time this builds a **personal weakness profile** that powers Daily Challenges.

### Streaks
- **Daily play streak** (play ≥1 duel) with a *forgiving* streak-freeze economy: earn a "Streak Shield" every 7 days, auto-consumed on a missed day (à la Duolingo, but we cap the guilt). Streaks are for habit, never for rank.
- **Accuracy streak** within and across matches ("12 correct in a row") — a separate flex stat with its own cosmetic rewards.

### Daily challenges & quests
- **Daily "Warm-Up" (solo, un-ranked):** 5 questions targeted at your weakest tagged concept from your weakness profile. Completing it grants XP + a small rating-protection token (a "Mulligan" — see below). Keeps students who are rank-anxious engaged without queuing.
- **Weekly quests:** "Win 3 Math No-Calc duels," "Bank and clear 10 mistakes," "Beat someone rated above you." Quests deliberately reward *behavior that improves scores*, not just playtime.
- **Mulligan token:** a challenge-earned consumable that lets you void a single duel's rating loss (not the result, just the rating hit). Reduces tilt-quitting; capped at 1 held at a time so it can't be hoarded into rank inflation.

### XP, levels, cosmetics
- **Account XP / level** is separate from rank (rank = skill, level = dedication). Levels unlock cosmetic slots: avatar frames, answer-lock animations ("your correct answer slams in with a stamp"), duel emotes ("gg", "clutch"), profile themes, leaderboard name colors.
- **No pay-to-win, ever.** Cosmetics only. This is a study product for minors — monetization must never touch fairness or rating. (Battle-pass-style seasonal cosmetic track is a fine later monetization lane; questions and rating stay free.)
- **"Knowledge cosmetics":** some cosmetics are unlocked by *mastery*, not grind — e.g., a golden "Geometry" badge for 90%+ accuracy across 50 geometry questions. Flexing mastery > flexing playtime.

### Rematch
- **One-tap Rematch** on the results screen (both must accept, 10s window). Instant re-queue against the same opponent keeps hot rivalries going and slashes matchmaking wait — great for retention *and* for the loser's "run it back" urge.
- **Rivalry tracking:** head-to-head record vs anyone you've dueled 3+ times, surfaced as a light "You lead 4–3" banner. Manufactured rivalries are extremely sticky.

---

## 5. Social & Competitive Extras

- **Friend duels (challenge link):** direct-challenge a friend via code/link; un-ranked by default (protects both ratings), with an optional "ranked friendly" toggle. Zero-friction sharing is the primary growth loop for a teen product — the invite link IS the marketing.
- **Spectate:** watch a live duel (friends' matches, or top-ladder featured matches) with a slight delay to prevent answer-relaying. Spectating top players is both entertainment and *implicit teaching* ("how does a 1600-club player approach this passage?").
- **Async "Ghost" duels:** for off-peak hours / small population, duel a recorded "ghost" run of a same-rated player (their timing replayed). Solves the cold-start empty-queue problem — critical early. Clearly labeled as async so it never feels deceptive.
- **Tournaments:** scheduled bracket events (e.g., weekly "Math Cup"), single-elimination, with a spectatable final. Great for hype spikes and Discord community building.
- **School vs School:** students self-attest their school; aggregate school score = sum/avg of top N students' seasonal performance. Drives *organic peer recruitment* ("we need more people to beat rival high") — potentially the strongest viral loop for this demographic. Guardrail: schools are display-only, self-attested, moderated for abuse; never expose individual minors' data by school without care.
- **Seasonal events:** themed events around real SAT test dates ("March Test Prep Sprint"), plus fun ones ("Pi Day Math Marathon"). Limited-time cosmetics drive return visits.
- **Clubs / study squads (later):** small groups with a shared leaderboard and group quests — social accountability is a proven retention multiplier for studying.

---

## 6. Anti-Cheat & Integrity (feature level)

The threat model for a *study* app is milder than for money games, but leaderboard integrity still matters for trust. Principles: **server-authoritative everything, degrade gracefully, don't punish the honest.**

- **Server-side timing & scoring:** the client never computes score or authoritative time. Server timestamps question-served and answer-received; client clock is untrusted. Prevents time/score spoofing outright.
- **Question pool rotation & large item bank:** the core defense against answer-sharing is *volume*. A large, continuously-rotated bank plus per-match randomized selection and answer-choice-order shuffling makes memorizing/sharing answers impractical. Never reuse the exact same served set for a given player.
- **Randomized answer ordering + question variants:** shuffle option order per player; where possible use auto-generated numeric variants of the same template so two colluding players don't even see identical items.
- **Tab-switch / focus detection — nuanced tradeoff:**
  - *Do* detect blur/visibility-change and log it as a **soft signal** (feeds a trust score), and optionally pause the duel with a visible "you left the match" indicator to the opponent.
  - *Don't* hard-auto-forfeit on a single blur — students legitimately use the Desmos tab, a screen reader, assistive tech, or get a system notification. Auto-forfeit on blur is an accessibility landmine (violates our accessibility-first pillar) and generates false-positive rage. Instead: repeated/patterned blurs (esp. correlated with fast correct answers) lower a hidden trust score and gate leaderboard eligibility.
- **Behavioral anomaly detection (later):** flag statistically implausible patterns — e.g., consistent sub-2-second correct answers on Hard reading questions — for shadow review, not instant bans. Adjust their MMR pool ("suspected" pool) quietly rather than confronting, which avoids false-positive drama with minors.
- **Rate limiting & one-account-per-human hygiene:** device/account heuristics to limit smurf/boost farms; account age + placement gating before a rating counts toward the *global* leaderboard.
- **Report + human review** for harassment (emotes/usernames) — safety for a minor-heavy userbase is table stakes; restrict social surfaces (no free-text chat at launch; canned emotes only).
- **Explicitly out of scope for v1:** webcam proctoring, keystroke biometrics, lockdown-browser enforcement. Wrong tool for a *practice* product; kills trust and accessibility. Integrity comes from item-bank volume + server authority + trust-scoring, not surveillance.

---

## 7. Differentiators — Why This Is Sticky

### vs. SAT prep incumbents (Khan Academy, UWorld, Bluebook)
- **They are solo and effortful; we are social and compulsive.** Khan/UWorld are "eat your vegetables." RankedSat makes practice *feel like the thing you do instead of homework*. Same questions, opposite emotional pull.
- **Live human opponents create stakes** that a static question bank never can. "One more duel" beats "one more practice set."
- **Bluebook is the official test interface but has no engagement layer.** We deliberately mimic Bluebook's *look and interaction model* (question format, Desmos, mark-for-review, digital-SAT feel) so practice transfers 1:1 — but wrap it in progression. **"Practice on an interface that feels like the real Bluebook, in a game you actually want to open."**
- **Diagnostic-as-a-byproduct:** separate ELA/Math Elo + concept heat-maps give students a clearer, continuously-updated picture of their weaknesses than a one-time diagnostic test — for free, as a side effect of playing.

### vs. quiz-battle / engagement apps (QuizUp, Duolingo leagues)
- **QuizUp died because its content was trivia with no real-world payoff.** Our content has a *high-stakes external goal* (a real SAT score, college admissions). That gives every duel genuine meaning QuizUp never had — the stakes are imported from real life.
- **Duolingo nails habit but its "battles"/leagues are shallow.** We take Duolingo's streak/league retention machinery and bolt it onto *true 1v1 skill competition with a real Elo*, not a weekly XP-farm leaderboard. Skill expression is deeper and the ceiling (1600 Club) is aspirational.
- **The learning loop is the differentiator, not just the fight:** Mistake Deck + post-match review means we're the rare competitive app where *losing makes you measurably better at the real goal.* That's the retention flywheel: play → lose → learn → improve → climb → flex → recruit friends.

### The one-line pitch
**"Ranked ladder for the SAT — real questions, real opponents, real score gains. Climb from Bronze to the 1600 Club."**

---

## 8. Recommended MVP Feature Cut

### v1 — "The Duel" (ship this, keep it tight)
Goal: prove the core loop is fun *and* teaches. Smallest thing that's genuinely compelling.

- **One match format:** Standard Duel (Format B), accuracy-first scoring.
- **Three queues only:** **Math (Desmos)**, **Math (No-Calc)**, **ELA**. *(Defer Full Mock and Math-any to concentrate the small matchmaking pool.)*
- **Glicko-2 rating, shown as "Elo,"** with **separate Math & ELA ratings** + a displayed Composite.
- **Simple tier ladder** (Bronze → Ascendant) + **global leaderboard** (Composite). 1600 Club can be a stub ("top players" list) at first.
- **5 placement matches.**
- **Post-match review + Mistake Deck** (non-negotiable — this is the learning moat).
- **One-tap Rematch.**
- **Bluebook-faithful question UI + embedded Desmos** for the calc queue.
- **Server-side timing/scoring; large rotating item bank; answer-order shuffle; blur = soft-signal logging only.**
- **Ghost/async duels** as the cold-start fallback so the queue is never empty.
- **Daily Warm-Up** (weakness-targeted solo set) for the rank-anxious and for retention on day 1.
- **Basic accounts, friend challenge link** (un-ranked) — the growth loop.
- Cosmetics: minimal (avatar frame + a couple of unlocks) — enough to signal progression, not a full economy.

### v2 — "The Ladder Comes Alive"
Goal: deepen competition and retention once population supports it.

- **Full Mock Duel** ("boss mode," 12 questions, updates both ratings).
- **Math (calc-allowed, unified)** queue + Math No-Calc distinction refinements.
- **Best-of-3 Rounds** ranked variant (Format C) for comeback drama.
- **Seasons** (6-week) with soft reset, season rewards, Score Report Card.
- **Full 1600 Club** live numeric ladder.
- **Streaks, weekly quests, XP levels, fuller cosmetic track** (incl. battle-pass-style seasonal cosmetics as first monetization — cosmetics only).
- **Spectate** (friends + featured matches).
- **Rivalry tracking** + ranked friend duels.
- **Promotion celebrations, demotion shield, loss-streak mercy** polish.
- **Concept heat-map / weakness profile** surfaced as a proper dashboard.

### v3+ / Later — "Community & Scale"
- **Tournaments** (scheduled brackets, spectatable finals).
- **School vs School** (the big viral bet — needs moderation + scale first).
- **Clubs / study squads** with group quests.
- **Seasonal themed events** tied to real test dates.
- **Blitz party mode** (Format A) as an un-ranked fun mode.
- **Behavioral anomaly anti-cheat**, trust-pool matchmaking, deeper integrity tooling.
- **Adaptive difficulty coaching / "recommended next duel"** driven by the weakness profile.
- Possible **PSAT / ACT / AP** ladders as separate rating pools once SAT is proven.

### What we deliberately DON'T build early
- No free-text chat (safety; canned emotes only).
- No pay-to-win anything, ever.
- No proctoring/surveillance anti-cheat.
- No 5-way split Math ladders (pool fragmentation).
- No mandatory promo-series gates (frustration).

---

## Appendix — Open questions to resolve before build

1. **Item bank size at launch:** how many vetted, Bluebook-faithful questions per tier/concept do we need so rotation actually deters answer-sharing? (Rough floor: low thousands.) This is the true gating resource.
2. **Cold-start population:** ghost duels bridge it, but what's the minimum concurrent-user threshold before real-time queues feel alive? Consider a soft launch scoped to a few schools / a subreddit.
3. **Legal/COPPA-adjacent:** minors' data, school attestation, leaderboard PII — needs a privacy pass before school-vs-school ships.
4. **Question sourcing/licensing:** real-*style* (not copyrighted College Board items) — original items authored to spec, or licensed. Affects cost and bank size directly.
5. **Speed-bonus tuning:** the +30 cap is a guess; playtest whether it creates good tension without pushing students toward reckless skimming. Instrument accuracy-vs-speed and adjust.
