# RankedSat — Game Rules (authoritative)

This document is the authoritative spec for how a RankedSat duel works.
The code implementing it lives in `app/rules.js` (banding, clock, stakes,
winner decision, SPR grading) and `app/server.js` (match engine). Keep them in sync.

## Queues

Three queues, no difficulty picker:

- **ELA** (Reading & Writing)
- **Math (Desmos)** — Desmos graphing calculator available in-match
- **Math (No Desmos)**

Both math queues share one **Math** rating; ELA has its own. Everyone starts at **1000**.
If no human opponent is found within 10 seconds, **Ghost Bot** (a clearly labeled
practice bot, ~60% accuracy, human-paced answers within the clock) steps in.
Bot matches are rated in this test build only.

## Question difficulty (derived from ratings)

Each duel is 5 questions, the **same set for both players**. Difficulty comes from
the **average of both players' section ratings** at match start:

| Average rating | Question mix |
|---|---|
| below 1200 | 5 easy |
| 1200 – 1499 | easy + medium mix (each slot ~50/50 at random) |
| 1500 and above | 1 easy + 1 medium + 3 hard |

Question order is shuffled.

## The match clock

One **match-wide countdown clock** per player — there are no per-question time limits:

- **5:00** when the average rating is below 1500
- **7:00** when it is 1500 or above

The clock is server-authoritative and starts when the first question is served.
When **your** clock hits zero, all of your unanswered questions are counted **wrong**
and your run is over; your opponent keeps playing until their own clock or questions
run out.

## Playing

- Questions are served **one at a time**. Submitting an answer — right or wrong —
  is the **only** way to advance. Wrong answers are counted wrong; there are no retries.
- After you lock an answer you are told only whether *you* were right — never the
  correct answer, and never your opponent's correctness.
- You see your opponent's **progress** (which question they're on), never their score.

## Winner

1. **Most correct answers** wins.
2. Tie on corrects → **lower completion time** wins. Completion time is the elapsed
   time from match start to your final answer; a player who timed out is charged the
   **full clock** as their time.
3. Equal corrects **and** equal completion times → **draw**.

## Rating

Symmetric, gap-scaled stakes. At match start the stake is fixed:

```
X = clamp(round(30 − |ratingA − ratingB| / 20), 2, 30)
```

- Winner **+X**, loser **−X**. A draw changes nothing (±0).
- An even match is worth ±30; a 560+ point mismatch bottoms out at ±2.
- **Forfeit or disconnect** (15s grace) = loss at the same stake ±X.
- Ratings are per section (ELA / Math) and have no floor or ceiling.

## After the match

The post-match screen shows: correct answers (e.g. **4–3**), each player's completion
time (or "timed out"), the rating change **±X**, and the full per-question review —
both players' answers, the correct answer, and the rationale, revealed only now.
Rematch re-runs matchmaking math (band, clock, stake) against current ratings with a
fresh question set.
