# RankedSat — Rating, Matchmaking, Leaderboard & Architecture Brainstorm

Context: solo developer, competitive 1v1 SAT-duel web app for ~14-18 year-olds. Queues: Full Mock SAT, ELA-only, Math-with-Desmos, Math-no-calc. Goal of this doc: concrete, opinionated, low-cost recommendations — not an exhaustive survey.

Where a claim depends on external pricing/legal terms that change over time (Desmos API terms, cloud pricing), I've flagged it as "verify before relying on."

---

## 0. TL;DR — the 10 calls I'd actually make

1. **Glicko-2**, not Elo, not TrueSkill. Start at rating 1500, RD 350, volatility 0.06. Update per-match (treat each duel as its own tiny rating period), not in batched periods.
2. **Decouple player rating from question difficulty.** Rating comes purely from match win/loss. Question difficulty is a separate IRT-lite parameter used for content selection/calibration, never blended into the Elo math.
3. **3 rating tracks, not 5**: Overall, ELA, Math. Calculator mode (Desmos-allowed vs not) is a *matchmaking filter*, not a rating fork — don't fragment an already-small pool five ways.
4. **Bots = unranked practice only. Ghost matches (replayed real human runs) = ranked-eligible cold-start filler.** This is the honest way to keep queues populated at launch without lying to users about who they're facing.
5. **Never build original CB items into the bank.** Original in-house questions + public-domain R&W passages + LLM-drafted/human-reviewed pipeline. Market as "SAT-format," not "official," with a non-affiliation disclaimer.
6. **Dedicated Node/Socket.IO match server** (in-memory, per-room authoritative state) + Postgres (Supabase-hosted) + Redis (Upstash) — not Supabase Realtime or Firestore as the authority for live duel logic. Realtime DB changefeeds are the wrong primitive for per-second timer/turn state.
7. **Desmos's own "Test Mode" API embed** for the calculator — same calculator College Board's real Bluebook app uses. Don't build a calculator clone.
8. **Leaderboard: plain indexed Postgres query first.** Add Redis ZSETs only once Redis is already in the stack for matchmaking (it will be) — at that point they're nearly free to add.
9. **Gate the leaderboard by both minimum games (≥15-20) and RD threshold**, and sort by a conservative score (`rating - 2×RD`), not raw rating — kills the "3-match wonder at #1" problem using data you already have.
10. **Anti-cheat is mostly about not leaking the answer key and trusting server timestamps, not fancy ML.** Server strips answer fields from payloads; server clock is the only clock that matters; flag (don't auto-ban) accuracy/speed anomalies for manual review.

---

## 1. Rating Math — Elo vs Glicko-2 vs TrueSkill

### The three options, honestly assessed

| System | Fit for RankedSat |
|---|---|
| **Elo** | Simple, single scalar, everyone's heard of it. But has no notion of *confidence* — a brand-new player and a 200-match veteran both move by the same fixed K, which either makes new-player ratings converge too slowly (low K) or makes the whole system noisy (high K). With a small starting pool, you want new players to find their real rank fast without destabilizing everyone else. Elo alone doesn't give you that lever. |
| **Glicko-2** | Adds **RD (rating deviation)** — a confidence interval — and **volatility (σ)** — how erratic a player's recent results have been. New players start with high RD, so their first ~15-25 games move them quickly toward their true skill; established players with low RD move less per game, which stabilizes the leaderboard. RD *increases* during inactivity, which is exactly the "hasn't played in months, don't fully trust this rating" signal you want for a casual student audience with bursty play patterns (exam season spikes, then silence). Well-documented, moderate implementation effort, used by Lichess and other modern 1v1 ladders. |
| **TrueSkill / TrueSkill2** | Built by Microsoft for team-based multiplayer (Bayesian factor graphs to disentangle individual skill from team outcome). RankedSat is strictly 1v1 — you get none of TrueSkill's actual value-add (team disentanglement) and pay for its implementation complexity (factor graph inference vs. Glicko-2's closed-form update). It's also historically carried patent/licensing baggage tied to Microsoft that's worth independently verifying before building on it commercially. Not worth it here. |

**Recommendation: Glicko-2.**

### Concrete parameters

- Starting rating: **1500**
- Starting RD: **350** (max uncertainty, per Glickman's own defaults)
- Starting volatility σ: **0.06**
- System constant τ (controls how much volatility can change): **0.3–0.5** — lower is more conservative/stable, reasonable default for a game where a single bad night shouldn't wildly swing volatility.
- **Rating periods:** the original Glicko-2 paper assumes batched periods (e.g., all of a player's games in a day, processed together). For a real-time duel app, use the common practical simplification: **treat each individual match as its own one-game rating period**, updating immediately against the opponent's rating/RD at that moment. This is what most live 1v1 ladder implementations actually do; it's a well-trodden simplification, not a novel risk.
- **"Provisional" flag:** while RD > ~200 (roughly first 10-15 games), show a "Provisional" badge next to the player's rating and *exclude them from public leaderboards* (see §6). This stops a 3-0 lucky streak from parking a brand-new account at #1 overnight, which would look broken to everyone else and undermine trust in the ladder on day one.

### How difficulty tier interacts with rating — it mostly doesn't, on purpose

The tempting-but-overbuilt design is to blend item difficulty (IRT) directly into the pairwise rating update (essentially building your own hybrid Elo-IRT system — this is a real research area, e.g. competitive-programming "Elo-MMR," and it's genuinely hard to get right). **Don't build that for v1.** Instead, run two independent systems:

- **Player Rating (Glicko-2):** driven purely by match outcome (did you win the duel, by whatever scoring rule — see below).
- **Question Difficulty (IRT-lite):** driven purely by aggregate answer correctness across all players who've seen that question (§4). Used for *content selection* (which difficulty tier of questions a match at rating X draws from) and *calibration* (is this question actually as hard as its author thought), never fed back into the Elo math itself.

This keeps both systems simple, debuggable in isolation, and avoids a whole class of subtle bugs where a mislabeled question distorts real rating outcomes.

**Match outcome rule (v1):** determine win/draw/loss by total questions answered correctly in the duel, tiebreak by total time. Don't do per-question Elo micro-updates within a match — keep the rating update at the match level. A "margin of victory" scaling (win by a landslide = slightly bigger rating swing) is a reasonable v1.5 enhancement once the base system is live and you have data to tune it against, not a v1 requirement.

---

## 2. Ratings Per Category — avoid fragmenting a small pool

Five fully independent per-queue ratings (Mock SAT / ELA / Math-Desmos / Math-no-Desmos, plus maybe Overall) sounds appealing for granularity but is the wrong call at launch: **each independent ladder needs its own critical mass of players in a similar rating band for matchmaking to work**, and splitting a few hundred early users five ways means every queue except the most popular one has painfully thin matchmaking.

**Recommendation: 3 tracks — Overall, ELA, Math.**

- **Overall**: updated by every duel regardless of mode. This is the marquee/global leaderboard rating and the default matchmaking fallback.
- **ELA**: updated by ELA-only duels, and by the ELA-section performance within Mock SAT duels.
- **Math**: updated by Math-Desmos duels, Math-no-Desmos duels, *and* the Math-section performance within Mock SAT duels.
- **Calculator mode is a matchmaking filter, not a rating fork.** "Math-Desmos" and "Math-no-Desmos" both write to the same Math rating. This is the deliberate pool-fragmentation tradeoff: you lose a small amount of granularity (a player's calculator-specific skill isn't tracked separately) in exchange for a Math queue that's actually matchable at low volume.
- **Promotion rule:** once a queue mode sustains, say, >500 weekly-active duelers, it's earned its own split rating track (e.g., separate Desmos vs no-Desmos ratings) because the pool can support it. Write this as an explicit, revisit-later threshold rather than guessing up front.
- **New-category cold start:** when a player's first match in a category happens, seed that category's Glicko-2 state from their *Overall* rating (same rating value, but reset RD to something high like 250, not the full 350) rather than a flat 1500. A student who's clearly strong on Mock SAT duels shouldn't have to grind 15 placement matches from scratch in ELA-only mode to get a sane rating — but you still want a few games' worth of humility (elevated RD) before fully trusting the transferred number.

Each track is its own independent Glicko-2 tuple (rating, RD, σ) in storage — don't compute Overall as a derived average of ELA+Math on read; independent tracks are simpler to reason about and let Overall converge on its own natural schedule.

---

## 3. Matchmaking

### Queue design

- Player hits "Find Match" for one of the 4 modes → enters a per-mode queue keyed by `(userId, rating, RD, queuedAt)`.
- A matchmaking sweep (every 1-2s, or event-driven on queue join) scans the relevant queue sorted by rating and pairs players inside a **search band** around each other.
- **Widening bands over time** (standard expanding-search pattern, same idea as Overwatch/most ranked ladders):
  - 0-10s waiting: ±75 rating points
  - 10-20s: ±150
  - 20-30s: ±250
  - 30s+: match with the closest available opponent regardless of band, or fall through to the tiny-pool fallback below.

### Tiny player pool — an honest evaluation of the options

This is the real design risk for a solo-dev launch: at 20 concurrent users split across 4 queues, live matchmaking will frequently come up empty. Three options, evaluated honestly rather than picking the flashy one:

- **Bots (simulated opponents):** Feasible to build reasonably well — sample answer-correctness and answer-timing from real historical distributions per difficulty tier and replay them as a synthetic opponent's live responses. Pros: infinitely available, can be dialed to an exact target rating on demand. Cons: (a) you need real answer-time/accuracy data to make them feel non-robotic, which you don't have on day one — cold-start-of-the-cold-start problem; (b) presenting a bot as a ranked opponent to a 15-year-old without disclosure is a deceptive-engagement pattern I'd avoid on principle, not just PR risk.
- **Async "ghost matches" (replay of a real player's recorded run):** Store a timestamped answer log (question, chosen answer, elapsed time) for every solo or duel run. When live matchmaking comes up empty, pair the waiting player against a replayed ghost run at a similar rating, clearly labeled as such. Pros: real human variance and mistakes baked in for free, works from literally day one if you seed it with your own beta-tester runs, technically simple (it's just "play back a log against a live player's live answers, no live opponent process needed"). Cons: not reactive (a ghost can't adapt or feel "present"), and a small ghost library reused too often will feel repetitive to your most active users.
- **Bots as ranked fallback:** don't do this — see disclosure concern above, and bot behavioral fidelity is genuinely hard to get right; a bot that plays "wrong" (too perfect, or too dumb) and affects real ranked rating is a support-ticket generator.

**Recommendation — sequence by wait time, and be transparent about which is which:**

1. 0-30s: search for a live opponent with widening bands (above).
2. If no live opponent found by ~30s (or queue is provably empty, e.g. 2am on a school night): offer an **async ghost match** against a stored run at a similar rating, UI-labeled "Async Opponent" — and this **does count toward ranked rating**, using the ghost's rating as it was at recording time, because it's still a genuine test of skill against real human data.
3. **Bots exist only as an explicitly unranked "Practice Mode"** (available anytime, not gated behind queue timeout), never mixed into ranked matchmaking. This also solves onboarding: a brand-new user can play *something* immediately while you explain what ranked duels are.

### Disconnects, AFK, and forfeits — without opening a rating-abuse hole

- **Reconnect grace period:** 20-30s window where a disconnected player can rejoin the same match with the same session token and see remaining time on a server-authoritative clock (the server never pauses for a disconnect — this also prevents a "disconnect to buy thinking time" exploit).
- **No-show before match start** (no heartbeat within ~10s of match creation): void the match entirely, no rating change for either side, and instantly requeue the opponent with matchmaking priority (skip to front of the pairing sweep) so the no-show doesn't cost them their wait time too.
- **Forfeit after match started:** counts as a completely normal loss — same rating math as losing on the scoreboard, no extra penalty and no discount. This is the important anti-abuse detail: **if a forfeit ever cost less rating than a played-out loss, players would learn to rage-quit instead of finishing a losing match**, so the two must be mathematically identical from the rating engine's point of view.
- **Repeat-disconnector detection:** track each account's forfeit-rate (own disconnects / matches started). Above an abnormal threshold (e.g., >30% in a rolling 20-match window) apply an **access restriction** (temporary matchmaking cooldown), not a rating manipulation — the rating math stays honest; what changes is whether you're allowed back in the queue.

---

## 4. Question Bank

### Sourcing strategy given College Board's copyright

College Board's actual digital SAT items are copyrighted, and "SAT" is their trademark. Their free released practice sets (via Bluebook/Khan Academy) are licensed for individual practice use — using their exact items inside a commercial, competitive, presumably-eventually-monetized product is a real legal risk even though free practice tools exist; **don't ingest official CB items verbatim into the bank.** (Verify their current API/content terms directly before making any different call here — terms change.)

**Recommendation — three-part sourcing pipeline, all producing content you actually own:**

1. **Original in-house questions**, written to match the digital SAT's tested skills/format (R&W craft-and-structure, expression of ideas, standard English conventions; Math algebra, advanced math, problem-solving & data analysis, geometry/trig) without copying any CB passage or problem. This is your most valuable long-term asset because you fully own the IP.
2. **Public-domain source passages for R&W** (pre-1929 US literature, historical documents/speeches, public-domain science essays) with original questions written against them. Notably, this mirrors CB's own actual sourcing model for R&W passages, which is a reasonable signal it's a legitimate and durable strategy, not just a workaround.
3. **LLM-drafted, human-reviewed pipeline:** LLM drafts candidate questions from a style guide + your own exemplars (never CB's) → automated checks (is it actually solvable, are distractors non-degenerate, any accidental proper-noun/phrase overlap with known copyrighted text) → human review (you, ideally plus a tutor) for correctness and quality → tagged with an initial difficulty guess → added to the bank → later recalibrated from real answer data (below).

**Branding guardrail:** market everything as "SAT-format" / "SAT-style" practice, never "official SAT questions," and carry a clear non-affiliation disclaimer ("RankedSat is not affiliated with or endorsed by College Board"). This protects you on both the copyright and trademark fronts.

### Difficulty calibration over time — IRT-lite

Full 2PL/3PL IRT (item response theory) needs EM/MCMC estimation — overkill for a solo dev. A pragmatic approximation:

- Track per question: attempts, correct count, average solve time, and the answering player's rating (as an ability proxy) at time of attempt.
- Treat each question like a mini "player" in its own Elo-style pool against real students' rating-derived ability: after each answer, nudge the question's difficulty parameter `b_i` based on whether the outcome matched what the player's rating would predict —
  `b_i_new = b_i_old − K_item × (actual_correct − expected_correct_given_ability)`
  (a question that's "beating" strong players more than expected gets nudged harder; one that weaker players are acing gets nudged easier). This is a genuine, well-understood approximation of 1-parameter (Rasch-style) IRT without needing a full estimation pipeline.
- Seed new questions at an author-assigned initial difficulty (map easy/medium/hard to seed logits, e.g. −1 / 0 / +1) and don't trust the calibrated value over the author's label until a minimum sample size is reached (e.g., 30 attempts).
- If calibrated difficulty drifts far from the author's label (a "medium" question empirically performing as "hard"), **flag it for manual confirmation rather than silently re-tiering it** — avoids a question flapping between tiers as noise fluctuates.

### Duplicate-question avoidance

- **Within a match:** both players must see the identical question set for fairness — pull N questions server-side at match creation based on the match's category+difficulty mix, and lock that set into the match's server-side state for the duration.
- **Across matches for the same player:** maintain a per-user "recently seen question IDs" log; exclude anything seen in, say, the last 60-90 days from that player's candidate pool. Requires a reasonably sized bank to avoid running dry — **target ~150-200 original questions per category before public launch**, growing continuously afterward.
- **Fairness vs. freshness tradeoff:** prefer excluding questions seen recently by *either* player in a duel; if the bank is small and both players are heavy users, the "fresh for both" intersection may shrink to nothing — fall back to "fresh for at least one" or "least-recently-seen overall" rather than blocking the match from starting. A slightly stale repeat is a much smaller problem than a match that won't start.

---

## 5. Real-Time Infrastructure

### The three options and why I'm picking one

| Stack | Verdict |
|---|---|
| **Next.js + Supabase Realtime** | Great for velocity (one platform for auth, Postgres, storage, and pub/sub) but Realtime's core primitive is Postgres changefeeds / broadcast channels, which is the wrong shape for "hold authoritative, ephemeral, per-second-ticking match state in memory." You end up either round-tripping every timer tick through a DB write, or pushing trust of timing/validation logic onto the client (bad — see §7) or into fiddly combinations of Edge Functions + Realtime broadcast that fight the platform's grain. |
| **Firebase (Firestore + Cloud Functions + RTDB)** | Workable, but Firestore's document model + security rules make "never let the client see the answer key before submission" fiddlier than it needs to be, cost is per-read/write and can spike unpredictably under duel-style chatty state updates, and you get real vendor lock-in with weaker SQL/analytics flexibility for leaderboard queries later. |
| **Node/TypeScript + Socket.IO (dedicated match server) + Postgres + Redis** | The duel is fundamentally a small stateful "room": start a synchronized timer, receive answer submissions, validate server-side, broadcast reveal/next-question to both sockets, handle reconnects into the same room. That's exactly the workload Socket.IO rooms (or a purpose-built framework like Colyseus) were designed for — authoritative game state lives in server memory per match, not smeared across DB writes or client trust. Socket.IO also gives you built-in room/reconnection primitives that directly implement the disconnect-handling behavior from §3. |

**Recommendation: Next.js for the web app/marketing/auth/UI, plus a small dedicated Node + Socket.IO match server for live duels, Postgres (hosted via Supabase — you still get its managed Postgres, auth, and storage "for free" even without using Realtime for game logic) for durable state, and Redis (Upstash, serverless pay-per-request) for matchmaking queue state and leaderboard sorted sets.**

Concretely:
- The Socket.IO server owns one "room" per active match, holding the current question, server-side timer, and each player's submitted answers in memory. Nothing about correctness or timing is ever computed client-side.
- On answer submission, the server validates against the DB-stored answer key, updates match state, and broadcasts the result — the client only ever receives question text/choices, never the key, until after both players have answered or time expires.
- Match results (final score, rating deltas) are written to Postgres as the durable record; the ephemeral in-memory room state is discarded once the match ends.
- Deploy target: a small always-on instance (Fly.io or Render) for the Socket.IO server rather than a serverless function, since long-lived WebSocket connections don't fit the serverless request/response model well.

### Where Desmos fits

For the Math-with-Desmos queue, embed **Desmos's own free API — specifically their "Test Mode" calculator**, which they built explicitly for standardized-testing contexts (it disables features like solving/regression that would let a student cheat via the calculator itself, matching real SAT calculator-policy rules). Notably, **College Board's actual Bluebook app itself uses a Desmos-powered calculator**, so embedding the same API gives students an authentic, familiar UX for free, and saves you from ever building/maintaining a calculator. *Verify Desmos's current API terms/rate limits/attribution requirements before shipping* — free-tier terms for embedded API usage are the kind of thing that can shift over time and should be checked directly against their current developer docs rather than assumed from general knowledge.

---

## 6. Leaderboard Design

### Views to support

- **Global (Overall rating)** — the marquee ladder.
- **By category** — ELA, Math.
- **Weekly** — resets on a cadence (e.g., Sunday midnight cron), archives a "Weekly Champion" snapshot before clearing. This matters a lot for retention: most students will never crack the all-time top board, but a weekly reset gives new/casual players something winnable regularly.
- **By school** — self-reported (or later lightly verified) school field at signup. This is a strong, nearly-free viral/community lever for a student product — kids want to beat their own school specifically, and it's a natural sharing hook ("we're #1 at Lincoln High").

### Implementation — don't reach for Redis before you need it

- **Redis sorted sets (ZSET)** are the textbook right structure for a leaderboard (`O(log n)` insert/update, trivial top-N and "players ranked near me" queries) — but be honest that **at 100/1k/even 10k users, a plain indexed Postgres query is completely sufficient**: `SELECT ... ORDER BY rating_overall DESC LIMIT 100` with an index on the rating column is fast and simple at this scale.
- **Recommendation:** ship v1 leaderboards as plain indexed Postgres queries — one less moving part. Introduce Redis ZSETs (`lb:global`, `lb:ela`, `lb:math`, `lb:weekly:<isoweek>`, `lb:school:<id>`) only once Redis is already in the stack anyway for matchmaking queue state (§3) — at that point adding ZSET writes alongside the Postgres rating write in the match-result handler is nearly free, and you get it before it's actually a performance necessity.
- Postgres remains the source of truth for the rating value; Redis is a read-optimized index kept eventually-consistent by updating both in the match-result handler. A message-queue/outbox pattern for stronger consistency is a "revisit if it becomes a real bug source" item, not a v1 requirement.

### The "3-match wonder" problem — solve it with data you already have

Glicko-2 already gives you a built-in confidence signal (RD) — use it instead of inventing a separate heuristic:

- **Minimum games gate:** don't show a player on any public leaderboard until they've played ≥15-20 matches in that category; show "Unranked (X/15 placement matches)" in the meantime. (Standard pattern — League of Legends, Overwatch, etc.)
- **RD gate:** additionally require RD below a threshold (e.g., <100-120) to appear on the board. This is elegant because it's *already computed* and has a nice bonus property for free: since RD rises again during inactivity in Glicko-2, a stale former #1 who hasn't played in 6 months quietly drops off the board on their own, with zero extra logic.
- **Sort by a conservative score, not raw rating:** use `rating − 2×RD` as the leaderboard sort key (a standard Glicko-flavored conservative-estimate trick) rather than raw rating, so an early volatile streak can't overshoot to the top before its RD has actually settled.
- Apply the stricter of the two gates (game count, RD) — a pure RD threshold could theoretically be cleared fast under loose volatility tuning before enough real games have actually happened.

---

## 7. Anti-Cheat (Server-Side)

Priorities in order of actual leverage for a solo dev — this list is deliberately more "boring plumbing discipline" than "machine learning," because that's genuinely where most of the real risk is at this stage.

1. **Never send the correct answer to the client before submission — and verify this at the serialization layer, not just "the client doesn't display it."** The API/socket payload for "here's your next question" must have the answer-key field stripped server-side before it's ever put on the wire, not merely omitted from the UI. This also has to be checked in any prefetch/cache path (a common accidental leak: a "next 5 questions" prefetch object reusing the same DB row shape that happens to include the answer column because it was convenient).
2. **Server clock is the only clock that matters.** Elapsed time from "question served" to "answer submitted" is measured server-side from server timestamps; never trust a client-reported duration for anything that affects scoring or anti-cheat signals.
3. **Answer-time plausibility floors.** Flag correct answers submitted faster than is physically plausible for that question type (e.g., <1.5-2s on a reading question tied to a long passage) — use per-question-type minimum floors, since a quick arithmetic fact and a 100-word R&W passage question have very different plausible floors.
4. **Accuracy-vs-expectation anomaly detection.** Glicko-2 already gives you an expected-score function for any player at any rating — track rolling actual accuracy vs. rating-predicted accuracy. A player significantly outperforming their own rating's expectation *and* doing so at anomalous speed, repeatedly, is a real cheat signal (e.g., pasting questions into another tab/tool). **Flag for manual review, don't auto-ban** — false-positive-banning a genuinely fast, strong 16-year-old is a bad look and a support headache for a small product. Soft first action: quietly place flagged accounts in a separate matchmaking pool with each other while under review; escalate to visible suspension only after confirmation or repeated flags.
5. **Rate limits on match-join, answer-submit, and account-creation**, per-user and per-IP (token-bucket at the edge — Upstash Ratelimit pairs naturally with the Redis you already have from §5/§6). Caps well above legitimate human pace but below what a multi-account queue-sniping or scripted-farming setup would need (e.g., a human cannot submit 10 answers/sec).
6. **Tab-blur/focus-loss as a soft telemetry signal only, never a punitive trigger by itself.** Plenty of legitimate reasons a student's focus shifts mid-match (notification, alt-tab by accident); log it and correlate it with the anomaly score above rather than acting on it alone.

---

## 8. Cost Estimate Ballpark (MVP hosting)

Rough monthly figures assuming registered-user counts below, with generous headroom for peak concurrency (duels are short and bursty, not sustained-connection-heavy like video). **Treat these as directional, not quotes — verify current pricing tiers for Vercel/Supabase/Fly.io/Upstash directly before budgeting**, since all four change pricing periodically.

| Users | Peak concurrent (rough) | Stack | Est. monthly cost |
|---|---|---|---|
| **100** | ~5-10 | Vercel free/hobby, Supabase free tier, Fly.io smallest VM (or even a single shared-CPU instance) for the socket server, Upstash Redis free tier | **~$0-10/mo** (+ ~$12/yr domain) |
| **1,000** | ~50 | Vercel Pro (likely needed for bandwidth/build minutes) ~$20, Supabase Pro (more storage/connections) ~$25, Fly.io small instance(s) ~$10-25, Upstash pay-as-you-go ~$5-15 | **~$50-100/mo** |
| **10,000** | ~200-500 (up to a few hundred simultaneous match rooms) | Vercel Pro/bandwidth ~$20-50, Supabase Pro/Team as storage & compute grow ~$25-100+, Fly.io scaled/autoscaled socket instances ~$50-150, Upstash scaled usage ~$20-50, plus light object storage/CDN for passage assets, error monitoring (Sentry free/small tier) | **~$200-500/mo**, could reach $500-800 if you add transactional email, deeper analytics, or dedicated DB compute |

**Two important caveats:**
- These estimates assume a *well-built* duel-room architecture — in-memory match state with a single durable write at match end, not a DB write on every timer tick. A naive implementation that hammers Postgres per-second-per-active-match could multiply the 10k-user DB cost significantly; this is the single biggest cost-blowup risk in the whole stack.
- LLM costs for question generation (§4) are a content-pipeline cost, not a per-user hosting cost, and are genuinely cheap in raw API terms (tens of dollars per batch) — the real cost there is the solo dev's own review time, not compute.

---

## Open Questions / Risks Worth Revisiting

- Exact legal footing of any content adjacent to CB's released practice items — worth a direct read of current Bluebook/Khan Academy terms before finalizing the sourcing pipeline in §4, not just relying on general priors about "practice tool" licensing.
- Desmos API's current terms for embedding in a for-profit competitive product (vs. a free educational tool) — confirm before launch, not after building around it.
- School-leaderboard verification (§6): self-reported school names will need at least light anti-abuse handling (e.g., fake school spam) once the feature has any real usage — not a launch blocker, but flag it now so it doesn't surprise you later.
- Ghost-match library size: worth deciding an explicit minimum recorded-run count per rating band before advertising ranked ghost matches, so early users don't immediately notice they're replaying the same 3 runs.
