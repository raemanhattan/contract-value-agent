"""Parse Spotrac 'team financials' PDF exports into structured cap-hit rows.

These PDFs are browser print-to-PDF exports of a two-column web layout: a
numbered stats block (Pos, Age, Cap Hit, Cap Hit %) and a separate player-name
block, aligned only by vertical position on the page -- not by any shared
table structure. Naive linear text extraction interleaves the two blocks and
scrambles row order. This parser groups words by y-position (`top`) instead,
which recovers the correct row alignment.

Section headers ("2026 Injured Reserve", "2026 Practice Squad", etc.) are
large bold text (size ~18, bold font) and mark section boundaries; the
"Dead Money" section is skipped since released/waived players have no
Cap Hit % or Age-at-signing relevant to the market model, and its column
layout differs (no Cap Hit % column at all).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pdfplumber

# Font sizes vary between team PDFs (likely different browser zoom/scale
# at export time) -- observed families are body<=9.6/header=14.24/title=19
# and body<=12.0/header=18.0/title=24.0. 13.0 sits cleanly in the gap
# between body text and section headers across both families.
SECTION_HEADER_SIZE_MIN = 13.0
ROW_Y_TOLERANCE = 4.0
# A wrapped player name spans two lines that are NOT symmetric around the
# stat row's y-position -- Spotrac renders "LastName [Suffix] FirstName
# MiddleParts" on one line and a repeated "LastName [Suffix]" on the next,
# with the stat row (rank/Pos/Age/...) anchored to whichever of the two
# lines is closer to it (observed gaps: 1.5-13.5pt within one wrapped
# name's own two lines, vs ~25-35pt between different players' rows).
# NAME_LINE_GAP_MAX clusters name-word lines by proximity to each other
# (not to the stat anchor), so an asymmetric wrap is captured whole.
NAME_LINE_GAP_MAX = 15.0
# Once a name's line-cluster is built, it's assigned to the nearest stat
# row within this many points of the cluster's closest line.
NAME_Y_TOLERANCE = 15.0

# Section names we care about (player currently on the books, valued as
# active production-for-pay). Dead Money (released/waived/voided) is
# deliberately excluded -- it has a different column layout and isn't a
# current production-for-pay signal.
KEPT_SECTIONS = {
    "Active Roster",
    "Injured Reserve",
    "Reserve/PUP",
    "Practice Squad",
}

SECTION_HEADER_RE = re.compile(
    r"^\d{4}\s+(Active Roster|Injured Reserve|Reserve/PUP|Practice Squad|Dead Money)$"
)

# Column x0 positions shift per team PDF (dollar amounts and dead-cap
# widths vary, pushing later columns left/right), so absolute x-ranges are
# not reliable across files. Instead, the Pos/Age/CapHit/Pct columns are
# recognized by VALUE SHAPE (a short letter code, a 2-digit number, a
# dollar amount, a percentage) in their fixed left-to-right order, and
# NAME_X_MAX -- the boundary separating name-column words from the first
# stat column (Pos) -- is derived per-page from the header row rather than
# hardcoded.
DEFAULT_NAME_X_MAX = 200.0
POS_RE = re.compile(r"^[A-Z]{1,3}$")
CAP_HIT_RE = re.compile(r"^\$[\d,]+$")
CAP_HIT_PCT_RE = re.compile(r"^\d+\.\d+%$")


@dataclass
class PlayerCapRow:
    team: str
    season: int
    section: str
    rank: int
    player: str
    position: str
    age: int
    cap_hit: int
    cap_hit_pct: float


def _team_and_season_from_filename(path: Path) -> tuple[str, int]:
    # e.g. "Arizona Cardinals 2026 Financials.pdf"
    stem = path.stem
    match = re.match(r"^(.*) (\d{4}) Financials$", stem)
    if not match:
        raise ValueError(f"unrecognized filename format: {path.name}")
    return match.group(1), int(match.group(2))


def _cluster_rows(words: list[dict]) -> list[list[dict]]:
    """Group words into rows by y-position, tolerating multi-line player names."""
    rows: list[list[dict]] = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        placed = False
        for row in rows:
            if abs(row[0]["top"] - word["top"]) <= ROW_Y_TOLERANCE:
                row.append(word)
                placed = True
                break
        if not placed:
            rows.append([word])
    return rows


def _parse_money(text: str) -> int | None:
    cleaned = text.replace("$", "").replace(",", "")
    if not cleaned or not re.match(r"^\d+$", cleaned):
        return None
    return int(cleaned)


_NAME_GLYPH_RE = re.compile(r"[^\w\s.\'-]", re.UNICODE)


def _join_name_words(words: list[dict]) -> str:
    """Join name-column word fragments into a single string. When a long
    display name wraps across two lines mid-word (e.g. "Bako-" / "Bewele"),
    pdfplumber yields separate word tokens for each line with no shared
    hyphen -- joining them with a space produces "Bako- Bewele" instead of
    "Bako-Bewele". Suppress the space whenever the previous fragment ends
    in a hyphen. Also strips Spotrac's inline status icons (e.g. "♲" for
    IR-designated-to-return, private-use-area glyphs for franchise/captain
    markers) that render inline with the name text.
    """
    parts: list[str] = []
    for w in words:
        text = _NAME_GLYPH_RE.sub("", w["text"]).strip()
        if not text:
            continue
        if parts and parts[-1].endswith("-"):
            parts[-1] = parts[-1] + text
        else:
            parts.append(text)
    return " ".join(parts)


def normalize_player_name(raw_name: str) -> str:
    """Spotrac's name column always renders as "<LastName> <FullName>",
    where <FullName> already ends with <LastName> (a sort-key prefix
    followed by the actual display name). Strip the prefix, trying each
    split point left-to-right and taking the first where the remainder
    ends with (or equals) the candidate prefix.
    """
    tokens = raw_name.split()
    for split in range(1, len(tokens)):
        prefix = " ".join(tokens[:split])
        rest = " ".join(tokens[split:])
        if rest == prefix or rest.endswith(prefix):
            return rest
    return raw_name


def _parse_pct(text: str) -> float | None:
    if not text.endswith("%"):
        return None
    try:
        return float(text[:-1])
    except ValueError:
        return None


def _find_name_x_max(header_row_words: list[dict]) -> float | None:
    """The header row has 'Player (N)' then 'Pos' then 'Age' etc. The 'Pos'
    header word's x0 marks where the Pos column starts -- name-column words
    are everything left of it. Falls back to DEFAULT_NAME_X_MAX if no
    header row is found on this page (e.g. continuation pages).
    """
    row_sorted = sorted(header_row_words, key=lambda w: w["x0"])
    for i, word in enumerate(row_sorted):
        if word["text"] == "Pos" and i > 0:
            return word["x0"] - 1.0
    return None


def _dominant_size(words: list[dict]) -> float | None:
    """The most common font size among a set of words -- used to identify
    real row text and exclude smaller injury-status captions (e.g.
    "INJURED RESERVE: UNDISCLOSED") that sit close enough vertically to a
    player row to otherwise get absorbed into its name.
    """
    if not words:
        return None
    counts: dict[float, int] = {}
    for w in words:
        size = round(w["size"], 1)
        counts[size] = counts.get(size, 0) + 1
    return max(counts, key=lambda size: counts[size])


def _assemble_stat_rows(body_words: list[dict], name_x_max: float) -> list[dict]:
    """Cluster rank/Pos/Age/CapHit/Pct words into rows (these are always
    single-line, so tight y-tolerance is safe), then separately assemble
    player names -- which can wrap across up to two lines, asymmetrically
    positioned relative to the stat row -- by first grouping name lines
    that are close to each other into a cluster, then assigning each
    cluster to its nearest stat row.
    """
    rank_words = [w for w in body_words if w["x0"] < 60 and w["text"].isdigit()]
    stat_words = [w for w in body_words if w["x0"] >= name_x_max] + rank_words

    # Smaller captions (injury designations, etc.) share x-range with names
    # but render at a distinctly smaller size than the actual row text.
    # Restrict name words to the dominant ("real row") size on this page.
    all_name_candidates = [w for w in body_words if name_x_max > w["x0"] >= 60]
    row_text_size = _dominant_size(rank_words) or _dominant_size(all_name_candidates)
    name_words = [
        w
        for w in all_name_candidates
        if row_text_size is None or abs(w["size"] - row_text_size) < 0.5
    ]

    stat_rows = []
    for row in _cluster_rows(stat_words):
        row_sorted = sorted(row, key=lambda w: w["x0"])
        rank_word = next((w for w in row_sorted if w["x0"] < 60 and w["text"].isdigit()), None)
        if rank_word is None:
            continue
        stat_rows.append({"top": rank_word["top"], "words": row_sorted, "rank_word": rank_word})

    for stat_row in stat_rows:
        stat_row["name_words"] = []

    # Group name-column words into per-line groups (words sharing a `top`
    # within ROW_Y_TOLERANCE), then chain consecutive lines into a single
    # name-cluster whenever they're within NAME_LINE_GAP_MAX of each other.
    # This captures an asymmetric two-line wrap (both lines on the SAME
    # side of the stat anchor) that per-word distance-to-anchor matching
    # would split or drop.
    name_lines = sorted(_cluster_rows(name_words), key=lambda line: line[0]["top"])

    clusters: list[list[dict]] = []
    for line in name_lines:
        line_top = line[0]["top"]
        if clusters and (line_top - clusters[-1][-1]["top"]) <= NAME_LINE_GAP_MAX:
            clusters[-1].extend(line)
        else:
            clusters.append(list(line))

    for cluster in clusters:
        cluster_words = sorted(cluster, key=lambda w: (w["top"], w["x0"]))
        cluster_top = min(w["top"] for w in cluster_words)
        cluster_bottom = max(w["top"] for w in cluster_words)
        nearest = min(
            stat_rows,
            key=lambda r: min(abs(r["top"] - cluster_top), abs(r["top"] - cluster_bottom)),
            default=None,
        )
        if nearest is None:
            continue
        distance = min(abs(nearest["top"] - cluster_top), abs(nearest["top"] - cluster_bottom))
        if distance <= NAME_Y_TOLERANCE:
            nearest["name_words"].extend(cluster_words)

    for stat_row in stat_rows:
        stat_row["name_words"].sort(key=lambda w: (w["top"], w["x0"]))

    return stat_rows


def _extract_stat_fields(row_sorted: list[dict], rank_word: dict) -> tuple[dict, dict, dict, dict] | None:
    """Identify Pos/Age/CapHit/Pct among the row's stat words by value
    shape and left-to-right order, since their x-positions shift per file.
    """
    candidates = [w for w in row_sorted if w is not rank_word]

    pos_word = next((w for w in candidates if POS_RE.match(w["text"])), None)
    cap_hit_word = next((w for w in candidates if CAP_HIT_RE.match(w["text"])), None)
    pct_word = next((w for w in candidates if CAP_HIT_PCT_RE.match(w["text"])), None)

    if not (pos_word and cap_hit_word and pct_word):
        return None

    # Age is the plain 1-2 digit number sitting between Pos and Cap Hit.
    age_word = next(
        (
            w
            for w in candidates
            if w["text"].isdigit()
            and len(w["text"]) <= 2
            and pos_word["x0"] < w["x0"] < cap_hit_word["x0"]
        ),
        None,
    )
    if age_word is None:
        return None

    return pos_word, age_word, cap_hit_word, pct_word


def parse_spotrac_pdf(path: Path) -> list[PlayerCapRow]:
    team, season = _team_and_season_from_filename(path)
    results: list[PlayerCapRow] = []
    current_section: str | None = None
    name_x_max = DEFAULT_NAME_X_MAX

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(extra_attrs=["size", "fontname"])

            # Detect section headers on this page: consecutive large-bold
            # words on the same row, forming e.g. "2026 Injured Reserve".
            header_words = [w for w in words if w["size"] >= SECTION_HEADER_SIZE_MIN]
            for row in _cluster_rows(header_words):
                row_sorted = sorted(row, key=lambda w: w["x0"])
                line = " ".join(w["text"] for w in row_sorted)
                match = SECTION_HEADER_RE.match(line)
                if match:
                    current_section = match.group(1)

            non_title_words = [w for w in words if w["size"] < SECTION_HEADER_SIZE_MIN]

            # The "Pos"/"Age"/"Cap Hit"/... column-header row shares body
            # text's font size, so it's identified by content ("Pos" is a
            # column label that never appears as a data value). Recompute
            # the name/stat column boundary whenever a page has one, since
            # it can drift between team PDFs.
            detected = _find_name_x_max(non_title_words)
            if detected is not None:
                name_x_max = detected

            if current_section not in KEPT_SECTIONS:
                continue

            body_words = non_title_words
            for stat_row in _assemble_stat_rows(body_words, name_x_max):
                row_sorted = stat_row["words"]
                rank_word = stat_row["rank_word"]

                fields = _extract_stat_fields(row_sorted, rank_word)
                if fields is None:
                    continue
                pos_word, age_word, cap_hit_word, pct_word = fields

                cap_hit = _parse_money(cap_hit_word["text"])
                cap_hit_pct = _parse_pct(pct_word["text"])
                if cap_hit is None or cap_hit_pct is None or not age_word["text"].isdigit():
                    continue

                name_text = _join_name_words(stat_row["name_words"])
                if not name_text.strip():
                    continue
                player_name = normalize_player_name(name_text)

                results.append(
                    PlayerCapRow(
                        team=team,
                        season=season,
                        section=current_section,
                        rank=int(rank_word["text"]),
                        player=player_name,
                        position=pos_word["text"],
                        age=int(age_word["text"]),
                        cap_hit=cap_hit,
                        cap_hit_pct=cap_hit_pct,
                    )
                )

    return results


def parse_all(cap_dir: Path) -> list[PlayerCapRow]:
    all_rows: list[PlayerCapRow] = []
    for pdf_path in sorted(cap_dir.glob("*.pdf")):
        all_rows.extend(parse_spotrac_pdf(pdf_path))
    return all_rows


if __name__ == "__main__":
    import sys

    cap_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/raw/cap/2026")
    rows = parse_all(cap_dir)
    print(f"parsed {len(rows)} player-season rows from {cap_dir}")
    for row in rows[:10]:
        print(row)
