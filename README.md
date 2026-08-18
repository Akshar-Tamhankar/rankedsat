# RankedSat

A local SAT practice app: solo study with explanations, timed Bluebook-shaped
modules, full mock exams with adaptive routing, and 1v1 ranked duels.

Runs as a desktop app on **Windows** and **macOS**, or as a web server you can
host yourself.

---

## Download

### → **[Get the latest release](../../releases/latest)** ←

Everything is on that one page. Pick the file for your machine:

| Platform | File | Notes |
| --- | --- | --- |
| **Windows** | `RankedSat-Setup-<version>-x64.exe` | Installer. Creates a Start-menu and desktop shortcut. **Start here.** |
| **Windows (portable)** | `RankedSat-Portable-<version>-x64.exe` | Single file, no install. Runs from a USB stick. |
| **macOS (Apple Silicon)** | `RankedSat-<version>-arm64.dmg` | M1/M2/M3/M4. Most Macs since 2020. |
| **macOS (Intel)** | `RankedSat-<version>-x64.dmg` | Pre-2020 Intel Macs. |

Not sure which Mac you have? Apple menu → **About This Mac**. "Apple M-something"
means arm64; "Intel" means x64.

Nothing else to install — Node, the question bank, and all 8,700+ figures are
bundled inside the app.

### First launch on macOS

The app is **not code-signed** (that needs a paid Apple Developer account), so
Gatekeeper will refuse it on first open. This is expected:

1. Open the `.dmg` and drag **RankedSat** to Applications.
2. **Right-click** the app → **Open** → **Open** in the dialog.

Only needed once. Double-clicking works from then on.

### First launch on Windows

SmartScreen may warn about an unrecognised publisher, for the same reason
(no code-signing certificate). Choose **More info → Run anyway**.

---

## What's inside

- **Practice** — endless, untimed, filterable by section, difficulty, question
  type, and content age. Shows the correct answer and the full official
  explanation after each question, or hides them if you'd rather self-check.
- **Hell** — the 100 hardest questions in the bank, 50 per section, ranked by
  grid-in status, explanation length and figure complexity. This ranking is
  the app's own; College Board publishes only easy/medium/hard.
- **Timed modules** — Bluebook-shaped: 27 Reading & Writing in 32:00, or 22
  Math in 35:00. Answers withheld until the module ends, then a full review.
- **Mock exam** — all four modules back to back. Module 2's difficulty follows
  your Module 1 score, as the real adaptive test does.
- **Duels** — 1v1 ranked matches with gap-scaled stakes. A practice bot joins
  if nobody else is queued within 10 seconds.
- **Session history** — every finished session is kept, with per-domain and
  per-skill breakdowns, timing percentiles and your weakest skill. Viewable
  and clearable from the hall.
- **Desmos** — the graphing calculator, configured to match the one in
  Bluebook. Needs an internet connection; everything else works offline.

Your ratings, stats and session history live in your OS user-data folder, so
they survive updates and reinstalls. **File → Open Data Folder** shows you where.

---

## Running from source

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone <this repo>
cd RankedSat/app
npm install
npm run build      # build the client
npm start          # serve at http://localhost:3000
```

Or run it as the desktop app:

```bash
npm run desktop
```

### Building installers

```bash
npm run dist:win   # Windows .exe (installer + portable)
npm run dist:mac   # macOS .dmg (arm64 + x64)
```

**macOS builds must be produced on a Mac.** electron-builder cannot create or
sign `.dmg` files from Windows or Linux. The bundled GitHub Actions workflow
(`.github/workflows/release.yml`) builds both platforms automatically when you
push a version tag.

---

## Refreshing the question bank

The bank is parsed from **SAT Suite Question Bank** PDF exports. When College
Board publishes new questions, export them and merge:

```bash
pip install -r scripts/requirements.txt

# see what an export contains without writing anything
python scripts/parse_questionbank.py "path/to/questionbank-export-NEW.pdf" --merge --dry-run

# commit it
python scripts/parse_questionbank.py "path/to/questionbank-export-NEW.pdf" --merge
```

`--merge` keys on Question ID, so re-running with an export you've already
ingested is a no-op and overlapping exports are safe. **Without `--merge` the
bank is replaced** by whatever the given PDFs contain.

Restart the app afterwards — the bank is read at startup.

### A note on how maths is displayed

College Board's PDF draws mathematical notation as vector artwork in
unembedded Type3 fonts, which carry no character data. The prose extracts
cleanly; the notation extracts as nothing at all:

```
"For a linear relationship between \n and \n, the table gives ..."
```

Those characters were never stored in the file, so no parser can recover them.
Maths stems, answer choices and explanations are therefore rendered as tightly
cropped images. `scripts/mathcrop.py` handles this, and clamps every crop to
stay above the "Correct Answer:" line so a render can never leak the key.

---

## Self-hosting

A `Dockerfile` and `render.yaml` are included.

```bash
docker build -t rankedsat .
docker run -p 3000:3000 -v rankedsat-state:/data rankedsat
```

Two things to set in production:

- **Persistence.** Mount a volume at `/data`, or set `FIREBASE_SERVICE_ACCOUNT`
  to use Firestore. Without either, ratings reset on every restart — the
  server warns loudly at boot if this applies.
- **Access.** Set `RANKEDSAT_ACCESS_CODE` to put the whole site behind a code.
  It gates socket play, the APIs and `/figures` (the question images).

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (default 3000; the desktop app uses a free one). |
| `RANKEDSAT_ACCESS_CODE` | Require an access code. Unset = open. |
| `RANKEDSAT_STATE_DIR` | Where `players.json` and `sessions.json` live. |
| `RANKEDSAT_QUESTIONS` | Path to `questions.jsonl`. |
| `RANKEDSAT_FIGURES` | Path to the figures directory. |
| `FIREBASE_SERVICE_ACCOUNT` | Service-account JSON; switches storage to Firestore. |

---

## Found this useful?

A ⭐ on the repo helps other people find it, and following along means you'll
see new releases as they land. Both are genuinely appreciated.

Bug reports and ideas are welcome in [Issues](../../issues) — particularly
questions that render badly, since maths comes out of the source PDF as
artwork and the odd one still slips through.

---

## Licensing

The code here is yours to do as you like with. **The question bank is not.**
SAT questions, answer keys and explanations are College Board's copyrighted
material, obtained through their Question Bank export tool. This repository is
a personal study tool. If you make it public, set an access code, and don't
redistribute the bank.

SAT® is a trademark registered by the College Board, which is not affiliated
with and does not endorse this project.
