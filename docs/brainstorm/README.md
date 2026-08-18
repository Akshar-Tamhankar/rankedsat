# RankedSat — Brainstorm Docs

Ranked 1v1 SAT duels vs. randoms. Elo + leaderboard, easy/medium/hard tiers, queues: Mock SAT, ELA only, Math only, Math (Desmos), Math (no Desmos).

1. [Features & match mechanics](01-features-and-mechanics.md) — match formats, ranked ladder, retention loops, MVP cut
2. [UI/UX & accessibility](02-ui-ux-accessibility.md) — screen inventory, match-screen design, WCAG 2.2 AA, keyboard play
3. [Systems & architecture](03-systems-architecture.md) — Glicko-2, matchmaking, question bank, stack, anti-cheat, costs
4. [Onboarding, community & growth](04-onboarding-community-growth.md) — first-session flow, teen safety, monetization, launch

## Converged decisions across all four docs

- **Format:** "Standard Duel" — both players get the same question set simultaneously; accuracy-first scoring (correct-but-slow beats fast-but-wrong); difficulty multipliers.
- **Rating:** Glicko-2 under the hood (marketed as "Elo"), separate **Math** and **ELA** ratings + displayed composite; calculator mode is a queue *filter*, not a rating fork. Visible tier ladder ending in a "1600 Club."
- **Opponent presence:** show *progress* (which question they're on), never a live score — plus opt-in Focus mode that hides the opponent. Anti-anxiety is a feature.
- **Cold start:** ghost matches (replays of real runs, labeled, rating-eligible) keep ranked queues alive; bots are unranked practice only.
- **Match UI:** clone the Bluebook question frame (split passage view, answer cross-out, flag, Desmos Test-Mode embed) inside thin competitive chrome. Full keyboard play (1–4/A–D).
- **Content:** never use official College Board items — original SAT-format questions via LLM-draft + human-review pipeline, IRT-lite difficulty calibration from answer data.
- **Stack:** Node + Socket.IO authoritative match server, Postgres (Supabase), Redis (Upstash) when needed. Server holds answer keys and timestamps; client never sees answers pre-submit.
- **Monetization:** cosmetics/supporter only — nothing touching matchmaking, rating, or question access.
- **Safety:** 13+ gate, minimal PII, no freetext chat at launch (emotes/presets), username moderation.
- **MVP (v1):** Standard Duel, 3 queues (Math-Desmos, Math-NoCalc, ELA), dual ratings, ladder + leaderboard, post-match review + Mistake Deck, rematch, ghost duels, friend-challenge links. Defer Full Mock, seasons, tournaments, school-vs-school to v2/v3.

## Open questions

- Extended-time accommodations in ranked: like-with-like matchmaking vs. time-scaled scoring (doc 02 has a proposal; needs a decision).
- Whether Full Mock SAT duels are a queue or a scheduled event (long matches strain queue liquidity).
- Exact season length/reset mechanics (doc 01 proposes 6-week soft resets).
