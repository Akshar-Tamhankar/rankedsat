# RankedSat

A desktop SAT practice app for Windows and macOS.

Solo study with full explanations, timed modules shaped like the real digital
SAT, complete mock exams with adaptive routing, and 1v1 ranked duels against
other people or a practice bot.

Everything runs locally. No account, no telemetry, no subscription.

---

## Download

### [Get the latest release](../../releases/latest)

| Platform | File | Notes |
| --- | --- | --- |
| **Windows** | `RankedSat-Setup-<version>-x64.exe` | Installer with a desktop shortcut. Start here. |
| **Windows (portable)** | `RankedSat-Portable-<version>-x64.exe` | Single file, no install. Runs from a USB stick. |
| **macOS (Apple Silicon)** | `RankedSat-<version>-arm64.dmg` | M1 through M4. Most Macs since 2020. |
| **macOS (Intel)** | `RankedSat-<version>-x64.dmg` | Pre-2020 Intel Macs. |

Not sure which Mac you have? Apple menu, then **About This Mac**. "Apple M"
something means arm64. "Intel" means x64.

Nothing else to install. Node, the question bank, and every figure are bundled
inside the app.

### First launch

The builds are **not code-signed**, because signing certificates cost money
and this is a free project. Your OS will complain once:

* **macOS:** right-click the app, choose **Open**, then **Open** again in the
  dialog. Only needed the first time.
* **Windows:** SmartScreen may say "unrecognised publisher". Choose
  **More info**, then **Run anyway**.

---

## What it does

**Practice.** Endless and untimed. Filter by section, difficulty, question type
(multiple choice or grid-in), and content age. After each question you get the
correct answer and College Board's own explanation, or you can hide both and
self-check instead.

**Hell mode.** The 100 hardest questions in the bank, 50 from each section.
College Board only publishes three difficulty tiers, so the ranking inside
"hard" is this app's own: grid-ins score highest (no choices to eliminate),
then questions with long multi-step explanations, then ones with figures to
interpret.

**Timed modules.** Shaped like Bluebook: 27 Reading and Writing questions in
32:00, or 22 Math questions in 35:00. Answers stay hidden until the module
ends, then you get a full per-question review.

**Mock exams.** All four modules back to back. Module 2's difficulty follows
your Module 1 score, the same way the real adaptive test routes you.

**Duels.** Ranked 1v1 matches with gap-scaled stakes, so beating someone far
above you is worth more than beating a peer. If nobody queues within 10
seconds, a clearly labelled practice bot steps in.

**Session analytics.** Every finished session is saved with accuracy, streaks,
timing percentiles (mean, median, fastest, slowest), and breakdowns by domain
and skill sorted weakest first. It also compares how long you take on the ones
you get right versus wrong, which tells you whether misses are rushed or
genuinely unknown.

**Desmos.** The graphing calculator, configured to match the one in Bluebook.
It needs an internet connection. Everything else works offline.

Ratings, stats, and history live in your OS user data folder, so they survive
updates and reinstalls. **File, then Open Data Folder** shows you where.

---

## Running from source

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/Akshar-Tamhankar/rankedsat.git
cd rankedsat/app
npm install
npm run build
npm start          # http://localhost:3000
```

Or as the desktop app:

```bash
npm run desktop
```

### Building installers

```bash
npm run dist:win   # Windows installer and portable
npm run dist:mac   # macOS .dmg for arm64 and x64
```

**macOS builds have to be made on a Mac.** electron-builder cannot create or
sign a `.dmg` from Windows or Linux. The included GitHub Actions workflow
(`.github/workflows/release.yml`) builds both platforms on every version tag,
which is how the releases here are produced.

---

## The question bank

Questions are parsed from **SAT Suite Question Bank** PDF exports. To add newly
released questions:

```bash
pip install -r scripts/requirements.txt

# preview what an export contains, writing nothing
python scripts/parse_questionbank.py "questionbank-export-NEW.pdf" --merge --dry-run

# commit it
python scripts/parse_questionbank.py "questionbank-export-NEW.pdf" --merge
```

`--merge` keys on Question ID, so re-running with an export you already
ingested does nothing and overlapping exports are safe. **Without `--merge`,
the bank is replaced** by whatever the given PDFs contain. Restart the app
afterwards, since the bank is read at startup.

### Why the maths is images

College Board's PDF draws mathematical notation as vector artwork using
unembedded Type3 fonts, which carry no character data. Prose extracts cleanly.
Notation extracts as nothing at all:

```
"For a linear relationship between \n and \n, the table gives ..."
"Answer\nA. \nB. \nC. \nD. \nCorrect Answer: D"
```

Those characters were never written to the file, so no parser can recover them.
Three different detection strategies were tried and all had blind spots that
shipped unsolvable questions. Maths stems, answer choices, and explanations are
therefore rendered as tightly cropped images, sized to their actual ink.

`scripts/mathcrop.py` does this. It clamps every crop to stay above the
"Correct Answer:" line, because an early version leaked a choice image reading
"ct Answer: D" into the question view.

---

## Self-hosting

A `Dockerfile` and `render.yaml` are included.

```bash
docker build -t rankedsat .
docker run -p 3000:3000 -v rankedsat-state:/data rankedsat
```

Two things matter in production:

**Persistence.** Mount a volume at `/data`, or set `FIREBASE_SERVICE_ACCOUNT`
to use Firestore. With neither, ratings reset on every restart. The server
warns loudly at boot if this applies to you.

**Access.** Set `RANKEDSAT_ACCESS_CODE` to put the site behind a code. It gates
socket play, the APIs, and `/figures` (the question images).

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port. Default 3000; the desktop app picks a free one. |
| `RANKEDSAT_ACCESS_CODE` | Require an access code. Unset means open. |
| `RANKEDSAT_STATE_DIR` | Where `players.json` and `sessions.json` live. |
| `RANKEDSAT_QUESTIONS` | Path to `questions.jsonl`. |
| `RANKEDSAT_FIGURES` | Path to the figures directory. |
| `FIREBASE_SERVICE_ACCOUNT` | Service-account JSON. Switches storage to Firestore. |

---

## Built with

Express and Socket.IO on the server, React and Vite on the client, Electron for
the desktop shell, PyMuPDF and Pillow for the question bank pipeline.

The server is authoritative for everything that matters: it holds all answer
keys, grades every response, and timestamps the clock. Nothing answerable is
ever sent to the browser before you commit an answer, which is enforced by
tests.

---

## Found this useful?

A star helps other people find it, and watching the repo means you will see new
releases as they land. Both are appreciated.

Bug reports and ideas are welcome in [Issues](../../issues). Questions that
render badly are especially useful to hear about, since maths comes out of the
source PDF as artwork and the occasional one still slips through.

---

## Licensing

The application code is free to use, modify, and share.

**The SAT questions are not.** Questions, answer keys, and explanations are
College Board's copyrighted material, obtained through their public Question
Bank export tool. They are included here so the app works out of the box. If
you fork this, do not redistribute the bank as your own, and consider pointing
the parser at your own export instead.

SAT is a trademark registered by the College Board, which is not affiliated
with this project, does not endorse it, and had no involvement in it.
