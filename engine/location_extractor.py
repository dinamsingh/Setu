"""Canonical Location Extractor for SETU Matching Engine and Validation Layer.

PS SIH26122 - Oil India Limited (SIH 2026).
Consolidates location and section token extraction, range normalization, and compatibility checking
across schedule activities (P6) and noisy field progress reports.
"""

import re
from typing import Dict, List, Optional, Set, Tuple, Any


def _normalize_kp_range(start: int, end: int) -> str:
    low = min(start, end)
    high = max(start, end)
    return f"kp {low}-{high}"


def extract_locations(text: str) -> Set[str]:
    """
    Extracts canonical normalized location tokens from raw text.
    Handles facility designations, buildings, pipeline KPs and chainages.
    """
    if not text:
        return set()

    text_lower = " " + text.lower() + " "
    tokens = set()

    # 1. KPs with range: e.g. "KP 16 to 30", "KP 16-31", "KP 16–31", "KP 31 to 45"
    kp_range_pattern = r"\bkp\s*(\d+)\s*(?:to|[-–])\s*(\d+)\b"
    for m in re.finditer(kp_range_pattern, text_lower):
        tokens.add(_normalize_kp_range(int(m.group(1)), int(m.group(2))))

    # 2. Single KPs: e.g. "KP 22" (avoid matching if already part of a range)
    single_kp_pattern = r"\bkp\s*(\d+)\b(?!\s*(?:to|[-–])\s*\d+)"
    for m in re.finditer(single_kp_pattern, text_lower):
        val = int(m.group(1))
        # Only add if not covered by an existing range token
        already_covered = any(
            t.startswith("kp ") and "-" in t and int(t.split()[1].split("-")[0]) <= val <= int(t.split()[1].split("-")[1])
            for t in tokens
        )
        if not already_covered:
            tokens.add(f"kp {val}")

    # 3. Chainages: e.g. "Chainage 12", "Chainage 0-15"
    chainage_range = r"\bchainage\s*(\d+)\s*(?:to|[-–])\s*(\d+)\b"
    for m in re.finditer(chainage_range, text_lower):
        low = min(int(m.group(1)), int(m.group(2)))
        high = max(int(m.group(1)), int(m.group(2)))
        tokens.add(f"chainage {low}-{high}")

    chainage_single = r"\bchainage\s*(\d+)\b(?!\s*(?:to|[-–])\s*\d+)"
    for m in re.finditer(chainage_single, text_lower):
        tokens.add(f"chainage {int(m.group(1))}")

    # 4. Standard letter-designated facilities: e.g. Manifold A, Shed B, Section C
    cat_pattern = (
        r"\b("
        r"manifold(?:\s+area)?|"
        r"section|"
        r"(?:compressor\s+|pump\s+)?shed|"
        r"(?:compressor\s+)?foundation|"
        r"area|"
        r"station|"
        r"(?:main\s+|grid\s+)?substation|"
        r"(?:substation\s+)?feeder|"
        r"(?:crude\s+)?tank(?:\s+dyke)?|"
        r"dyke|"
        r"loop|"
        r"skid|"
        r"rack|"
        r"batch|"
        r"(?:river\s+)?crossing|"
        r"block|"
        r"shelter"
        r")\s+([a-d0-9])\b"
    )
    for m in re.finditer(cat_pattern, text_lower):
        raw_cat = m.group(1).strip()
        letter = m.group(2).strip()
        if "manifold" in raw_cat:
            tokens.add(f"manifold {letter}")
        elif "section" in raw_cat:
            tokens.add(f"section {letter}")
        elif "shed" in raw_cat:
            tokens.add(f"shed {letter}")
        elif "foundation" in raw_cat:
            tokens.add(f"foundation {letter}")
        elif "substation" in raw_cat:
            tokens.add(f"substation {letter}")
        elif "feeder" in raw_cat:
            tokens.add(f"feeder {letter}")
        elif "tank" in raw_cat or "dyke" in raw_cat:
            tokens.add(f"tank {letter}")
        elif "crossing" in raw_cat:
            tokens.add(f"crossing {letter}")
        elif "area" in raw_cat:
            tokens.add(f"area {letter}")
        elif "station" in raw_cat:
            tokens.add(f"station {letter}")
        elif "loop" in raw_cat:
            tokens.add(f"loop {letter}")
        elif "skid" in raw_cat:
            tokens.add(f"skid {letter}")
        elif "rack" in raw_cat:
            tokens.add(f"rack {letter}")
        elif "batch" in raw_cat:
            tokens.add(f"batch {letter}")
        elif "block" in raw_cat:
            tokens.add(f"block {letter}")
        elif "shelter" in raw_cat:
            tokens.add(f"shelter {letter}")

    # 5. Fixed specific locations
    if "admin" in text_lower and "building" in text_lower:
        tokens.add("admin building")
    if "duliajan" in text_lower:
        tokens.add("duliajan")

    return tokens


def _parse_kp_range(token: str) -> Optional[Tuple[int, int]]:
    """Parses a KP or chainage token into an integer interval [low, high]."""
    if token.startswith("kp ") or token.startswith("chainage "):
        parts = token.split()[1].split("-")
        if len(parts) == 2:
            return (int(parts[0]), int(parts[1]))
        elif len(parts) == 1:
            val = int(parts[0])
            return (val, val)
    return None


def are_locations_compatible(loc1: str, loc2: str) -> Tuple[bool, bool]:
    """
    Compares two location tokens.
    Returns (is_match, is_conflict).
    - If they match exactly or overlap (e.g. KP 16-30 inside KP 16-31): (True, False)
    - If they share the same facility category but differ (e.g. Shed A vs Shed B): (False, True)
    - If they represent unrelated categories (e.g. Section B vs Shed A): (False, False)
    """
    if loc1 == loc2:
        return True, False

    # Check KP / Chainage interval overlap
    kp1 = _parse_kp_range(loc1)
    kp2 = _parse_kp_range(loc2)
    if kp1 and kp2:
        overlaps = max(kp1[0], kp2[0]) <= min(kp1[1], kp2[1])
        if overlaps:
            return True, False
        else:
            return False, True

    # Check categorical conflict (e.g. "shed a" vs "shed b")
    parts1 = loc1.split()
    parts2 = loc2.split()
    if len(parts1) == 2 and len(parts2) == 2:
        if parts1[0] == parts2[0]:
            if parts1[1] == parts2[1]:
                return True, False
            else:
                return False, True

    return False, False


def check_location_conflicts(report_locs: Set[str], activity_locs: Set[str]) -> List[Tuple[str, str]]:
    """Returns a list of conflicting location token pairs between report and activity."""
    conflicts = []
    for r_loc in report_locs:
        for a_loc in activity_locs:
            is_match, is_conflict = are_locations_compatible(r_loc, a_loc)
            if is_conflict:
                conflicts.append((r_loc, a_loc))
    return conflicts


def compute_location_match_score(report_locs: Set[str], activity_locs: Set[str]) -> float:
    """
    Computes a normalized location score in [0.0, 1.0] for EnsembleMatcher:
    - 1.0 if activity has no identifiable location (unconstrained activity, don't penalize)
    - 0.5 if report has no identifiable location (neutral)
    - 1.0 if any extracted location matches exactly or overlaps
    - 0.0 if both have locations and any direct contradiction exists (e.g. Shed A vs Shed B)
    - 0.5 if locations are non-conflicting but distinct categories
    """
    if not activity_locs:
        return 1.0

    if not report_locs:
        return 0.5

    # Check for direct conflicts
    conflicts = check_location_conflicts(report_locs, activity_locs)
    if conflicts:
        return 0.0

    # Check for matches
    for r_loc in report_locs:
        for a_loc in activity_locs:
            is_match, _ = are_locations_compatible(r_loc, a_loc)
            if is_match:
                return 1.0

    # Neutral fallback (non-conflicting disjoint facilities)
    return 0.5
