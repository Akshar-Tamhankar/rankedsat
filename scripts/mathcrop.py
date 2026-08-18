"""Tight per-region renders for math questions.

WHY THIS EXISTS
College Board's Question Bank PDF draws math notation as vector artwork using
unembedded Type3 fonts that carry no character data. The prose extracts fine;
the notation extracts as nothing at all:

    "For a linear relationship between \\n and \\n, the table gives ..."
    "Answer\\nA. \\nB. \\nC. \\nD. \\nCorrect Answer: D"

The characters are not recoverable by any extraction flag — they were never
stored. Notation has to be shown as an image. What we control is granularity:
a stem-only crop plus one crop per choice, so the client can draw real answer
cards instead of pasting a screenshot of the whole page.

DETECTING WHETHER AN IMAGE IS NEEDED — DO NOT GUESS FROM THE TEXT
A previous version inferred "this stem lost notation" from prose artefacts
(double spaces, dangling prepositions). That silently failed on 535 questions,
because the parser normalises whitespace, so:

    "at an average speed of  32  meters"   ->  "at an average speed of meters"

reads as perfectly ordinary prose. The question then rendered as text with the
numbers simply gone, and was unsolvable.

So notation is now detected POSITIVELY, from the PDF: if vector drawings fall
inside a region's vertical band, that region contains artwork and gets an
image. No inference from wording.

SAFETY INVARIANT
Nothing is ever rendered at or below the "Correct Answer:" line. Every crop is
clamped to a hard floor above it. An early draft padded into that line and
produced a choice image reading "ct Answer: D" — i.e. it leaked the key into
the question view. The clamp is not optional.
"""
import os
import re

import fitz
from PIL import Image, ImageChops

ZOOM = 2.0
ANSWER_GAP = 8.0     # hard floor kept above the "Correct Answer:" line
PAD_X = 6.0          # breathing room around tight horizontal bounds
MIN_H = 3.0
MIN_INK = 0.5        # ignore hairline artefacts when looking for notation

CHOICE_RE = re.compile(r"^([A-D])\.")
CORRECT_RE = re.compile(r"^Correct Answer:")

_draw_cache = {}


def _drawings(page):
    """get_drawings() is expensive and we hit each page several times."""
    key = (id(page.parent), page.number)
    hit = _draw_cache.get(key)
    if hit is None:
        hit = [d["rect"] for d in page.get_drawings()]
        if len(_draw_cache) > 64:
            _draw_cache.clear()
        _draw_cache[key] = hit
    return hit


_GAP_RE = re.compile(r"\s\s|\s[,.?;)%]")


def band_text_has_gaps(page, y0, y1):
    """
    True when the text extracted from this band has holes where notation was.

    This is the RAW text for the band — not the parser's normalised stem.
    Normalisation collapses the very whitespace that reveals a stripped glyph:

        "speed of  16  meters"  ->  "speed of meters"

    reads as ordinary prose, which is how 535 questions shipped unsolvable.
    In the raw text the hole is still visible as a trailing space before the
    line break, a line starting with punctuation, or a doubled space.
    """
    raw = page.get_text("text", clip=fitz.Rect(0, y0, page.rect.width, y1))
    if not raw.strip():
        return True                      # nothing extracted at all
    raw = raw.replace("\xa0", " ")
    for line in raw.split("\n"):
        if line.strip() and line != line.rstrip():
            return True                  # glyph removed from the line end
        if line.strip()[:1] in (",", ".", "?", ";", ")", "%"):
            return True                  # line begins with orphaned punctuation
    if _GAP_RE.search(raw):
        return True

    # DISPLAY MATH: an equation on its own line extracts as a completely blank
    # line — no trailing space, no orphaned punctuation, nothing for the tests
    # above to catch. Compare laid-out lines against lines that actually
    # produced text; a difference means something on the page rendered as
    # artwork. This is what "Which of the following values of x satisfies the
    # given equation?" looked like: prose intact, equation simply absent.
    laid_out = 0
    with_text = 0
    d = page.get_text("dict", clip=fitz.Rect(0, y0, page.rect.width, y1))
    for b in d.get("blocks", []):
        for l in b.get("lines", []) or []:
            laid_out += 1
            if "".join(s.get("text", "") for s in l.get("spans", [])).strip():
                with_text += 1
    return laid_out > with_text


def band_has_notation(page, y0, y1):
    """
    True when this band needs to be shown as an image.

    Two independent signals, because neither alone is sufficient:
      - vector artwork in the band (tables, graphs, some notation), and
      - holes in the raw extracted text (Type3 glyphs, which are NOT reported
        by get_drawings() at all — that gap is what left 13/60 questions
        still broken after the first fix).
    Either one means render it.
    """
    for r in _drawings(page):
        if r.y1 <= y0 or r.y0 >= y1:
            continue
        if r.width >= MIN_INK and r.height >= MIN_INK:
            return True
    return band_text_has_gaps(page, y0, y1)


def trim_to_ink(path, pad=8):
    """
    Crop a rendered PNG down to its non-white pixels.

    This replaces trying to compute content bounds from the PDF's own
    metadata, which cannot work here: Type3 glyphs are absent from
    get_drawings() AND carry no usable text bbox, so a fraction measured that
    way came out 22pt wide — just the "A." label, with the maths cut off.

    Measuring the rendered pixels sidesteps the question of HOW something was
    drawn. Render the band generously, then let the ink define the crop.
    Returns False if the band turned out to be blank.
    """
    with Image.open(path) as im:
        rgb = im.convert("RGB")
        bg = Image.new("RGB", rgb.size, (255, 255, 255))
        bbox = ImageChops.difference(rgb, bg).getbbox()
        if not bbox:
            return False
        l, t, r, b = bbox
        l = max(0, l - pad)
        t = max(0, t - pad)
        r = min(rgb.width, r + pad)
        b = min(rgb.height, b + pad)
        if r - l < 2 or b - t < 2:
            return False
        rgb.crop((l, t, r, b)).save(path)
    return True


RATIONALE_RE = re.compile(r"^Rationale\s*$")
PAGE_MARGIN = 26.0


def crop_rationale(doc, page_start, page_end, qid, path_for):
    """
    Render a math question's rationale, stitching across pages when needed.

    94% of math rationales come through with their notation missing — the same
    Type3 problem as the stems, but worse here, because the rationale IS the
    explanation. "It's given that . Substituting for in the equation yields ."
    teaches nothing.

    Unlike stems, a rationale routinely runs past the bottom of its page, so
    each page's slice is rendered, trimmed to ink, and the slices are stacked
    into one tall image.

    Safe to render in full: this region sits BELOW the "Correct Answer:" line
    and is only ever sent after an answer has been submitted.
    """
    segs = []
    started = False
    for pi in range(page_start, page_end):
        page = doc[pi]
        lines = page_lines(page)
        top = PAGE_MARGIN
        if not started:
            idx = next((i for i, l in enumerate(lines) if RATIONALE_RE.match(l[2])), None)
            if idx is None:
                continue                      # rationale hasn't begun yet
            top = lines[idx][1] + 2
            started = True
        bot = page.rect.height - PAGE_MARGIN
        if bot - top <= MIN_H:
            continue
        segs.append((pi, top, bot))
    if not segs:
        return None

    tiles = []
    try:
        for pi, top, bot in segs:
            pix = doc[pi].get_pixmap(
                matrix=fitz.Matrix(ZOOM, ZOOM),
                clip=fitz.Rect(0.0, top, doc[pi].rect.width, bot))
            im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            bbox = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255))).getbbox()
            if not bbox:
                continue                      # blank tail page
            l, t, r, b = bbox
            tiles.append(im.crop((max(0, l - 8), max(0, t - 6),
                                  min(im.width, r + 8), min(im.height, b + 6))))
        if not tiles:
            return None
        width = max(t.width for t in tiles)
        gap = 14
        height = sum(t.height for t in tiles) + gap * (len(tiles) - 1)
        out = Image.new("RGB", (width, height), (255, 255, 255))
        y = 0
        for t in tiles:
            out.paste(t, (0, y))
            y += t.height + gap
        name = f"rat_{qid}.png"
        out.save(path_for(name))
        return f"figures/{name}"
    finally:
        for t in tiles:
            t.close()


def page_lines(page):
    """(y0, y1, text) per visual line, sorted top-down."""
    d = page.get_text("dict")
    out = []
    for b in d.get("blocks", []):
        for l in b.get("lines", []) or []:
            txt = "".join(s.get("text", "") for s in l.get("spans", [])).strip()
            out.append((l["bbox"][1], l["bbox"][3], txt))
    out.sort()
    return out


def find_anchors(lines):
    """Indices of the Question / Answer / Correct-Answer marker lines."""
    qi = ai = ci = None
    for i, (_, _, t) in enumerate(lines):
        if t == "Question" and qi is None:
            qi = i
        elif t == "Answer" and ai is None and ci is None:
            ai = i
        elif CORRECT_RE.match(t) and ci is None:
            ci = i
    return qi, ai, ci


def _render(page, y0, y1, floor, out_path):
    """Render a generous band, then trim it to the ink actually inside it."""
    y1 = min(y1, floor)
    if y1 - y0 <= MIN_H:
        return False
    # Full page width: the trim pass decides the real horizontal extent, and
    # anything narrower here risks clipping notation we cannot measure.
    clip = fitz.Rect(0.0, max(0.0, y0), page.rect.width, min(page.rect.height, y1))
    if clip.height <= MIN_H:
        return False
    page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), clip=clip).save(out_path)
    if not trim_to_ink(out_path):
        try:
            os.remove(out_path)
        except OSError:
            pass
        return False
    return True


def crop_question(page, qid, fig_dir, choices, stem, path_for):
    """
    Render the stem/choice images one single-page math question needs.

    `path_for(name)` -> absolute output path. Returns
    (stem_rel_path_or_None, {letter: rel_path}). Returns (None, {}) when the
    page has no usable anchors (e.g. the question spans pages) so the caller
    can fall back to a whole-region render.
    """
    lines = page_lines(page)
    qi, ai, ci = find_anchors(lines)
    if qi is None or ci is None:
        return None, {}

    floor = lines[ci][0] - ANSWER_GAP     # see SAFETY INVARIANT
    stem_rel = None
    ch_rel = {}

    stem_top = lines[qi][1] + 2
    stem_end = (lines[ai][0] if ai is not None else lines[ci][0]) - 2

    # MATH STEMS ARE ALWAYS RENDERED. Three detectors were tried and all had
    # blind spots that shipped unsolvable questions:
    #   1. prose heuristics  - killed by the parser's whitespace normalisation
    #   2. get_drawings()    - does not report Type3 glyph rendering
    #   3. laid-out vs text  - PyMuPDF emits no line at all for pure artwork
    # There is no reliable "this stem is complete" signal in the file, and the
    # costs are wildly asymmetric: a redundant image is cosmetic, a stem with
    # its numbers silently missing is a question that cannot be answered. So
    # the stem crop is unconditional. It is tightly cropped and reads like
    # ordinary text, which is why this is an acceptable trade rather than a
    # retreat to full-page screenshots.
    name = f"stem_{qid}.png"
    if _render(page, stem_top, stem_end, floor, path_for(name)):
        stem_rel = f"figures/{name}"

    if ai is not None and choices:
        marks = [lines[i] for i in range(ai + 1, ci) if CHOICE_RE.match(lines[i][2])]
        letters = [CHOICE_RE.match(m[2]).group(1) for m in marks]

        # VERTICAL BOUNDS — split at the MIDPOINT between adjacent choices,
        # never at the "A."/"B." text lines themselves.
        #
        # A fraction's numerator sits above the text baseline and its
        # denominator below, and both are artwork the text bbox knows nothing
        # about. Cropping at the text line therefore sliced straight through
        # every fraction: the denominator was cut off the bottom of its own
        # card and reappeared at the top of the next one. Midpoints give each
        # choice the full vertical space it actually occupies.
        bands = []
        for n, m in enumerate(marks):
            top = ((marks[n - 1][1] + m[0]) / 2.0) if n > 0 else (lines[ai][1] + 1)
            bot = ((m[1] + marks[n + 1][0]) / 2.0) if n + 1 < len(marks) else floor
            bands.append((top, bot))

        by_letter = {letters[n]: bands[n] for n in range(len(marks))}
        for c in choices:
            letter = c.get("label")
            if letter not in by_letter:
                continue
            top, end = by_letter[letter]
            # Choices are safer to judge than stems: the extracted text either
            # contains the whole option or is empty. Only skip the image when
            # there is real text AND no artwork sharing its band.
            if (c.get("text") or "").strip() and not band_has_notation(page, top, min(end, floor)):
                continue
            name = f"ch_{qid}_{letter}.png"
            if _render(page, top, end, floor, path_for(name)):
                ch_rel[letter] = f"figures/{name}"

    return stem_rel, ch_rel
