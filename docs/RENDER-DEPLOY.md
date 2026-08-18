# RankedSat — Render Deployment Guide (beginner-friendly, Windows)

> **Privacy warning:** `firebase/functions/bank.json` (checked into this repo)
> contains the full SAT question bank **including answer keys**. That file is
> only safe to keep in this repo because the repo on GitHub must be **PRIVATE**.
> Do not make this repository public, and do not fork/mirror it to a public
> repo, without first removing `bank.json` from history.

This guide takes the Socket.IO build in `app/` (the one Dockerfile at the repo
root builds) from your computer to a free, live URL on Render, with player
ratings stored in Firestore so they survive redeploys — no credit card
required anywhere in this path.

---

## What you're deploying

- **Render** runs the container (`Dockerfile` at the repo root) as a free web
  service — this is the actual game server.
- **Firestore** (Google's free "Spark" plan, no card needed) stores player
  ratings/records so they don't reset every time Render restarts or
  redeploys the container. This is optional — the game runs without it, but
  ratings reset on every restart if you skip it (see step 4).

---

## 1. Create a free GitHub account and a PRIVATE repo

1. If you don't have one, go to <https://github.com/signup> and create a free
   account.
2. Go to <https://github.com/new> to create a new repository:
   - Repository name: e.g. `rankedsat`
   - Visibility: **Private** (required — see the warning at the top of this
     doc)
   - Do **not** initialize with a README, .gitignore, or license (this repo
     already has its own).
3. Click **Create repository**. GitHub shows you a page with setup commands —
   you don't need to copy those exactly, use the ones below instead.

Now push this local repo to GitHub. Open a terminal (PowerShell or Git Bash)
in the `RankedSat` folder and run:

```
git remote add origin https://github.com/YOUR-USERNAME/rankedsat.git
git branch -M main
git push -u origin main
```

Replace `YOUR-USERNAME/rankedsat` with your actual GitHub username and the
repo name you chose. The first `git push` will open a browser window (or show
a device code) asking you to sign in and authorize Git — this is normal
GitHub browser authentication, just follow the prompts.

---

## 2. Create a free Render account

1. Go to <https://render.com> and click **Get Started**.
2. Choose **Sign up with GitHub**. Authorize Render to access your GitHub
   account (you can limit it to just the `rankedsat` repo in the GitHub
   authorization screen if you prefer).
3. No credit card is required for the free tier used here.

---

## 3. Deploy the Blueprint (render.yaml)

This repo already includes a `render.yaml` at the root describing the service
(Docker runtime, free plan, health check) — Render calls this a **Blueprint**.

1. In the Render dashboard, click **New +** → **Blueprint**.
2. Pick the `rankedsat` repository (Render lists repos it has access to via
   your GitHub authorization from step 2).
3. Render reads `render.yaml` and shows you the one service it defines
   (`rankedsat`, Docker, free plan) plus the environment variables it needs
   values for:
   - **RANKEDSAT_ACCESS_CODE** — type in whatever invite code you want players
     to enter (or leave blank to run the beta open to anyone with the link).
   - **FIREBASE_SERVICE_ACCOUNT** — leave this blank for now; you'll fill it
     in during step 4 (or skip it entirely — see the note there).
4. Click **Apply** / **Create**. Render builds the Docker image and deploys
   it. The first build takes a few minutes (it installs dependencies and
   copies in the question bank + figure images).

---

## 4. Set up Firestore so ratings survive restarts (recommended)

Render's free tier has **no persistent disk** — anything written to the
container's filesystem (including `data/players.json`) is wiped on every
restart or redeploy. To keep player ratings around, point the server at a
free Firestore database instead.

1. Go to <https://console.firebase.google.com> and sign in with a Google
   account.
2. Create a project (or reuse one) — click **Add project**, give it any name.
   You can decline Google Analytics.
3. **Firestore must be on the free "Spark" plan — you do NOT need to upgrade
   to Blaze for this.** In the console, go to **Build → Firestore Database**
   and click **Create database** if you haven't already (any region is fine;
   start in production mode).
4. Get a service account key: click the gear icon (top-left, next to
   "Project Overview") → **Project settings** → **Service accounts** tab →
   **Generate new private key**. Confirm the download — it saves a `.json`
   file to your Downloads folder.
5. Open that downloaded JSON file in Notepad (right-click → Open with →
   Notepad). Select all the text (Ctrl+A) and copy it (Ctrl+C).
6. Back in the Render dashboard, open your `rankedsat` service → **Environment**
   tab → find `FIREBASE_SERVICE_ACCOUNT` → paste the entire JSON you copied as
   its value → **Save Changes**. Render will redeploy automatically.

That's it — no Blaze plan, no credit card. The server detects
`FIREBASE_SERVICE_ACCOUNT` automatically and switches to Firestore for player
storage; everything else about the game is unchanged.

**If you skip this step:** the game still works completely normally — people
can queue, play duels, and see ratings during their session — but ratings
reset to defaults every time Render restarts the container (which happens on
every redeploy, and can happen automatically on the free plan). Firestore is
what makes ratings permanent.

---

## 5. Find your URL and test it

1. In the Render dashboard, open the `rankedsat` service. Near the top you'll
   see a URL like `https://rankedsat-xxxx.onrender.com` — that's your live
   game.
2. Open it in two browser windows (or send the link to a friend), give each a
   different display name, queue into the same mode, and play a duel.
3. Check `https://rankedsat-xxxx.onrender.com/healthz` returns `{"ok":true,...}`
   — that's the health check Render itself uses to know the service is alive.

---

## 6. Optional: custom subdomain

1. In the Render dashboard, open your service → **Settings** → **Custom
   Domains** → **Add Custom Domain**.
2. Type the subdomain you want (e.g. `play.yourdomain.com`) and click **Save**.
3. Render shows you a **CNAME record** to add (a target hostname pointing at
   Render's infrastructure).
4. Go to your domain registrar's DNS panel (Namecheap/Cloudflare/GoDaddy/etc.)
   and add that CNAME record for the subdomain exactly as Render shows it.
5. Back in Render, wait for the domain status to move from "Verifying" to
   "Verified" (DNS can take minutes to a few hours to propagate). Render then
   provisions an SSL certificate automatically — nothing else to do.
   `https://play.yourdomain.com` will serve the same site over HTTPS.

---

## 7. What to expect on the free tier

- **Free web services sleep after ~15 minutes of no traffic.** The next
  visitor triggers a cold start that takes roughly 30–60 seconds before the
  page loads — totally normal, just a one-time wait per sleep cycle.
- **Firestore free (Spark) allowances** are generous for a small private beta
  (tens of thousands of reads/writes per day) — a duel writes a couple of
  documents, so you'd need a lot of concurrent play to come close.
- If the sleep/wake delay becomes annoying (e.g. once real players show up),
  Render's **Starter plan is $7/month** and removes the idle-sleep behavior —
  everything else (the Blueprint, the code, Firestore) stays exactly the
  same, you just change the plan on the service.

---

## Updating the question bank or code later

Any push to the branch Render is watching (`main`, by default) triggers an
automatic redeploy:

```
git add -A
git commit -m "your change"
git push
```

Render rebuilds the Docker image and rolls it out — no dashboard clicks
needed for routine updates.
