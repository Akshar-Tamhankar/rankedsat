# RankedSat — Firebase Deployment Guide (beginner-friendly)

This guide takes the `firebase/` folder of this repo from zero to a live,
invite-gated site. No prior Firebase experience assumed.

The deployable app lives entirely under `firebase/`:

```
firebase/
  firebase.json            hosting + functions + firestore config
  .firebaserc              which Firebase project to deploy to (you set this)
  firestore.rules          security rules (clients can never touch ratings/matches)
  firestore.indexes.json   one composite index for the matchmaking queue
  functions/               Cloud Functions match engine (Node 20)
    bank.json              PRIVATE question bank incl. answers — generated, never hosted
    .env                   (you create) invite code lives here
  hosting/public/          the website (client + figures)
  scripts/build-data.js    regenerates bank.json + copies figures
  test-logic.js            rules/grading/secrecy tests (plain Node)
  test-duel-emu.js         full 2-player end-to-end test (needs emulators + Java)
```

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Create a project** (any name, e.g. `rankedsat`). You can decline
   Google Analytics — it isn't used.
3. Note the **Project ID** it assigns (e.g. `rankedsat-4c21f`). You'll need it below.

## 2. Enable Anonymous sign-in

1. In the Firebase console: **Build → Authentication → Get started**.
2. Open the **Sign-in method** tab.
3. Enable **Anonymous**. (That's the only provider the app uses right now; the
   client code is structured so Google sign-in can be added later.)

## 3. Upgrade to the Blaze plan (required for Cloud Functions)

Cloud Functions do not run on the free Spark plan — you must click
**Upgrade → Blaze (pay as you go)** in the console (bottom-left gear or the
banner that appears when you first deploy functions). **Blaze requires a credit
card, but it is not a subscription**: you pay only for usage beyond the free
allowances, and at small scale (a private beta with dozens of players) the
free allowances cover everything — expect a bill of **$0/month, or pennies**.
You can set a **budget alert** in Google Cloud Billing (e.g. $5) during the
upgrade flow so you'd be emailed long before anything real accrues.

Rough free allowances that matter here (as of mid-2026 — check
<https://firebase.google.com/pricing> for current numbers):

| Service | Free per month (Blaze) | What RankedSat uses it for |
|---|---|---|
| Cloud Functions | 2M invocations, 400k GB-seconds | ~12–15 calls per duel |
| Firestore | 50k reads / 20k writes / 20k deletes **per day**, 1 GiB stored | match docs, profiles, queue |
| Hosting | 10 GB stored, 360 MB/day downloaded | client + ~71 MB of figure PNGs |
| Authentication | anonymous sign-in free | player identity |

A duel costs on the order of 15 function calls and a few dozen Firestore
reads/writes — thousands of duels a month fit comfortably inside free tier.
The likeliest thing to ever cost money is Hosting bandwidth for figure PNGs if
traffic grows (beyond 360 MB/day, ~$0.15/GB).

## 4. One-time local setup

You need Node.js 20+ installed. In a terminal:

```
cd firebase
npm install                 # installs firebase-tools locally (and the test SDK)
npm run build-data          # regenerates functions/bank.json + copies figures
npx firebase login          # opens a browser; sign in with the same Google account
npx firebase use YOUR-PROJECT-ID    # writes your project id into .firebaserc
```

(`YOUR-PROJECT-ID` is the Project ID from step 1, not the display name.)

## 5. Set the invite code (optional but recommended)

Create the file `firebase/functions/.env` containing:

```
RANKEDSAT_ACCESS_CODE=choose-a-code-here
```

If set, players must enter this code once before they can queue. Leave the file
absent (or the value empty) to run open. Changing the code requires a
functions redeploy (step 6). Note: `functions/.env.local` is emulator-only
test config and is never deployed.

## 6. Deploy

```
cd firebase
npm run build-data          # idempotent; safe to run every time
npx firebase deploy
```

First deploy takes a few minutes (it uploads the functions bundle including the
question bank, the security rules, the index, and ~71 MB of hosting assets).
When it finishes it prints your live URL:

```
https://YOUR-PROJECT-ID.web.app
```

Open it in two browser windows (or two devices), give each a different display
name, queue both into the same mode, and you have a duel.

To deploy only one piece later: `npx firebase deploy --only hosting`,
`--only functions`, or `--only firestore`.

## 7. Custom subdomain (e.g. play.yourdomain.com)

1. Firebase console → **Build → Hosting → Add custom domain**.
2. Type the subdomain (e.g. `play.yourdomain.com`).
3. Firebase shows you the exact DNS records to add at your domain registrar
   (Namecheap/Cloudflare/GoDaddy/etc.). Typically:
   - a **TXT record** on the (sub)domain to prove you own it, then
   - an **A record** pointing the subdomain at the Firebase Hosting IPs it
     lists (currently `199.36.158.100`), or a CNAME if the console offers one.
4. Add those records in your registrar's DNS panel, then click **Verify** in
   the console. DNS can take minutes to a few hours to propagate.
5. Firebase provisions the SSL certificate automatically — the status in the
   Hosting page moves from "Needs setup" → "Pending" → "Connected". Nothing
   else to do; `https://play.yourdomain.com` then serves the same site.

## 8. Running locally with the Emulator Suite

The full local stack (auth + functions + Firestore + hosting) needs a **Java
runtime** for the Firestore emulator. Any recent JRE/JDK works — e.g. Temurin
21 from <https://adoptium.net> (install it so `java -version` works in a
terminal).

```
cd firebase
npm run emulators           # starts everything on localhost
```

Then open <http://localhost:5000> in two browser windows and play. The client
auto-detects localhost and talks to the emulators — no real project, no cost,
data resets on restart. The checked-in emulator config
(`functions/.env.local`) sets the invite code to `test-code-123`.

Automated tests:

```
npm run test:logic          # rules/grading/secrecy suite — no emulator needed
npm run test:emu            # full 2-player end-to-end duel suite (needs Java)
```

Without Java you can still preview the static site alone:
`npx firebase emulators:start --only hosting --project demo-rankedsat`
(pages load, but queueing/matches need the full suite).

## 9. Updating the question bank

Edit/replace `data/questions.jsonl` (repo root), then:

```
cd firebase
npm run build-data
npx firebase deploy --only functions,hosting
```

`bank.json` (with answers) ships only inside the functions bundle; hosting
gets only the figure images. Keep it that way — never copy `bank.json` into
`hosting/public/`.
