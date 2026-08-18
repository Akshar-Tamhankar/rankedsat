"""Parse College Board SAT Suite Question Bank PDF exports into JSONL.

Usage:
  # add a newly released export to the existing bank (the normal case)
  python scripts/parse_questionbank.py "~/Downloads/questionbank-export-NEW.pdf" --merge

  # see what an export contains without touching anything on disk
  python scripts/parse_questionbank.py NEW.pdf --merge --dry-run

  # rebuild the bank from scratch: pass EVERY export, old ones included
  python scripts/parse_questionbank.py OLD1.pdf OLD2.pdf NEW.pdf

Requires: PyMuPDF, Pillow  (pip install -r scripts/requirements.txt)

--merge keys on Question ID, so re-running with an export you have already
ingested is a no-op and overlapping exports are safe. Without --merge the bank
is REPLACED by whatever the given PDFs contain.

Outputs:
  data/questions.jsonl        - one JSON object per question
  data/summary.json           - counts and diagnostics
  data/pagemap.json           - question id -> {pdf, page} (for spot checks)
  data/figures/<id>.png       - genuine figure renders (graphs/tables)
  data/figures/qstem_<id>.png - full question-region renders for ALL math
                                questions (stem + choices, 2x zoom), because
                                math notation is vector art invisible to the
                                text layer. Referenced as "stemImagePath".

Layout of the export (verified visually):
  Each question starts on a fresh page with "Question ID: <8-hex>".
  Header table: Assessment | Test | Domain | Skill | Difficulty
  Then: "Question" label, stem (optionally figure), optional "Answer" block
  with choices A-D, "Correct Answer: X", "Rationale", rationale text.
  Questions may span multiple pages.

Text-layer quirks handled here:
  - fitz.TEXT_INHIBIT_SPACES avoids bogus mid-word spaces ("repor ted").
  - Math notation renders as vector art -> gaps in text. Affected questions
    keep "suspect": true unless a stem image was rendered and a correct
    answer is known.
  - On some pages the whole "Correct Answer: <value>" line is vector art.
    The value is then recovered from the rationale ("The correct answer
    is 2.6", "Choice B is correct", "Note that 2.6 and 13/5 are examples
    of ways to enter a correct answer").
  - All rendered images end ABOVE the correct-answer line (its y-position
    is derived from text labels; when the line is invisible, the cut is at
    the bottom of the last stem line), so no render leaks the answer.
"""
import fitz
import json
import re
import os
import sys
import argparse
import collections
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mathcrop  # noqa: E402  (tight per-region math renders)

# Paths are derived from this file's location, not hardcoded to one machine.
# (They previously pointed at C:\Users\mvspa\..., so the script could not run
# anywhere else — including this checkout.)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, "data")
FIG_DIR = os.path.join(OUT_DIR, "figures")
FLAGS = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_INHIBIT_SPACES
ZOOM = 2.0          # 144 dpi
X_MARGIN = 18.0
Y_MARGIN = 30.0

MATH_DOMAINS = [
    "Algebra",
    "Advanced Math",
    "Problem-Solving and Data Analysis",
    "Geometry and Trigonometry",
]
ELA_DOMAINS = [
    "Information and Ideas",
    "Craft and Structure",
    "Expression of Ideas",
    "Standard English Conventions",
]

QUESTION_STARTS = [
    "Which choice", "Which quotation", "Which finding", "Which statement",
    "Which detail", "Which of the following", "Which response", "Which claim",
    "Which piece of evidence", "Which text", "Which selection",
    "Based on the text", "Based on the texts", "Based on Text 1",
    "According to the text", "According to Text 1", "As used in the text",
    "As presented in the text", "As used in Text",
    "What is the main", "What is the primary", "What does the text",
    "What function does", "What choice", "What can be concluded",
    "How does the second", "How does Text 2", "How does the underlined",
    "It can most reasonably be inferred",
]

QID_RE = re.compile(r"^Question ID:\s*([0-9a-f]{8})\s*$")
CHOICE_RE = re.compile(r"^([A-D])\.\s?(.*)$")
CORRECT_RE = re.compile(r"^Correct Answer:\s*(.+?)\s*$")
NUM_RE = re.compile(r"correct answer is\s*(-?\.?\d[\d,./]*)")
NOTE_RE = re.compile(r"Note that\s+(.{1,120}?)\s+(?:are|is)\s+(?:examples? of )?ways? to enter (?:a|the) correct answer")
CHOICE_CORRECT_RE = re.compile(r"Choice\s+([A-D])\s+is\s+(?:the\s+best\s+answer|correct)")


def norm(s):
    s = s.replace("\xa0", " ")
    s = re.sub(r" {2,}", " ", s)
    return s.strip()


def get_lines_dict(page):
    """[(y0, y1, text)] for visible text lines, sorted by y."""
    out = []
    d = page.get_text("dict", flags=FLAGS)
    for block in d["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            text = "".join(sp["text"] for sp in line["spans"]).strip()
            if text:
                out.append((line["bbox"][1], line["bbox"][3], text))
    out.sort()
    return out


def find_label_y(page, label):
    for y0, y1, text in get_lines_dict(page):
        if text == label or (label.endswith(":") and text.startswith(label)):
            return y0, y1
    return None


def cluster_drawings(rects, tol=25.0):
    clusters = []
    for r in rects:
        merged = None
        for c in clusters:
            infl = fitz.Rect(c[0].x0 - tol, c[0].y0 - tol, c[0].x1 + tol, c[0].y1 + tol)
            if infl.intersects(r):
                c[0] |= r
                c[1] += 1
                merged = c
                break
        if merged is None:
            clusters.append([fitz.Rect(r), 1])
    changed = True
    while changed:
        changed = False
        out = []
        for c in clusters:
            hit = None
            for o in out:
                infl = fitz.Rect(o[0].x0 - tol, o[0].y0 - tol, o[0].x1 + tol, o[0].y1 + tol)
                if infl.intersects(c[0]):
                    o[0] |= c[0]
                    o[1] += c[1]
                    hit = o
                    changed = True
                    break
            if hit is None:
                out.append(c)
        clusters = out
    return clusters


def compute_region(doc, page_start, page_end):
    """Safe question region: from below the 'Question' label down to just
    above the correct answer, as a list of (page_idx, y_top, y_bot).
    Never includes the correct-answer line, even when it is vector art."""
    first = doc[page_start]
    qy = find_label_y(first, "Question")
    top0 = (qy[1] + 2) if qy else 90.0

    end_page, end_y = None, None
    for p in range(page_start, page_end):
        cy = find_label_y(doc[p], "Correct Answer:")
        if cy:
            end_page, end_y = p, cy[0] - 4
            break
    if end_page is None:
        # correct-answer line is invisible vector art; cut at the bottom of
        # the last visible text line above the Rationale label
        for p in range(page_start, page_end):
            ry = find_label_y(doc[p], "Rationale")
            if ry:
                above = [l for l in get_lines_dict(doc[p]) if l[1] <= ry[0] - 1]
                if p == page_start:
                    above = [l for l in above if l[0] > top0 - 2]
                if above:
                    end_page, end_y = p, above[-1][1] + 5
                elif p > page_start:  # rationale starts the page
                    end_page, end_y = p - 1, doc[p - 1].rect.height - Y_MARGIN
                else:
                    end_page, end_y = p, ry[0] - 30
                break
    if end_page is None:
        end_page, end_y = page_start, first.rect.height - Y_MARGIN

    region = []
    for p in range(page_start, end_page + 1):
        h = doc[p].rect.height
        y_top = top0 if p == page_start else Y_MARGIN
        y_bot = end_y if p == end_page else h - Y_MARGIN
        if y_bot - y_top > 15:
            region.append((p, y_top, y_bot))
    return region


def render_region(doc, region, out_path):
    """Render region clips at 2x zoom, stack vertically, save PNG."""
    if not region:
        return False
    mat = fitz.Matrix(ZOOM, ZOOM)
    images = []
    for p, y_top, y_bot in region:
        page = doc[p]
        clip = fitz.Rect(X_MARGIN, y_top, page.rect.width - X_MARGIN, y_bot)
        pix = page.get_pixmap(matrix=mat, clip=clip)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        images.append(img)
    if len(images) == 1:
        images[0].save(out_path)
        return True
    width = max(im.width for im in images)
    height = sum(im.height for im in images)
    canvas = Image.new("RGB", (width, height), "white")
    y = 0
    for im in images:
        canvas.paste(im, (0, y))
        y += im.height
    canvas.save(out_path)
    return True


def parse_question(doc, page_start, page_end, drawings_cache):
    pages = list(range(page_start, page_end))
    lines = []
    for p in pages:
        for raw in doc[p].get_text(flags=FLAGS).split("\n"):
            lines.append((p, raw))
    stripped = [norm(raw) for _, raw in lines]

    m = QID_RE.match(stripped[0])
    qid = m.group(1) if m else None

    # ---- header ----
    try:
        sat_idx = stripped.index("SAT")
    except ValueError:
        return None, ["no SAT header line"]
    test = stripped[sat_idx + 1]
    section = "math" if test == "Math" else "ela"
    domains = MATH_DOMAINS if section == "math" else ELA_DOMAINS

    diff_idx = None
    for i in range(sat_idx + 2, min(sat_idx + 12, len(stripped))):
        if stripped[i] in ("Easy", "Medium", "Hard"):
            diff_idx = i
            break
    if diff_idx is None:
        return None, ["no difficulty found"]
    difficulty = stripped[diff_idx].lower()
    meta = norm(" ".join(s for s in stripped[sat_idx + 2:diff_idx] if s))
    domain, skill = meta, ""
    for d in domains:
        if meta.startswith(d):
            domain = d
            skill = meta[len(d):].strip()
            break

    # ---- structural labels ----
    q_label_idx = None
    for i in range(diff_idx + 1, len(stripped)):
        if stripped[i] == "Question":
            q_label_idx = i
            break
    if q_label_idx is None:
        return None, ["no Question label"]

    answer_idx = correct_idx = rationale_idx = None
    for i in range(q_label_idx + 1, len(stripped)):
        if stripped[i] == "Answer" and answer_idx is None and correct_idx is None \
                and rationale_idx is None:
            answer_idx = i
        elif correct_idx is None and rationale_idx is None and CORRECT_RE.match(stripped[i]):
            correct_idx = i
        elif stripped[i] == "Rationale" and rationale_idx is None:
            rationale_idx = i
            break

    stem_end = next((i for i in (answer_idx, correct_idx, rationale_idx)
                     if i is not None), len(stripped))
    stem_raw = [lines[i][1] for i in range(q_label_idx + 1, stem_end)]
    stem = norm(" ".join(norm(l) for l in stem_raw))

    has_gaps = False
    for raw in stem_raw:
        r = raw.replace("\xa0", " ")
        if (r.endswith(" ") and r.strip() != "") or r.strip()[:1] in (",", ".", "?", ";", ")"):
            has_gaps = True
    if re.search(r"\s[,.?;)]", " ".join(stem_raw).replace("\xa0", " ")):
        has_gaps = True

    # ---- choices ----
    choices = None
    qtype = "spr"
    if answer_idx is not None:
        qtype = "mcq"
        choices = []
        cur = None
        choice_end = next((i for i in (correct_idx, rationale_idx)
                           if i is not None), len(stripped))
        for i in range(answer_idx + 1, choice_end):
            s = stripped[i]
            m2 = CHOICE_RE.match(s)
            if m2 and (cur is None or ord(m2.group(1)) == ord(cur["label"]) + 1):
                cur = {"label": m2.group(1), "text": m2.group(2).strip()}
                choices.append(cur)
            elif cur is not None and s:
                cur["text"] = norm(cur["text"] + " " + s)
        for c in choices:
            c["text"] = norm(c["text"])

    # ---- rationale ----
    rationale = None
    if rationale_idx is not None:
        rat = [norm(lines[i][1]) for i in range(rationale_idx + 1, len(stripped))]
        rationale = norm(" ".join(l for l in rat if l)) or None

    # ---- correct answer (with recovery from rationale) ----
    correct = ""
    correct_recovered = False
    if correct_idx is not None:
        correct = CORRECT_RE.match(stripped[correct_idx]).group(1).strip()
    elif rationale:
        if qtype == "mcq":
            m3 = CHOICE_CORRECT_RE.search(rationale)
            if m3:
                correct = m3.group(1)
                correct_recovered = True
        else:
            vals = []
            m3 = NUM_RE.search(rationale)
            if m3:
                vals.append(m3.group(1).rstrip(".,"))
            m4 = NOTE_RE.search(rationale)
            if m4:
                for part in re.split(r",| and ", m4.group(1)):
                    part = part.strip().rstrip(".,")
                    if part and re.fullmatch(r"-?\.?\d[\d,./]*", part) and part not in vals:
                        vals.append(part)
            if vals:
                correct = ", ".join(vals)
                correct_recovered = True

    # ---- passage separation (ELA) ----
    passage = None
    if section == "ela" and stem:
        best = -1
        for pat in QUESTION_STARTS:
            idx = stem.rfind(pat)
            if idx > best:
                prev = stem[max(0, idx - 2):idx]
                if idx == 0 or prev.endswith(". ") or prev.endswith("? ") or \
                   prev.endswith("! ") or prev.endswith("_ ") or \
                   prev.endswith("” ") or prev.endswith('" '):
                    best = idx
        if best > 0:
            passage = stem[:best].strip()
            stem = stem[best:].strip()

    # ---- safe question region (never includes the answer) ----
    region = compute_region(doc, page_start, page_end)

    # ---- figure detection within region ----
    fig_cluster = None
    for p, y_top, y_bot in region:
        if p not in drawings_cache:
            drawings_cache[p] = [d["rect"] for d in doc[p].get_drawings()]
        page_w = doc[p].rect.width
        rects = [r for r in drawings_cache[p]
                 if r.y0 >= y_top and r.y1 <= y_bot and r.width < page_w * 0.98]
        if not rects:
            continue
        for bbox, count in cluster_drawings(rects):
            if count >= 10 and bbox.width >= 100 and bbox.height >= 50:
                if fig_cluster is None or bbox.get_area() > fig_cluster[1].get_area():
                    fig_cluster = (p, bbox, y_top, y_bot)

    # ---- suspect (text quality) ----
    suspect = False
    if len(stem) < 25:
        suspect = True
    if section == "math" and has_gaps:
        suspect = True
    if qtype == "mcq" and (not choices or len(choices) != 4 or any(not c["text"] for c in choices)):
        suspect = True

    # ---- renders ----
    has_figure = fig_cluster is not None
    figure_path = None
    if fig_cluster is not None and qid:
        p, bbox, y_top, y_bot = fig_cluster
        clip_top = max(y_top, bbox.y0 - 10)
        clip_bot = min(y_bot, bbox.y1 + 10)
        try:
            ok = render_region(doc, [(p, clip_top, clip_bot)],
                               os.path.join(FIG_DIR, f"{qid}.png"))
            if ok:
                figure_path = f"figures/{qid}.png"
        except Exception:
            figure_path = None

    # Math notation is vector art with no extractable characters, so it has to
    # be shown as an image. Prefer TIGHT crops (stem alone + one per choice)
    # so the client can draw real answer cards; fall back to the whole-region
    # render only when the page has no usable anchors (multi-page questions).
    # See scripts/mathcrop.py — note the correct-answer clamp in there.
    stem_image_path = None
    choice_images = {}
    if section == "math" and qid:
        try:
            page = doc[page_start]
            lines_pg = mathcrop.page_lines(page)
            qi, ai, ci = mathcrop.find_anchors(lines_pg)
            croppable = qi is not None and ci is not None
        except Exception:
            croppable = False
        if croppable:
            try:
                stem_image_path, choice_images = mathcrop.crop_question(
                    page, qid, FIG_DIR, choices or [], stem,
                    lambda name: os.path.join(FIG_DIR, name))
            except Exception:
                stem_image_path, choice_images = None, {}
        else:
            try:
                ok = render_region(doc, region,
                                   os.path.join(FIG_DIR, f"qstem_{qid}.png"))
                if ok:
                    stem_image_path = f"figures/qstem_{qid}.png"
            except Exception:
                stem_image_path = None

    # A math question is usable once the answer is known AND the prompt is
    # actually readable — either a render exists, or the extracted text stands
    # on its own (which the tight-crop path now leaves plenty of).
    readable = bool(stem_image_path) or bool(choice_images) \
        or (section == "math" and not mathcrop.stem_needs_image(stem))
    if readable and correct:
        if qtype != "mcq" or correct in ("A", "B", "C", "D"):
            suspect = False

    violations = []
    if not stem:
        violations.append("empty_stem")
    if not correct:
        violations.append("missing_correct")
        suspect = True
    if qtype == "mcq":
        if not choices or len(choices) != 4:
            violations.append("mcq_not_4_choices")
        if correct and correct not in ("A", "B", "C", "D"):
            violations.append("mcq_bad_correct")

    obj = {
        "id": qid,
        "section": section,
        "domain": domain,
        "skill": skill,
        "difficulty": difficulty,
        "type": qtype,
        "passage": passage if passage else None,
        "stem": stem,
        "choices": choices,
        "correct": correct,
        "rationale": rationale,
        "hasFigure": has_figure,
        "figurePath": figure_path,
    }
    if section == "math":
        obj["stemImagePath"] = stem_image_path
        if choice_images:
            obj["choiceImages"] = choice_images
        obj["suspect"] = suspect
    elif suspect:
        obj["suspect"] = True
    if correct_recovered:
        obj["correctRecovered"] = True
    return obj, violations


def load_existing(path):
    """Existing bank as (list_of_records, set_of_ids). Missing file -> empty."""
    out, ids = [], set()
    if not os.path.exists(path):
        return out, ids
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("id") and rec["id"] not in ids:
                ids.add(rec["id"])
                out.append(rec)
    return out, ids


def parse_args(argv):
    p = argparse.ArgumentParser(
        description="Parse College Board SAT Suite Question Bank PDF exports into JSONL.")
    p.add_argument("pdfs", nargs="+", help="one or more questionbank-export PDFs")
    p.add_argument("--merge", action="store_true",
                   help="ADD to the existing bank, keeping questions already in "
                        "questions.jsonl. Without this the bank is rebuilt from "
                        "the given PDFs only, and anything not in them is lost.")
    p.add_argument("--out", default=OUT_DIR, help=f"output data dir (default: {OUT_DIR})")
    p.add_argument("--dry-run", action="store_true",
                   help="parse and report, but write nothing")
    p.add_argument("--batch", default=None,
                   help="label stamped on questions added by THIS run (default: "
                        "derived from the first PDF's name, e.g. 2026-08-15). "
                        "The app uses it to filter practice by content age.")
    return p.parse_args(argv)


BATCH_RE = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")


def batch_label(args):
    if args.batch:
        return args.batch
    m = BATCH_RE.search(os.path.basename(args.pdfs[0]))
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return "unlabelled"


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])

    global OUT_DIR, FIG_DIR
    OUT_DIR = os.path.abspath(args.out)
    FIG_DIR = os.path.join(OUT_DIR, "figures")

    missing = [p for p in args.pdfs if not os.path.exists(p)]
    if missing:
        print("ERROR: PDF(s) not found:", file=sys.stderr)
        for m in missing:
            print("  " + m, file=sys.stderr)
        return 2

    os.makedirs(FIG_DIR, exist_ok=True)
    qpath = os.path.join(OUT_DIR, "questions.jsonl")

    # In --merge mode the existing bank seeds both the output list and the
    # de-dupe set, so a new export only contributes IDs we have never seen.
    if args.merge:
        questions, seen = load_existing(qpath)
        print(f"merge: {len(questions)} existing questions loaded from {qpath}")
    else:
        questions, seen = [], set()
        if os.path.exists(qpath):
            existing_n = sum(1 for _ in open(qpath, "r", encoding="utf-8"))
            print(f"REBUILD: {qpath} has {existing_n} questions and will be REPLACED "
                  f"by the {len(args.pdfs)} PDF(s) given. Use --merge to add instead.")
    before = len(questions)

    diag = {
        "skippedPages": [],
        "parseFailures": [],
        "violationCounts": collections.Counter(),
        "duplicateIds": 0,
    }
    batch = batch_label(args)
    print(f"batch label for new questions: {batch}")

    skipped_known = 0
    for pdf_path in args.pdfs:
        doc = fitz.open(pdf_path)
        drawings_cache = {}
        starts = []
        start_ids = []
        for i in range(doc.page_count):
            first = doc[i].get_text(flags=FLAGS).split("\n", 1)[0]
            m = QID_RE.match(first.strip())
            if m:
                starts.append(i)
                start_ids.append(m.group(1))
            elif not starts:
                diag["skippedPages"].append(f"{os.path.basename(pdf_path)}:{i+1}")
        starts.append(doc.page_count)
        n = len(starts) - 1
        for k in range(n):
            # Cheap ID peek BEFORE parsing. parse_question renders figure and
            # stem images to disk as a side effect, so without this a merge
            # would re-render every image for questions we already hold —
            # thousands of pointless 2x page renders, and a --dry-run that
            # isn't actually dry.
            if start_ids[k] in seen:
                skipped_known += 1
                continue
            obj, viol = parse_question(doc, starts[k], starts[k + 1], drawings_cache)
            if obj is None:
                diag["parseFailures"].append(
                    f"{os.path.basename(pdf_path)}:p{starts[k]+1}: {viol}")
                continue
            for v in viol:
                diag["violationCounts"][v] += 1
            if obj["id"] in seen:
                diag["duplicateIds"] += 1
                continue
            seen.add(obj["id"])
            obj["batch"] = batch          # content-age tag for practice filters
            obj["_page"] = starts[k] + 1
            obj["_pdf"] = os.path.basename(pdf_path)
            questions.append(obj)
            if (k + 1) % 250 == 0:
                print(f"  {os.path.basename(pdf_path)}: {k+1}/{n}", flush=True)
        doc.close()
        print(f"done {os.path.basename(pdf_path)}: {n} questions", flush=True)

    added = len(questions) - before
    print(f"\n{added} new question(s) added; bank now {len(questions)} "
          f"({skipped_known} already known, skipped before parse)")

    # NOTE: the summary is computed and printed BEFORE the dry-run bail-out.
    # The whole point of --dry-run is to see parse failures and violations
    # before committing, so returning early made it useless for that.
    write_outputs = not args.dry_run

    if write_outputs:
        # Atomic write: parsing 3k+ questions then dying mid-write would leave
        # a truncated bank, and the server reads this file on boot.
        tmp = qpath + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            for q in questions:
                rec = {k: v for k, v in q.items() if not k.startswith("_")}
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        os.replace(tmp, qpath)

    # pagemap only gets entries for questions parsed THIS run (merged records
    # loaded from disk have no _pdf/_page), so merge it with what is on file.
    pm_path = os.path.join(OUT_DIR, "pagemap.json")
    pagemap = {}
    if args.merge and os.path.exists(pm_path):
        try:
            with open(pm_path, "r", encoding="utf-8") as f:
                pagemap = json.load(f)
        except (json.JSONDecodeError, OSError):
            pagemap = {}
    for q in questions:
        if "_pdf" in q:
            pagemap[q["id"]] = {"pdf": q["_pdf"], "page": q["_page"]}
    if write_outputs:
        with open(pm_path, "w", encoding="utf-8") as f:
            json.dump(pagemap, f)

    # .get() throughout: records merged in from disk are trusted but not
    # assumed to carry every field a freshly parsed one does.
    def count_by(key):
        c = collections.Counter()
        for q in questions:
            c[str(q.get(key))] += 1
        return dict(c)

    n_suspect = sum(1 for q in questions if q.get("suspect"))
    n_fig = sum(1 for q in questions if q.get("hasFigure"))
    math_qs = [q for q in questions if q.get("section") == "math"]
    summary = {
        "totalParsed": len(questions),
        "addedThisRun": added,
        "mode": "merge" if args.merge else "rebuild",
        "sourcePdfs": [os.path.basename(p) for p in args.pdfs],
        "bySection": count_by("section"),
        "byDifficulty": count_by("difficulty"),
        "byDomain": count_by("domain"),
        "byType": count_by("type"),
        "hasFigure": {"true": n_fig, "false": len(questions) - n_fig},
        "figurePathSet": sum(1 for q in questions if q.get("figurePath")),
        "mathStemImages": sum(1 for q in math_qs if q.get("stemImagePath")),
        "mathStemImageMissing": [q["id"] for q in math_qs if not q.get("stemImagePath")],
        "correctRecoveredFromRationale": sum(1 for q in questions if q.get("correctRecovered")),
        "suspect": n_suspect,
        "violations": dict(diag["violationCounts"]),
        "missingCorrectIds": [q["id"] for q in questions if not q.get("correct")],
        "duplicateIdsSkipped": diag["duplicateIds"],
        "parseFailures": diag["parseFailures"],
        "skippedPages": diag["skippedPages"][:50],
    }
    if write_outputs:
        with open(os.path.join(OUT_DIR, "summary.json"), "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
    print(json.dumps({k: v for k, v in summary.items()
                      if k not in ("parseFailures", "mathStemImageMissing", "missingCorrectIds")},
                     indent=2))
    print("parseFailures:", len(summary["parseFailures"]))
    for pf in summary["parseFailures"][:10]:
        print("   " + pf)
    print("missingCorrect:", len(summary["missingCorrectIds"]))
    if not write_outputs:
        print("\n--dry-run: diagnostics above are real, nothing was written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
