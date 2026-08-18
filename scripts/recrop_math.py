"""One-time pass: replace whole-page math renders with tight stem/choice crops.

    python scripts/recrop_math.py <export.pdf> [<export.pdf> ...] [--dry-run]

Scans the given exports for "Question ID:" pages, then for every MATH question
already in data/questions.jsonl renders tight images via mathcrop and rewrites
the record:

    stemImagePath  -> the stem-only crop, or null when the stem text is clean
    choiceImages   -> {"A": "figures/ch_<id>_A.png", ...} for choices whose
                      text did not survive extraction

Questions whose source page is not in the supplied PDFs, or that span pages
(no usable anchors), keep exactly what they had — this never leaves a question
without something renderable.

Old qstem_<id>.png files are left on disk; delete them once you're happy.
"""
import argparse
import collections
import json
import os
import re
import sys

import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mathcrop  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data")
FIGS = os.path.join(DATA, "figures")
QID_RE = re.compile(r"^Question ID:\s*([0-9a-f]{8})\s*$")
FLAGS = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_INHIBIT_SPACES


def index_pdfs(paths):
    """
    qid -> (pdf_path, first_page, end_page_exclusive).

    The page RANGE matters for rationales, which routinely run past the bottom
    of the page the question starts on.
    """
    loc = {}
    for p in paths:
        doc = fitz.open(p)
        starts = []                      # (page_index, qid)
        for i in range(doc.page_count):
            first = doc[i].get_text(flags=FLAGS).split("\n", 1)[0].strip()
            m = QID_RE.match(first)
            if m:
                starts.append((i, m.group(1)))
        for n, (i, qid) in enumerate(starts):
            end = starts[n + 1][0] if n + 1 < len(starts) else doc.page_count
            if qid not in loc:
                loc[qid] = (p, i, end)
        doc.close()
        print(f"  indexed {os.path.basename(p)} ({len(starts)} questions)")
    return loc


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("pdfs", nargs="+")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv if argv is not None else sys.argv[1:])

    missing = [p for p in args.pdfs if not os.path.exists(p)]
    if missing:
        for m in missing:
            print("ERROR: not found:", m, file=sys.stderr)
        return 2

    qpath = os.path.join(DATA, "questions.jsonl")
    recs = [json.loads(l) for l in open(qpath, encoding="utf-8") if l.strip()]
    print(f"bank: {len(recs)} questions")

    print("indexing exports...")
    loc = index_pdfs(args.pdfs)
    print(f"  {len(loc)} question ids located")

    os.makedirs(FIGS, exist_ok=True)
    stat = collections.Counter()
    open_docs = {}

    def doc_for(path):
        if path not in open_docs:
            open_docs[path] = fitz.open(path)
        return open_docs[path]

    for n, q in enumerate(recs):
        if q.get("section") != "math":
            stat["skipped_non_math"] += 1
            continue
        where = loc.get(q["id"])
        if not where:
            stat["not_in_export"] += 1
            continue
        pdf_path, page_i, page_end = where
        doc = doc_for(pdf_path)
        page = doc[page_i]
        try:
            stem_rel, ch_rel = mathcrop.crop_question(
                page, q["id"], FIGS, q.get("choices") or [], q.get("stem") or "",
                lambda name: os.path.join(FIGS, name))
        except Exception as e:                       # noqa: BLE001
            stat["render_error"] += 1
            print(f"  ! {q['id']}: {e}")
            continue

        # Rationales get rendered unconditionally for math, for the same
        # reason stems do: 94% of them lose their notation, and an
        # explanation with the maths removed is worse than useless.
        try:
            rat = mathcrop.crop_rationale(doc, page_i, page_end, q["id"],
                                          lambda name: os.path.join(FIGS, name))
        except Exception as e:                       # noqa: BLE001
            rat = None
            print(f"  ! rationale {q['id']}: {e}")
        if rat:
            q["rationaleImagePath"] = rat
            stat["rationale_cropped"] += 1
        else:
            q.pop("rationaleImagePath", None)
            stat["rationale_missing"] += 1

        # crop_question decides from artwork in the PDF, not from the wording,
        # so its answer is authoritative: no crop means none was needed.
        lines = mathcrop.page_lines(page)
        qi, _, ci = mathcrop.find_anchors(lines)
        if qi is None or ci is None:
            stat["kept_old_render"] += 1          # spans pages; leave as-is
            continue

        q["stemImagePath"] = stem_rel
        if stem_rel:
            stat["stem_cropped"] += 1
        else:
            stat["stem_pure_text"] += 1
        if ch_rel:
            q["choiceImages"] = ch_rel
            stat["choice_images"] += len(ch_rel)
            stat["questions_with_choice_art"] += 1
        else:
            q.pop("choiceImages", None)
            stat["choices_pure_text"] += 1
        if (n + 1) % 400 == 0:
            print(f"  {n + 1}/{len(recs)}")

    for d in open_docs.values():
        d.close()

    print()
    for k, v in sorted(stat.items()):
        print(f"  {k:28} {v}")

    if args.dry_run:
        print("\n--dry-run: questions.jsonl not rewritten (images WERE written)")
        return 0

    tmp = qpath + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for q in recs:
            f.write(json.dumps(q, ensure_ascii=False) + "\n")
    os.replace(tmp, qpath)
    print(f"\nrewrote {qpath}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
