# Deploying RankedSat

A concise guide for a solo dev on Windows to put RankedSat on the internet for
a friends beta. Primary path is **Railway** (simplest volume + domain story
for a small Node app). A shorter "any Docker host" section follows for
Fly.io, Render, or your own VPS.

RankedSat ships as a single Docker image (`Dockerfile` at the repo root). It
needs exactly one persistent thing: a small volume mounted at `/data` to hold
`players.json` (ratings/records) across deploys. Everything else (question
bank, figure images) is baked into the image at build time.

## Environment variables you'll set

| Variable | Where it's set | Purpose |
|---|---|---|
| `RANKEDSAT_ACCESS_CODE` | you set this | Private-beta gate. Unset = app is open to anyone with the URL. Set = players must enter this code once before they can queue or see the leaderboard. Pick anything (e.g. a short word) and share it with your friends out of band. |
| `PORT` | usually set automatically by the host | Which port the server listens on. Railway/Fly/Render set this for you. |
| `RANKEDSAT_STATE_DIR` | already baked into the image as `/data` | Where `players.json` lives. You don't need to set this yourself — just make sure your volume is mounted at `/data`. |
| `RANKEDSAT_QUESTIONS`, `RANKEDSAT_FIGURES` | already baked into the image | Point at the question bank/figures copied into the image at build time. No action needed. |

You only need to touch `RANKEDSAT_ACCESS_CODE`. Everything else works out of
the box.

---

## Railway (recommended)

Railway builds your `Dockerfile` directly, gives you a free `*.up.railway.app`
URL immediately, and makes attaching a persistent volume and a custom domain
a few clicks.

1. **Install the CLI** (requires Node.js, which you already have):
   ```
   npm install -g @railway/cli
   ```

2. **Log in** — opens a browser window to authenticate:
   ```
   railway login
   ```

3. **Initialize a project** from the repo root (`C:\Users\mvspa\Documents\RankedSat`):
   ```
   railway init
   ```
   Follow the prompt to name the project. This links the current folder to a
   new Railway project.

4. **Deploy**:
   ```
   railway up
   ```
   Railway detects the root `Dockerfile`, builds the image, and deploys it.
   The first build uploads the repo, so this may take a few minutes (the
   `.dockerignore` keeps `node_modules`, `docs/`, `scripts/`, PDFs, and
   `data/players.json` out of the upload — it should stay well under
   100MB even with the figures folder).

5. **Add a volume for `/data`** (so ratings survive redeploys):
   Open the Railway dashboard for this project → select the service →
   **Volumes** tab → **New Volume** → set the mount path to `/data`. (The
   Railway CLI also has a `railway volume` command in newer versions, but
   flags vary by version — the dashboard is the reliable path here.)
   Without this step the app still runs fine; ratings just reset on every
   redeploy.

6. **Set the access code**: dashboard → your service → **Variables** tab →
   add `RANKEDSAT_ACCESS_CODE` with a value of your choosing → this triggers
   a redeploy automatically. (Or via CLI: `railway variables --set
   RANKEDSAT_ACCESS_CODE=yourcode` — again, follow the prompt if the exact
   flag differs in your installed CLI version.)

7. **Get your public URL**: dashboard → service → **Settings** →
   **Networking** → **Generate Domain** gives you a free
   `something.up.railway.app` URL. Share that (plus the access code) with
   your friends and you're live.

### Adding a custom domain (e.g. `play.yourdomain.com`)

1. In the Railway dashboard: service → **Settings** → **Networking** →
   **Custom Domain** → enter the subdomain you want (e.g.
   `play.yourdomain.com`) → Railway shows you a **CNAME target** (something
   like `xyz123.up.railway.app`).
2. Go to your DNS provider (wherever you bought/manage the domain —
   Namecheap, Cloudflare, GoDaddy, etc.) and add a new **CNAME record**:
   - **Host/Name**: the subdomain part only (e.g. `play`)
   - **Value/Target**: the CNAME target Railway gave you
   - **TTL**: leave at the default
3. Save, then wait — DNS changes typically take a few minutes to a couple of
   hours to propagate. Railway will show the domain as verified and issue a
   TLS certificate automatically once it sees the CNAME resolve correctly.

---

## Any Docker host (short version)

These all use the same `Dockerfile` — the only things that differ are how
you attach a volume at `/data` and set env vars.

**Fly.io**
```
flyctl launch          # detects the Dockerfile; follow the prompt for app name/region, don't deploy yet if asked
flyctl volumes create rankedsat_data --size 1   # then mount it at /data in fly.toml under [mounts]
flyctl secrets set RANKEDSAT_ACCESS_CODE=yourcode
flyctl deploy
```

**Render**
- New → Web Service → connect this repo → Render should auto-detect the
  Dockerfile (or pick "Docker" as the environment if asked).
- Add a **Persistent Disk** in the service settings with mount path `/data`.
- Add `RANKEDSAT_ACCESS_CODE` under the **Environment** tab.
- Render gives you a free `*.onrender.com` URL immediately; custom domains
  are under Settings → Custom Domains (same CNAME idea as Railway above).

**Your own VPS (any Linux box with Docker installed)**
```
docker build -t rankedsat .
docker volume create rankedsat_data
docker run -d --name rankedsat -p 3000:80 \
  -e PORT=80 -e RANKEDSAT_ACCESS_CODE=yourcode \
  -v rankedsat_data:/data --restart unless-stopped rankedsat
```
Put a reverse proxy (Caddy or nginx) in front to get TLS and your domain —
Caddy in particular is a one-line `yourdomain.com { reverse_proxy
localhost:3000 }` for automatic HTTPS.

---

## Note: bot matches currently affect ratings

`app/server.js` (`endMatch()`, around the comment `TEST-ONLY: bot matches
count toward rating so solo testing moves the ladder`) currently lets "Ghost
Bot" practice matches move a player's real Elo rating. That was intentional
for solo local testing but is probably not what you want once real friends
are playing — someone could inflate their rating by farming easy bot
matches while waiting for opponents.

To turn this off later: in `endMatch()`, skip the rating update (leave
`profile.ratings[section]` and `profile.games[section]` unchanged, and don't
count the win/loss) whenever the opponent's `kind === 'bot'`, while still
sending the match result/score to the human player as normal. That's a
small, isolated change — do it once you're ready to make ratings
"official" for the beta.
