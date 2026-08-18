# RankedSat — Onboarding, User-Driven Design, Community, Safety & Growth

**Doc status:** Brainstorm / working draft
**Owner:** Product
**Last updated:** 2026-07-17

**Context:** RankedSat is a competitive web app where high-schoolers (~14–18) play ranked 1v1 duels on real-style digital SAT questions. Core pillars are an Elo-style rating + global leaderboard, difficulty tiers (easy/medium/hard), and queue categories (Full Mock SAT, ELA-only, Math-only, Math+Desmos, Math no-calc). Design values: accessibility-first, user-driven design.

This doc covers: (1) onboarding, (2) practice vs. ranked, (3) user-driven design as an ongoing process, (4) community & virality, (5) teen safety & trust, (6) monetization, (7) launch strategy.

---

## 1. Onboarding Flow — Landing to First Match in Under 3 Minutes

### 1.1 Guest-first, not account-first

**Opinionated call: default to instant guest play.** Every extra step between landing and "see a question on screen" loses students, and this audience (14–18, TikTok-native, low patience for forms) will bounce off a signup wall. Account creation should feel like an *unlock*, not a *toll booth*.

Flow:

1. **Landing page** — one headline ("Duel someone, right now, on real SAT questions"), one big button: **"Play Now"**. Secondary, smaller link: "I have an account."
2. Click "Play Now" → auto-generate a **guest identity** (fun animal/name combo like `SwiftFalcon482`, avatar auto-assigned) with a **local session token**, no email, no password. This is the account, just unclaimed.
3. Straight into **calibration flow** (see 1.2) — no tutorial video, no modal wall of text.
4. First match starts. Total elapsed time target: **under 3 minutes**, most of it spent actually solving the first question, not clicking through screens.
5. **After the first match ends**, prompt once: *"Save your rank so it doesn't disappear — sign up in 10 seconds"* with Google/Apple/email one-tap. Guests who don't convert keep playing on that browser's local session (rating persists via localStorage + server-side guest ID) but get a **persistent, non-annoying banner** ("Your rank is temporary — claim it") after every match. Cap guest play at, say, 5 matches before a soft-gate ("create an account to keep your streak") — generous enough to prove value, firm enough to convert.

Why this over account-first: account-first onboarding is optimized for retention metrics that look good on a dashboard but kill top-of-funnel volume, which is what a brand-new product needs most. You can always tighten the guest cap later once you have organic traffic; you can't easily undo a signup wall's reputation once "RankedSat makes you make an account before you even see a question" is the story that spreads.

### 1.2 Calibration (unranked placement) matches

- **3–5 unranked placement duels** immediately after guest creation, covering a mix of categories and difficulties (adaptive: start medium, go up/down based on correctness+speed, similar to chess placement or Duolingo's placement test).
- Frame it explicitly as *not* real: banner reads **"Placement Duels — 3 of 5 — your real rank starts after this."** This removes anxiety about "losing" before you've learned the UI, which matters a lot for a test-anxious audience.
- Opponent for placement matches: **not another live placement user** (too fragile to matchmake precisely) — instead match against a **"ghost" of a real past match** (replay of an actual student's answer timing/choices at estimated similar skill) or a calibrated bot. This solves the cold-start liquidity problem (see 3.6) and guarantees instant matches with zero queue time during onboarding, which is the single biggest onboarding-drop risk in any live-matchmaking product.
- Output: an initial Elo seed + a **diagnostic card** ("You're strongest in Algebra, weakest in Command of Evidence reading questions") — immediately useful, non-competitive value even before ranked begins. This double-purposes calibration as a diagnostic tool, which is also a growth/retention hook (see 4).

### 1.3 Teaching the format without a boring tutorial

Do not use a click-through tutorial modal or a video. High schoolers skip both. Instead, **teach through the first live match itself**, contextually:

- **Turn 1 of placement match 1 only**: a single, dismissible tooltip pointing at the timer ("Answer before time runs out — faster correct answers score more") and one pointing at the opponent's progress indicator ("See how far they've gotten"). Two tooltips, total, ever. Auto-dismiss after 4 seconds or on first click.
- **Learn-by-losing-a-point, not by reading**: if a student times out on the very first question, show a friendly one-line inline toast, not a modal: "Time's up! Next time, a partial guess beats no guess." That's the whole tutorial for time pressure.
- Scoring/format rules (how Elo moves, what "ranked" means) live in a **persistent, optional "How duels work" link** in the corner — available, never forced.
- Consider a **skippable 15-second animated explainer** only on the landing page (not in-app) for a visual "here's what a duel looks like" preview — this helps conversion from external shares/ads more than it helps in-product retention, so it belongs pre-signup, not post.

### 1.4 Concrete first-session target sequence

| Time | Screen |
|---|---|
| 0:00 | Land, click "Play Now" |
| 0:05 | Guest identity created, pick avatar (optional, skippable) |
| 0:10 | Category select: default-highlighted "Full Mock Duel" but Math-only / ELA-only visible as equal options |
| 0:15 | Placement match 1 begins vs. ghost opponent |
| ~2:30 | Placement matches 1–3 complete (fast, low question count each, e.g., 3 questions/match) |
| 2:45 | Diagnostic card + seeded rank shown |
| 2:50 | First **real ranked** queue starts automatically with a "Find Match" button already highlighted |
| 3:00 | Live match found (near-instant due to bot/ghost fallback if queue is thin) |

This is aggressive but should be the design target; every added screen should have to justify its existence against this budget.

---

## 2. Practice Mode vs. Ranked

### 2.1 Purpose split

- **Ranked** = the core competitive loop, Elo on the line, drives leaderboard/community/virality.
- **Practice ("Drill Mode")** = zero-pressure, same question bank, solo or async, exists to (a) let anxious/new users build confidence before facing an opponent, (b) let anyone warm up, (c) function as an actual SAT study tool independent of the dueling hook, which widens the addressable audience beyond "kids who like competitive games."

### 2.2 Drill Mode design

- Same question bank, same tiering (easy/medium/hard) and same category splits (ELA/Math/Math+Desmos/Math no-calc), but:
  - **No opponent, no timer pressure by default** (optional self-timer toggle for those who want SAT-realistic pacing practice).
  - **Untimed explanations shown immediately after each answer** (ranked matches should NOT show explanations mid-match — save that for post-match review, see 3.1 — but Drill Mode's whole point is learning, so explain instantly).
  - **Targeted drilling**: "Practice my weak spots" pulls from the diagnostic card / post-match analytics (e.g., "you're at 52% on Command of Evidence — drill 10 of those").
  - **Streaks, not ranks**: gamify practice with a streak counter and XP, deliberately *not* Elo, so it never feels like "ranked lite" — different reward system reinforces it's a different, safe space.
- Practice mode explicitly should **not** touch ranked Elo, even indirectly, or students will "sandbag" practice to avoid risk, defeating its purpose.

### 2.3 Warm-up queue (the funnel from practice to ranked)

- **"Warm-Up Duel"**: a semi-competitive middle tier — 1v1 like ranked, same UI/tension, but **explicitly rating-neutral** (no Elo change win or lose). This is the actual bridge: it has the social/competitive thrill of a duel without the fear of tanking your rank.
- Placement flow: Guest → Placement (ghost matches) → **first Warm-Up duel vs. real human** (this is likely the first real live opponent, and it should feel exciting, not scary, because nothing is at stake) → then a clear, single CTA: **"Ready for Ranked?"**
- Ongoing: any user can toggle between Ranked queue and Warm-Up queue at any time from the same queue screen — never force a mode change, always let users self-select their risk tolerance for the session (this is core to "user-driven design" — respect that a kid who's had a bad day at school doesn't want their rank on the line tonight).
- Practice → Warm-Up → Ranked should read as a visible, low-friction on-ramp in the UI itself (e.g., a horizontal stepper or three clearly-labeled tabs: Practice / Warm-Up / Ranked), so users always know which "gear" they're in and can shift down without shame. Avoid any implication that Practice/Warm-Up are "for beginners only" — frame them as legitimate ongoing modes (top-ranked players should visibly also use Practice to drill weak spots, normalizing it).

---

## 3. User-Driven Design as an Ongoing Process

This is a design *value*, not a launch feature — it needs permanent infrastructure, not a one-time survey.

### 3.1 In-app feedback loops

- **Per-question micro-rating**: after seeing the explanation (post-match review or in Drill Mode), a single tap: 👍/👎 "Was this question clear/fair?" plus an optional one-line "Report an issue" (wrong answer key, ambiguous wording, broken Desmos rendering). This is the single highest-leverage feedback loop because it directly protects content quality, which is the product's credibility foundation — a single bad/wrong answer key going viral on TikTok ("RankedSat's question is literally wrong") is a real reputational risk for an SAT-prep-adjacent product.
- **Post-match 1-tap survey**: immediately after a match, one tap, one question, rotated (not stacked) so it never feels like homework:
  - "How fair did the matchmaking feel?" (⭐1-5, or simpler: 👍/😐/👎)
  - Occasionally swap in: "Did the difficulty feel right?" or "Anything frustrating this match?" (opens a 1-line text box only if they tap "yes, tell us")
  - Never more than one question, ever, per match. Multi-question post-match surveys will get ignored/skipped and train users to auto-dismiss.
- **Route all of this to a lightweight internal dashboard** tagged by question ID / category / difficulty so the content and matchmaking teams can see rot forming (e.g., a specific question with declining 👍 rate = pull and review it).

### 3.2 Public roadmap with voting

- A public, always-linked (footer + profile menu) roadmap — a simple Trello-style board or a tool like Canny: **Now / Next / Later / Shipped** columns.
- Students can submit ideas and upvote others' (no login needed to view, login required to vote/submit to prevent spam and to let you notify the requester when shipped — a great re-engagement trigger: "The feature you asked for just shipped").
- **Close the loop publicly**: when something ships, tag it back to the roadmap card and, ideally, credit the top requesters by username in patch notes. Being *named* as the reason a feature exists is a powerful reason for a teenager to stay engaged and evangelize.
- Curate categories relevant to this audience specifically: "New Question Packs," "Matchmaking/Queue," "UI/Accessibility," "New Modes," "Cosmetics" — this also doubles as market research on what to build next without guessing.

### 3.3 Discord community

- Launch a Discord **on day one**, even before the product is polished — it's cheaper than building in-app community features and it's where this demographic already lives (SAT-prep Discords are already large and active).
- Structure: `#announcements`, `#bug-reports`, `#feature-requests` (mirror/feed into the public roadmap), `#find-a-duel-partner` (for friend challenges), `#general`, `#study-tips`, and critically **`#beta-testers`** (private, invite-only channel — see 3.4).
- Staff it with a couple of enthusiastic early users as community moderators once the server has traction — gives power users a role/status, which is itself a retention hook, and offloads moderation.
- Bot integration ideas (later, not launch-blocking): a Discord bot that posts your RankedSat rank/leaderboard position on command, or auto-posts weekly tournament brackets.

### 3.4 Beta-tester program with real students

- Recruit a small (30–75 student) beta cohort **before public launch**, sourced from: a couple of AP-adjacent Discord SAT servers, a tutoring center or two willing to refer students, and personal/friend networks of anyone founding this.
- Give beta testers a **visible, permanent badge/flair** ("Founding Duelist" or similar) on their profile forever — cheap to build, high perceived value, and turns early testers into long-term evangelists because they got in "before it was cool."
- Structure light-touch, recurring feedback: a private beta Discord channel + a **bi-weekly 20-minute video call with 3-5 students** (see 3.5) rather than a one-time survey. Ongoing conversation surfaces things forms don't.
- Compensation: doesn't need to be cash — early access to new features, cosmetics, cash-value gift cards for the most active bug reporters, or public shoutouts work well for this age group.

### 3.5 Running lightweight usability tests with high schoolers

Practical constraints specific to this population: short attention spans, school schedules, parental consent needed if recording/compensating minors, and a strong dislike of feeling "studied."

- **Keep sessions to 15–20 minutes max**, run over video call or screen-share, 1 student at a time (think-aloud protocol) — 3-5 students per round is enough to catch most usability issues (classic Nielsen "5 users" heuristic still holds).
- **Recruit via the Discord/beta program**, never cold-approach minors; get a parent/guardian's awareness or consent if you plan to record sessions or compensate — treat this identically to how you'd treat any research involving minors, even informally.
- Test **one flow at a time**: e.g., "Get a brand-new fake account to your first ranked match" — watch where they hesitate, what they click first without prompting, what they ask about out loud.
- Prioritize **task-based over opinion-based** testing at this stage of the product — watching a student silently struggle to find the Math+Desmos queue is more useful than asking "do you like the UI?"
- Run these **on every major flow before it ships**, not just at launch — onboarding, new mode launches, redesigns of the match screen, etc. This is the operational core of "user-driven design as an ongoing process," not a one-time milestone.

### 3.6 Metrics to watch

Core funnel and health metrics, roughly in priority order for a competitive live-matchmaking product:

| Metric | Why it matters |
|---|---|
| **Time-to-first-match** | Direct proxy for onboarding friction; target < 3 min (see Section 1) |
| **Queue abandonment rate** (% who leave the queue before a match is found) | The #1 silent killer of matchmaking products — if this is high, either liquidity is too low (need bots/ghosts as fallback) or wait times are perceived as too long even when actually short (needs UI reassurance: live queue-position/estimated-wait indicators) |
| **Match completion rate** (% of started matches finished, not rage-quit/abandoned) | Proxy for both UX friction and toxicity/frustration; segment by rating gap — mismatched Elo probably drives quits |
| **D1 / D7 / D30 retention** | Standard cohort health; D1 tells you if onboarding delivered on its promise, D7 tells you if the core loop has legs, D30 tells you if it's habit-forming |
| **Guest-to-account conversion rate** | Validates the guest-first onboarding bet (1.1) — if this is low, the soft-gate/value prop before signup needs work |
| **Practice → Warm-Up → Ranked funnel conversion** | Tests whether the on-ramp (Section 2.3) actually works, or whether people get stuck in Practice and never duel |
| **Per-question 👍/👎 ratio and flag rate** | Content quality/trust signal (3.1) |
| **Rematch rate / friend-challenge send rate** | Early signal of organic, non-paid virality (Section 4) |
| **Rage-quit rate by category/difficulty** | Flags specific question sets or matchmaking bands causing frustration — actionable at the content level |
| **Session length + matches per session** | Distinguish "quick warm-up user" from "binge duelist" — useful for tuning notification/re-engagement cadence without over-pinging |

Build a simple internal dashboard early (even a spreadsheet + a scheduled export job is fine pre-scale) — don't wait for "enough data to justify tooling."

---

## 4. Community & Virality

### 4.1 School leaderboards and school-vs-school events

- Let users optionally tag a **school** on their profile (self-reported, no verification needed at launch — verification is a v2 trust feature, not a launch blocker) → unlocks a **school leaderboard** view and a **school's aggregate rank** (e.g., average or top-10 Elo).
- **School vs. school events**: a recurring (e.g., monthly) bracket where schools are matched head-to-head, aggregating results from students opting in during an event window. This taps directly into existing school rivalry culture (mirrors things like Kahoot's classroom energy or athletic rivalries) and is a strong organic-growth mechanic: a student who wants their school to win will recruit classmates to sign up and play, at zero CAC.
- Display school leaderboards prominently and make them **easy to share** (auto-generated "Lincoln High is #3 in the state!" card, see 4.4).

### 4.2 Friend challenges via share link

- One-tap **"Challenge a Friend"** generates a short link (e.g., `rankedsat.com/duel/x7k2`) that, when opened, drops the friend straight into a private 1v1 lobby with the sender — no account required to accept if the recipient is also willing to guest-play, mirroring the low-friction guest-onboarding philosophy from Section 1.
- Let the challenger pick category and difficulty before sending, so the link itself communicates "hey, wanna do a Math no-calc duel?"
- This is the cheapest, highest-intent viral loop available (game-to-game invites consistently outperform generic "invite a friend" CTAs) — make the share button impossible to miss right after a match ("Rematch a friend?" prompt post-loss is a strong hook, since people want to redeem themselves).

### 4.3 Tournaments

- **Weekly bracket tournaments**, entry gated by **rank tier** (e.g., separate brackets for Bronze/Silver/Gold-equivalent tiers) so newer players aren't steamrolled by top-1% players in their first tournament — this matters a lot for a test-anxious audience (see Section 5).
- Keep format tight: single-elimination or short Swiss format, running over a bounded window (e.g., Saturday morning, 90 minutes) so it fits a teenager's schedule and creates a shared "event" moment worth talking about — recurring appointment viewing/playing is a strong retention lever.
- Tournament winners get **a distinct, time-stamped cosmetic/badge** ("Week 14 Gold Bracket Champion") — permanent, bragging-rights-driven, never something you can buy (see Section 6).
- Consider category-specific tournaments occasionally (an "ELA-only" tournament week, a "Math no-calc" tournament week) to spotlight underused queue categories and give niche-strong players their moment.

### 4.4 Shareable post-match result cards

- Auto-generate a clean, on-brand image after every match (and especially after a win, a personal-best streak, or a tournament placement): score, opponent, category, rating change, maybe a highlight stat ("Answered a Hard question in 11 seconds"). One-tap download or direct share to Instagram Story / Snapchat / TikTok.
- This is a proven growth mechanic in this exact demographic (Duolingo streak cards, Wordle grids, Spotify Wrapped, chess.com game-review cards all lean on this) — make the card **genuinely good-looking** and **fast to generate** (sub-second), because a clunky or ugly share card won't get shared regardless of the underlying feature value.
- Include a subtle, always-present QR code or short URL on the card so it's a real acquisition funnel, not just decoration.

### 4.5 Teacher/classroom mode as a growth channel

- A lightweight **Teacher Dashboard**: a teacher creates a "class" (a join code/link, no student PII beyond what they already choose to share via username), students join, teacher sees **aggregate** class performance by category/skill (never public-shames individual students — see Section 5 on FERPA-conscious design).
- Use case for teachers: an SAT-prep unit or homeroom "warm-up" where kids duel each other for 10 minutes as a low-stakes formative-assessment/engagement tool — teachers get a genuinely useful classroom tool, RankedSat gets 20-30 new student sign-ups per classroom adoption at essentially zero CAC per user.
- This is a strong **B2B2C growth channel**: one teacher champion can bring in an entire class or even a whole school (feeds directly into the school-leaderboard/school-vs-school mechanics in 4.1). Prioritize building outreach materials (a one-page teacher pitch, a "how to run a classroom duel day" guide) once a handful of teachers organically ask for this — don't over-invest before there's signal.
- Long-term optionality (not a launch feature): teachers assigning specific Practice/Drill sets as homework, tied to the same question bank — keeps the classroom use case sticky without turning RankedSat into "just another assigned homework tool" that kids resent.

---

## 5. Teen Safety & Trust

This audience is 14–18; a meaningful fraction will be minors under 13-adjacent scrutiny concerns and definitely under COPPA/FERPA-adjacent norms if any school affiliation exists. Trust and safety needs to be designed in from day one, not bolted on.

### 5.1 Minimal PII collection

- Collect the **absolute minimum**: for guest play, nothing at all beyond a device/session token. For a registered account: email (or OAuth via Google/Apple, which is actually *more* private since you never see/store the password and can rely on the provider's own age-signal data) and a self-chosen username/avatar. **No real name required, ever, for the core product.**
- School tagging (Section 4.1) should be **free-text or a dropdown of public school names**, not tied to any school-issued identity system, and never mandatory.
- Do not collect birthdate beyond what's needed for a coarse age gate (see 5.2) — store it minimally, don't build marketing profiles around it.
- No location tracking beyond what's needed for basic fraud/abuse prevention (e.g., coarse IP-based signals for anti-cheat), and no ad-tech style device fingerprinting.

### 5.2 COPPA/FERPA awareness — 13+ age gate

- **COPPA** applies to services that knowingly collect PII from children under 13. RankedSat's target is 14-18, so the correct move is a **clear 13+ age gate at signup** ("You must be 13 or older to create an account") — this is the standard, well-trodden compliance path (same approach most social/gaming products take) rather than trying to build COPPA-compliant parental-consent flows for under-13s, which is a much heavier lift not worth taking on pre-launch.
- If self-reported age puts someone under 13, **block account creation** with a polite explanation, and don't retain their input data beyond what's needed to enforce the block.
- **FERPA** is relevant primarily if/when the Teacher/Classroom mode (4.5) ties into actual school-issued rosters or grade-relevant data — mitigate by keeping classroom mode opt-in-by-join-code (student chooses to join, not administratively enrolled) and by never storing or exposing anything that looks like an education record (grades, disciplinary data, etc.) — RankedSat's data (Elo, question performance) is arguably not a FERPA "education record" at all as long as it's not sourced from or reported back into official school systems, but staying conservative here (no data-sharing agreements with schools without proper legal review) avoids the ambiguity entirely at this stage.
- Put a plain-language, teen-readable **Terms/Privacy summary** (not just a wall of legalese) on the signup screen — a 3-bullet "what we collect / what we don't / how to delete your data" box goes a long way for trust with both students and any parent who checks.

### 5.3 Username moderation

- **Real-time filtering** at username creation: block slurs, sexual content, harassment terms, and impersonation patterns (e.g., "admin," "moderator," staff-sounding names) using a maintained blocklist plus a fuzzy-matching layer (leetspeak substitutions are the classic evasion — `4dm1n`, `n1gg*`, etc.).
- **Community reporting**: any username can be reported (see 5.5 for reporting infra); repeated approved reports trigger a forced rename, not just a ban, to keep the account/rating history alive while removing the harmful identity.
- Default auto-generated guest usernames (Section 1.1) should be pulled from a curated, pre-approved word list, so there's zero risk at the point of lowest friction (guest creation, no human review in the loop).

### 5.4 No open chat at launch — emotes/preset messages instead

- **Do not ship open freetext chat in v1.** Open chat between strangers, in a competitive setting, with a 14-18 audience, is one of the highest-risk surfaces in the entire product (harassment, grooming risk, trading of contact info, general toxicity) and moderating it well requires infrastructure (real-time filtering, human review queue, escalation flows) that isn't worth building before the core product has proven itself.
- Instead: a curated set of **preset messages/emotes** — "Good game!", "Nice one!", "Close one!", "Rematch?", a handful of fun reaction emotes (👏 🔥 😅 🤝) — triggerable via quick-tap during/after a match. This preserves the social/sportsmanship layer of competitive play without the open-text risk surface.
- If/when open chat is ever considered (post-launch, with real moderation investment), gate it behind mutual "friends" only (not stranger-matchmaking chat), never open by default, and treat it as a major safety-review project of its own — not a checkbox feature.

### 5.5 Toxicity prevention in a competitive setting

- Because there's no open chat, most classic toxicity vectors are already closed off. Remaining surfaces to guard:
  - **Post-match reporting**: one-tap "Report opponent" after any match, with lightweight categorized reasons (cheating suspected, inappropriate username, unsportsmanlike emote spam).
  - **Emote spam throttling**: rate-limit preset-message/emote spam within a match so it can't be used to harass (e.g., max 1 per 5 seconds).
  - **Anti-cheat basics**: flag statistically implausible performance (e.g., inhuman answer speed + accuracy combos) for review — cheating is itself a trust/toxicity issue in a ranked ladder, since it poisons the leaderboard's credibility.
  - **Escalating consequences**: warnings → temporary matchmaking suspension → account suspension, applied consistently and explained to the user (transparency reduces the "this is unfair" blowback that itself becomes a toxicity/trust spiral).

### 5.6 Healthy-competition framing (avoiding test-anxiety amplification)

This is worth treating as a first-class design principle, not an afterthought, given the product sits directly on top of a genuinely stressful topic (the actual SAT) for this age group.

- **Reframe losses as learning, explicitly in copy**: post-loss screens should never just say "You Lost." Pair the result with something like *"You got 7/10 — here's the Command of Evidence question that tripped you up"* — the loss is immediately paired with a concrete, actionable takeaway, not just a scoreboard L.
- **"Hide opponent progress" mode**: an optional toggle (on by default for new/anxious users, discoverable via settings) that hides the opponent's live progress bar/score during a match, showing only your own pace. This removes the "I can see them beating me in real time" panic spiral while keeping the format's structure intact — the result still gets revealed at the end.
- **Separate "practice anxiety" from "competitive thrill" by design**, not just messaging — this is exactly why Practice/Warm-Up/Ranked exist as three distinct, freely-switchable gears (Section 2.3). Never force a user who's had a bad week into ranked exposure to keep playing at all.
- **Elo decay/loss-streak messaging**: avoid punitive language or visuals (red down-arrows, ominous sounds) on rating loss; use neutral, calm color/tone. Consider a **soft-floor** mechanic (rating can't drop below a tier's floor from a single bad session, or diminishing Elo loss after consecutive losses) so a genuinely bad night doesn't spiral into a demoralizing rank collapse that drives someone off the product entirely.
- Consider a **"cooldown" nudge**: after, say, 3 consecutive ranked losses, a gentle, dismissible prompt — *"Rough stretch — want to switch to Practice for a bit?"* — never blocking, always skippable, but a genuine expression of the "healthy competition" value rather than pure engagement-maximization.
- Avoid SAT-score-anxiety bleed-through: never claim or imply a RankedSat Elo *is* or directly predicts an official SAT score — be explicit that this is a skills/speed practice tool, not a diagnostic guarantee, both for honesty and to avoid amplifying real test anxiety with a number that feels like a verdict.

---

## 6. Monetization — Not Pay-to-Win, Not Paywalled Learning

**Guiding principle: the question bank, ranked play, practice mode, and core competitive experience are free forever, for everyone.** This is both an ethical stance (it's an education-adjacent product for teenagers, many without independent income) and a strategic one (any perception of "pay to get better questions" or "pay to win matches" will be called out immediately and loudly by this audience on social media, and will poison the brand faster than almost anything else).

### 6.1 What stays free forever

- Full question bank across all difficulty tiers and all categories (Full Mock, ELA, Math, Math+Desmos, Math no-calc).
- Ranked matchmaking, Elo, and the global + school leaderboards.
- Practice/Drill Mode and Warm-Up queue.
- Core post-match analytics and the diagnostic/weak-spot tracking.
- Tournaments (entry should never cost money — see 6.4).
- Basic profile customization (at least one avatar/color option free, not just a locked default).

### 6.2 Cosmetics

- Purely visual: avatar skins, profile borders/frames, victory animations, custom emote packs (still from the safe/preset set — Section 5.4 — just stylistically different, e.g., a "confetti" vs. "fire" GG animation), leaderboard name colors/flair.
- **Never tied to performance** — anyone can buy any cosmetic regardless of rank, and separately, some cosmetics should be **earned, not bought** (tournament badges, seasonal ladder-climb rewards, beta-tester flair) to keep a prestige tier that money can't touch, which matters a lot for credibility with a savvy teen audience that's quick to sniff out "pay to look better."
- Keep prices low and teen-wallet-realistic ($1-5 range for individual cosmetics, avoid loot-box/randomized mechanics entirely — gambling-adjacent mechanics aimed at minors is both an ethical and likely regulatory landmine, skip it outright).

### 6.3 Supporter badge

- A simple, modestly priced (e.g., $2-3/month or a one-time "Founding Supporter" purchase) **cosmetic-only badge** next to the username, signaling "I support this project" — no gameplay benefit whatsoever, explicitly marketed as a donation-with-a-thank-you, not a feature purchase. Chess.com's "diamond membership" badge and similar community-supporter models are a reasonable reference point, minus any of their gameplay-adjacent perks.

### 6.4 Ad-free tier

- If ads are ever introduced (e.g., non-intrusive banner/interstitial ads between matches to fund server costs at scale), offer a **paid ad-free tier** — this is the most defensible "pay for convenience, not power" model and is well-understood/accepted by users across the freemium-gaming space.
- Strong recommendation: **delay ads entirely until there's real scale**, and when introduced, keep them minimal (no ads *during* a match or on the question screen itself — that would directly harm the learning/competitive experience and feel exploitative given the audience).

### 6.5 Explicitly rule out

- Any purchase that affects matchmaking, question difficulty, Elo, or win probability.
- Paywalling any question, category, or difficulty tier.
- "Energy"/lives systems that throttle free play and sell refills (classic mobile F2P predatory pattern — wrong fit entirely for an education-positioned product and a teen audience).
- Randomized/loot-box cosmetic purchases.
- Selling user data or ad-targeting based on performance data.

---

## 7. Launch Strategy

### 7.1 Where to find the first 100 users

Go where SAT-prep-motivated teens and their communities already are, and lead with genuine value/fun rather than a hard sell:

- **r/Sat and r/ApplyingToCollege** (Reddit) — post as a real builder sharing a project, not a marketer; Reddit's SAT-adjacent communities are large, highly engaged, and quick to try free tools, but equally quick to punish anything that reads as spam — one well-written "I built this, would love feedback" post from a personal account outperforms any paid placement here.
- **Existing SAT-prep Discord servers** — many large, informal SAT/college-prep Discords already exist; the beta-tester recruitment (3.4) and general launch both benefit from respectfully asking server admins if you can share the tool (most will welcome a genuinely useful free tool if you're not spamming and you engage authentically first).
- **TikTok "StudyTok"** — this is likely the highest-leverage channel for this exact age group. Approach: partner with or seed content among a small number of existing studytok creators (many already post "SAT tips," "day in my life studying," "study with me" content) rather than trying to build a RankedSat-branded TikTok following from zero. A compelling format: "I challenged [creator] to a live SAT duel" or "POV: you're in Bronze rank losing to a 9th grader" — competitive, screen-recorded gameplay clips are inherently shareable and self-explanatory in a 15-30 second clip.
- **Personal networks + local schools**: if any founder/early team member has a personal connection to a high school (sibling, cousin, former teacher), a single classroom pilot (tie into 4.5, Teacher Mode) can seed 20-30 real users in a day with high-quality, real feedback attached.
- **College Confidential forums and Instagram SAT-meme accounts** — smaller but low-effort additional surfaces; several large Instagram accounts post SAT memes/tips to sizeable teen followings and are often open to a free shoutout in exchange for early access or affiliate-style credit.

### 7.2 What a compelling launch hook looks like

- **The hook should be the format itself, demonstrated, not described.** "1v1 SAT duels" is inherently a strong, visual, easily-understood hook — lean into showing it (a 20-second screen recording of two usernames racing through a Hard math question, rating going up in real time) rather than explaining it in a paragraph.
- **A specific, ownable claim**: something like *"The first ranked ladder for the SAT"* or *"Duolingo's streaks meet chess.com's ladder, for the SAT"* — comparisons to products this audience already loves and understands (Duolingo, chess.com, Kahoot) instantly communicate the mechanic without a tutorial.
- **A live, visible leaderboard from day one**, even with a small user base — an empty or fake-looking leaderboard undercuts the entire "ranked/competitive" premise; better to launch narrow (e.g., one city, one Discord community, one school) and have a genuinely live, populated Top 50 than to launch broad with a leaderboard that looks empty.
- **A launch-week tournament** (Section 4.3) timed to the public launch — gives press/social posts a concrete, time-bound event to point to ("Join the launch-week bracket, winner gets Founding Champion flair forever") rather than a vague "sign up whenever."
- **First-100-users exclusivity**: explicitly tell the first cohort they're getting a permanent "Founding Duelist" badge (ties to 3.4) — turns early adopters into invested evangelists rather than passive testers, and gives you a natural, honest scarcity hook for outreach copy ("first 100 spots get founding status").
- Keep the ask simple everywhere this gets shared: **one link, guest play in one click, first match in under 3 minutes** (Section 1) — the launch hook only works if the actual first-session experience delivers on it immediately; any launch strategy is downstream of onboarding actually being fast.

---

## Summary of Strongest, Most Opinionated Calls

1. Guest-first onboarding with a generous free-play cap before any signup wall — no accounts required to see the product's value.
2. Placement matches run against bots/ghost replays, never live-matched strangers, to guarantee near-instant first matches regardless of real-time queue liquidity.
3. Teach the format contextually inside the first live match (two tooltips, max) — no tutorial video, no click-through modal.
4. Practice / Warm-Up / Ranked as three permanently visible, freely-switchable gears — never force competitive exposure, and normalize top players using Practice too.
5. Per-question 👍/👎 and a public, voteable roadmap are permanent infrastructure, not launch-only features — content trust and user-driven design both depend on always-on feedback loops.
6. No open chat at launch — preset emotes/messages only; open chat is deferred until real moderation investment exists.
7. "Hide opponent progress" mode and loss-as-learning copy are first-class anti-test-anxiety design choices, not nice-to-haves, given the product sits on top of a genuinely stressful topic for this age group.
8. Cosmetics/supporter badges only — hard rule against anything affecting matchmaking, Elo, or question access; free-forever core loop is both an ethical stance and a viral-backlash-avoidance strategy.
9. School-vs-school leaderboards and Teacher/Classroom mode are the highest-leverage, lowest-CAC growth channels — they turn existing school rivalry and classroom structure into organic acquisition.
10. TikTok StudyTok creator seeding + a live, populated (even if narrow) leaderboard from day one are the strongest launch hooks — the ranked-ladder premise collapses if the leaderboard looks empty at launch.
