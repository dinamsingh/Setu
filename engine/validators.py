"""Validation Engine for SETU (Independent Project Controls Layer).

Evaluates whether a proposed schedule activity link is physically,
temporally, and logically plausible before auto-linking.

Core principle: Validation informs and can BLOCK an auto-link suggestion,
but the planner can always override with a mandatory justification.
Validation is an independent signal from similarity confidence and NEVER
mutates confidence_score or confidence_level.
"""

import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from config import settings
from engine.location_extractor import (
    extract_locations,
    check_location_conflicts,
    are_locations_compatible,
    compute_location_match_score,
)


def _parse_date(d: Any) -> Optional[date]:
    """Safely parses date string or date object into date."""
    if not d:
        return None
    if isinstance(d, date):
        return d
    try:
        s = str(d).strip().split("T")[0]
        return date.fromisoformat(s)
    except Exception:
        return None


def validate_date_plausibility(
    report: Dict[str, Any],
    matched_activity: Optional[Dict[str, Any]],
    **kwargs: Any
) -> Dict[str, Any]:
    """
    Check 1: Date Plausibility.
    Compares reported_date against the activity's planned_start_date and planned_finish_date.
    Fails if completion is claimed far before planned start or long after planned finish.
    """
    check_meta = {
        "check": "date_plausibility",
        "name": "Date Plausibility",
    }

    if not matched_activity:
        return {
            **check_meta,
            "outcome": "pass",
            "message": "No activity matched; date plausibility check skipped.",
            "evidence": {}
        }

    rep_date = _parse_date(report.get("reported_date"))
    if not rep_date:
        return {
            **check_meta,
            "outcome": "pass",
            "message": "Report date not specified or invalid; date plausibility check skipped.",
            "evidence": {}
        }
    planned_start = _parse_date(matched_activity.get("planned_start_date"))
    planned_finish = _parse_date(matched_activity.get("planned_finish_date"))

    tol_before = settings.VALIDATION_DATE_TOLERANCE_DAYS_BEFORE
    tol_after = settings.VALIDATION_DATE_TOLERANCE_DAYS_AFTER

    if planned_start and rep_date < (planned_start - timedelta(days=tol_before)):
        days_early = (planned_start - rep_date).days
        return {
            **check_meta,
            "outcome": "fail",
            "message": (
                f"Reported date ({rep_date}) is {days_early} days before planned start date ({planned_start}) "
                f"(tolerance: {tol_before} days). Reporting completion before activity commences is implausible."
            ),
            "evidence": {
                "reported_date": str(rep_date),
                "planned_start_date": str(planned_start),
                "days_early": days_early,
                "tolerance_days_before": tol_before
            }
        }

    if planned_finish and rep_date > (planned_finish + timedelta(days=tol_after)):
        days_late = (rep_date - planned_finish).days
        return {
            **check_meta,
            "outcome": "fail",
            "message": (
                f"Reported date ({rep_date}) is {days_late} days after planned finish date ({planned_finish}) "
                f"(tolerance: {tol_after} days). Activity completion claims far beyond schedule finish require verification."
            ),
            "evidence": {
                "reported_date": str(rep_date),
                "planned_finish_date": str(planned_finish),
                "days_late": days_late,
                "tolerance_days_after": tol_after
            }
        }

    return {
        **check_meta,
        "outcome": "pass",
        "message": f"Reported date ({rep_date}) is within planned execution window ({planned_start} to {planned_finish}).",
        "evidence": {
            "reported_date": str(rep_date),
            "planned_start_date": str(planned_start) if planned_start else None,
            "planned_finish_date": str(planned_finish) if planned_finish else None
        }
    }


def _find_candidate_distinction(name1: str, name2: str) -> str:
    """
    Extracts distinguishing keywords between two candidate names (e.g. Section/Manifold suffix).
    If both candidate names contain identical location tokens, falls through to wording distinction
    to avoid misleading 'Location differences: X vs X' outputs.
    """
    loc_pattern = r"(?i)\b(manifold\s+[a-z0-9]+|section\s+[a-z0-9]+|shed\s+[a-z0-9]+|foundation\s+[a-z0-9]+|feeder\s+[a-z0-9]+|crossing\s+[a-z0-9]+|batch\s+[a-z0-9]+|kp\s+\d+[-–]\d+|kp\s+\d+)\b"
    m1 = set(m.strip().lower() for m in re.findall(loc_pattern, name1))
    m2 = set(m.strip().lower() for m in re.findall(loc_pattern, name2))

    # Only report location differences if tokens actually differ
    if (m1 or m2) and m1 != m2:
        l1_str = ", ".join(sorted(m1)).title() if m1 else "Unspecified"
        l2_str = ", ".join(sorted(m2)).title() if m2 else "Unspecified"
        return f"Location differences: '{l1_str}' vs '{l2_str}'"

    # General word differences
    w1 = set(name1.lower().split())
    w2 = set(name2.lower().split())
    diff = (w1 ^ w2) - {"and", "-", "&", "the", "of"}
    if diff:
        return f"Wording distinction: {', '.join(sorted(diff))}"
    return "Identical task descriptions differing only by identifier"


def _is_same_wbs_family(c1: Dict[str, Any], c2: Dict[str, Any]) -> bool:
    """Checks if two candidates belong to the same WBS family or activity ID prefix."""
    w1 = str(c1.get("wbs_code") or "")
    w2 = str(c2.get("wbs_code") or "")
    if w1 and w2 and "." in w1 and "." in w2:
        if w1.rsplit(".", 1)[0] == w2.rsplit(".", 1)[0]:
            return True

    id1 = str(c1.get("activity_id") or "")
    id2 = str(c2.get("activity_id") or "")
    if id1 and id2 and "-" in id1 and "-" in id2:
        if id1.rsplit("-", 1)[0] == id2.rsplit("-", 1)[0]:
            return True

    return False


def _names_differ_only_by_location(name1: str, name2: str) -> Tuple[bool, Set[str], Set[str]]:
    """Checks if candidate names differ solely by location tokens with matching base task descriptions."""
    l1 = extract_locations(name1)
    l2 = extract_locations(name2)
    if not l1 or not l2 or l1 == l2:
        return False, l1, l2

    base1 = name1
    for tok in sorted(l1, key=len, reverse=True):
        base1 = re.sub(re.escape(tok), "", base1, flags=re.IGNORECASE)
    base2 = name2
    for tok in sorted(l2, key=len, reverse=True):
        base2 = re.sub(re.escape(tok), "", base2, flags=re.IGNORECASE)

    base1 = re.sub(r"[\s\-_]+", " ", base1).strip().lower()
    base2 = re.sub(r"[\s\-_]+", " ", base2).strip().lower()

    w1 = set(base1.split())
    w2 = set(base2.split())
    differ_by_loc = (base1 == base2) or (len(w1 ^ w2) <= 1)
    return differ_by_loc, l1, l2


def _does_report_resolve_location(report: Dict[str, Any], l1: Set[str], l2: Set[str]) -> bool:
    """Returns True if the report explicitly mentions location 1 and does not mention location 2."""
    if not report or not l1:
        return False
    rep_text = f"{report.get('field_text', '')} {str(report.get('site_location', ''))}".lower()
    has_l1 = any(tok in rep_text for tok in l1)
    has_l2 = any(tok in rep_text for tok in l2)
    return has_l1 and not has_l2


def validate_candidate_ambiguity(
    report: Dict[str, Any],
    matched_activity: Optional[Dict[str, Any]],
    candidates: Optional[List[Dict[str, Any]]] = None,
    **kwargs: Any
) -> Dict[str, Any]:
    """
    Check 2: Candidate Ambiguity.
    Calibrated against 40 baseline reports:
    - Default threshold: 0.008 (empirically derived: 88.9% precision against actually wrong matches,
      flagging 22.5% of reports without producing a degenerate 100% block signal).
    - Outcome is 'warn' (never 'fail'/block), reserving hard blocks for implausible dates or conflicting locations.
    - Narrowed trigger: specifically isolates candidates in the same WBS family differing only by location/section
      where the field report does not resolve which location was intended. Ties between materially different
      work descriptions are distinguished with separate messaging.
    """
    check_meta = {
        "check": "candidate_ambiguity",
        "name": "Candidate Ambiguity",
    }

    if not candidates or len(candidates) < 2:
        return {
            **check_meta,
            "outcome": "pass",
            "message": "Candidate match is distinct (runner-up candidates not in contention).",
            "evidence": {}
        }

    c1 = candidates[0]
    c2 = candidates[1]
    s1 = float(c1.get("final_score") or c1.get("combined_score") or c1.get("score") or 0.0)
    s2 = float(c2.get("final_score") or c2.get("combined_score") or c2.get("score") or 0.0)
    margin = round(s1 - s2, 4)
    threshold = settings.VALIDATION_AMBIGUITY_THRESHOLD

    name1 = c1.get("activity_name", "")
    name2 = c2.get("activity_name", "")
    distinction = _find_candidate_distinction(name1, name2)

    evidence = {
        "top1_id": c1.get("activity_id"),
        "top1_name": name1,
        "top1_score": round(s1, 4),
        "top2_id": c2.get("activity_id"),
        "top2_name": name2,
        "top2_score": round(s2, 4),
        "margin": margin,
        "threshold": threshold,
        "distinction": distinction
    }

    same_family = _is_same_wbs_family(c1, c2)
    differ_by_loc, l1, l2 = _names_differ_only_by_location(name1, name2)
    report_resolves = _does_report_resolve_location(report, l1, l2)

    # Case 1: Report explicitly resolved the location distinction
    if report_resolves:
        return {
            **check_meta,
            "outcome": "pass",
            "message": (
                f"Candidate match resolved by report context: field update explicitly confirms "
                f"'{', '.join(sorted(l1)).title()}' over runner-up '{', '.join(sorted(l2)).title()}' (margin {margin:.4f})."
            ),
            "evidence": {**evidence, "resolved_by_report": True}
        }

    # Case 2: Margin is below calibrated threshold
    if margin < threshold:
        if same_family and differ_by_loc:
            return {
                **check_meta,
                "outcome": "warn",
                "message": (
                    f"Location Ambiguity Warning: Top candidates ({c1.get('activity_id')} vs {c2.get('activity_id')}) "
                    f"are sibling activities in the same WBS family differing by location ({distinction}), but field "
                    f"report text does not uniquely resolve location (margin {margin:.4f} < {threshold:.3f}). "
                    "Planner review recommended."
                ),
                "evidence": {**evidence, "ambiguity_type": "wbs_sibling_location", "same_family": True}
            }
        else:
            return {
                **check_meta,
                "outcome": "warn",
                "message": (
                    f"Candidate Ambiguity Warning: Top 2 candidates have close scores within margin "
                    f"{margin:.4f} < {threshold:.3f} ({c1.get('activity_id')} vs {c2.get('activity_id')}). "
                    f"{distinction}. Review recommended."
                ),
                "evidence": {**evidence, "ambiguity_type": "material_work_margin", "same_family": same_family}
            }

    # Case 3: Margin >= threshold and no unresolved location conflict
    return {
        **check_meta,
        "outcome": "pass",
        "message": f"Candidate match is well-separated: margin of {margin:.4f} >= {threshold:.3f} separates top candidate from runner-up.",
        "evidence": evidence
    }


def _extract_location_tokens(text: str) -> Set[str]:
    """Extracts standardized location tokens from a text string."""
    return extract_locations(text)


def validate_location_consistency(
    report: Dict[str, Any],
    matched_activity: Optional[Dict[str, Any]],
    **kwargs: Any
) -> Dict[str, Any]:
    """
    Check 3: Location Consistency.
    Extracts location tokens (e.g. Manifold B, Section A, Shed A, KP 16-30) from the report
    and compares against the matched activity's name and WBS. Conflicting location tokens block the link.
    """
    check_meta = {
        "check": "location_consistency",
        "name": "Location Consistency",
    }

    if not matched_activity:
        return {
            **check_meta,
            "outcome": "pass",
            "message": "No activity matched; location consistency check skipped.",
            "evidence": {}
        }

    rep_text = f"{report.get('site_location', '')} {report.get('field_text', '')}"
    act_text = f"{matched_activity.get('activity_name', '')} {matched_activity.get('wbs_name', '')}"

    rep_locations = extract_locations(rep_text)
    act_locations = extract_locations(act_text)

    conflicts = check_location_conflicts(rep_locations, act_locations)

    if conflicts:
        rep_conf, act_conf = conflicts[0]
        return {
            **check_meta,
            "outcome": "fail",
            "message": (
                f"Location Mismatch: Report references '{rep_conf.title()}' but matched activity is located at '{act_conf.title()}'."
            ),
            "evidence": {
                "report_locations": sorted(list(rep_locations)),
                "activity_locations": sorted(list(act_locations)),
                "conflicts": conflicts
            }
        }

    # Check for verified matching location
    matched_locations = []
    for r_loc in rep_locations:
        for a_loc in act_locations:
            is_match, _ = are_locations_compatible(r_loc, a_loc)
            if is_match:
                matched_locations.append(r_loc.title())

    if matched_locations:
        return {
            **check_meta,
            "outcome": "pass",
            "message": f"Location verified: '{matched_locations[0]}' confirmed across field report and activity name.",
            "evidence": {
                "matched_locations": sorted(list(set(matched_locations)))
            }
        }

    return {
        **check_meta,
        "outcome": "pass",
        "message": "Location consistency check passed (no conflicting facility designations found).",
        "evidence": {
            "report_locations": sorted(list(rep_locations)),
            "activity_locations": sorted(list(act_locations))
        }
    }


def validate_duplicate_detection(
    report: Dict[str, Any],
    matched_activity: Optional[Dict[str, Any]],
    all_reports: Optional[List[Dict[str, Any]]] = None,
    **kwargs: Any
) -> Dict[str, Any]:
    """
    Check 4: Duplicate Detection.
    Detects whether the same activity has already been reported for the same date,
    especially by an already approved report.
    """
    check_meta = {
        "check": "duplicate_detection",
        "name": "Duplicate Detection",
    }

    if not matched_activity or not all_reports:
        return {
            **check_meta,
            "outcome": "pass",
            "message": "No duplicate progress claims detected.",
            "evidence": {}
        }

    current_upd_id = report.get("update_id")
    target_act_id = matched_activity.get("activity_id")
    current_date = _parse_date(report.get("reported_date"))

    approved_duplicates = []
    pending_duplicates = []

    for other in all_reports:
        if other.get("update_id") == current_upd_id:
            continue
        if other.get("matched_activity_id") == target_act_id:
            other_date = _parse_date(other.get("reported_date"))
            if current_date and other_date and current_date == other_date:
                other_status = (other.get("status") or "").lower()
                if other_status in ("approved", "remapped"):
                    approved_duplicates.append(other)
                elif other_status == "pending":
                    pending_duplicates.append(other)

    if approved_duplicates:
        dup = approved_duplicates[0]
        return {
            **check_meta,
            "outcome": "fail",
            "message": (
                f"Duplicate Progress Claim: Activity '{target_act_id}' is already approved for date {current_date} "
                f"in report '{dup.get('update_id')}'."
            ),
            "evidence": {
                "conflicting_update_id": dup.get("update_id"),
                "activity_id": target_act_id,
                "reported_date": str(current_date),
                "conflicting_status": dup.get("status")
            }
        }

    if pending_duplicates:
        dup = pending_duplicates[0]
        return {
            **check_meta,
            "outcome": "warn",
            "message": (
                f"Concurrent Progress Claim: Activity '{target_act_id}' is also claimed on {current_date} "
                f"in pending report '{dup.get('update_id')}'."
            ),
            "evidence": {
                "conflicting_update_id": dup.get("update_id"),
                "activity_id": target_act_id,
                "reported_date": str(current_date),
                "conflicting_status": dup.get("status")
            }
        }

    return {
        **check_meta,
        "outcome": "pass",
        "message": f"No duplicate progress records found for activity '{target_act_id}' on {current_date}.",
        "evidence": {
            "activity_id": target_act_id,
            "reported_date": str(current_date)
        }
    }


def _extract_reporter_discipline(reporter: str) -> Optional[str]:
    """Infers discipline from reporter string (e.g. 'Ramesh Borah (Piping Foreman)')."""
    if not reporter:
        return None
    r = reporter.lower()
    if "piping" in r:
        return "Piping"
    if "pipeline" in r:
        return "Pipeline"
    if "civil" in r:
        return "Civil"
    if "elec" in r or "electrical" in r:
        return "Electrical"
    if "inst" in r or "instrumentation" in r:
        return "Instrumentation"
    if "mech" in r or "mechanical" in r:
        return "Mechanical"
    if "welding" in r:
        return "Piping"
    return None


def validate_reporter_discipline(
    report: Dict[str, Any],
    matched_activity: Optional[Dict[str, Any]],
    **kwargs: Any
) -> Dict[str, Any]:
    """
    Check 5: Reporter Discipline Consistency.
    Flags cross-discipline reporting as a warning (e.g. Civil foreman reporting electrical work).
    """
    check_meta = {
        "check": "reporter_discipline",
        "name": "Reporter Discipline Consistency",
    }

    if not matched_activity:
        return {
            **check_meta,
            "outcome": "pass",
            "message": "No activity matched; reporter discipline check skipped.",
            "evidence": {}
        }

    reporter = report.get("reported_by", "")
    reporter_disc = _extract_reporter_discipline(reporter)
    activity_disc = matched_activity.get("discipline")

    if reporter_disc and activity_disc and reporter_disc.lower() != activity_disc.lower():
        # Cross-discipline is a warning, not a hard block
        return {
            **check_meta,
            "outcome": "warn",
            "message": (
                f"Cross-Discipline Report: Reporter discipline is '{reporter_disc}' ('{reporter}'), "
                f"while matched activity belongs to '{activity_disc}' discipline."
            ),
            "evidence": {
                "reported_by": reporter,
                "inferred_reporter_discipline": reporter_disc,
                "activity_discipline": activity_disc
            }
        }

    return {
        **check_meta,
        "outcome": "pass",
        "message": f"Reporter discipline aligns with activity discipline ({activity_disc or 'General'}).",
        "evidence": {
            "reported_by": reporter,
            "activity_discipline": activity_disc
        }
    }


def validate_sequence_plausibility(
    report: Dict[str, Any],
    matched_activity: Optional[Dict[str, Any]],
    all_activities: Optional[List[Dict[str, Any]]] = None,
    all_reports: Optional[List[Dict[str, Any]]] = None,
    **kwargs: Any
) -> Dict[str, Any]:
    """
    Check 6: Sequence Plausibility (Soft Warning).
    Derives soft ordering within the same wbs_code using planned_start_date.
    Warns if an earlier-planned sibling activity in the same WBS has zero recorded progress.
    Heuristic derived from planned dates, not real Primavera logic links.
    """
    check_meta = {
        "check": "sequence_plausibility",
        "name": "Sequence Plausibility (Soft Heuristic)",
    }

    if not matched_activity or not all_activities:
        return {
            **check_meta,
            "outcome": "pass",
            "message": "Sequence plausibility check skipped (insufficient activity data).",
            "evidence": {}
        }

    act_wbs = matched_activity.get("wbs_code")
    act_id = matched_activity.get("activity_id")
    act_start = _parse_date(matched_activity.get("planned_start_date"))

    if not act_wbs or not act_start:
        return {
            **check_meta,
            "outcome": "pass",
            "message": "No planned start date or WBS code found for sequence validation.",
            "evidence": {}
        }

    # Find siblings in same WBS scheduled earlier
    siblings = [
        a for a in all_activities
        if a.get("wbs_code") == act_wbs and a.get("activity_id") != act_id
    ]

    earlier_unstarted = []
    for sib in siblings:
        sib_start = _parse_date(sib.get("planned_start_date"))
        if sib_start and sib_start < act_start:
            progress = float(sib.get("planned_progress_pct") or 0.0)
            # Check if any reports in all_reports claim progress on this sibling
            has_reports = False
            if all_reports:
                has_reports = any(
                    r.get("matched_activity_id") == sib.get("activity_id") and
                    (r.get("status") in ("approved", "remapped") or r.get("confidence_level") in ("High", "Medium"))
                    for r in all_reports
                )
            if progress == 0.0 and not has_reports:
                earlier_unstarted.append(sib)

    if earlier_unstarted:
        sib = earlier_unstarted[0]
        return {
            **check_meta,
            "outcome": "warn",
            "message": (
                f"Sequence Warning: Earlier-planned sibling activity '{sib.get('activity_id')}' "
                f"('{sib.get('activity_name')}') in WBS {act_wbs} has zero recorded progress. "
                "(Soft heuristic derived from planned start dates; not Primavera predecessor links)."
            ),
            "evidence": {
                "wbs_code": act_wbs,
                "current_activity_id": act_id,
                "current_planned_start": str(act_start),
                "earlier_sibling_id": sib.get("activity_id"),
                "earlier_sibling_name": sib.get("activity_name"),
                "earlier_planned_start": str(_parse_date(sib.get("planned_start_date"))),
                "heuristic_note": "Derived from planned dates; dataset has no native P6 predecessor links."
            }
        }

    return {
        **check_meta,
        "outcome": "pass",
        "message": f"WBS {act_wbs} activity execution order plausible according to planned schedule dates.",
        "evidence": {
            "wbs_code": act_wbs,
            "current_activity_id": act_id,
            "current_planned_start": str(act_start)
        }
    }


def validate_report_matching(
    report: Dict[str, Any],
    matched_activity: Optional[Dict[str, Any]],
    candidates: Optional[List[Dict[str, Any]]] = None,
    all_reports: Optional[List[Dict[str, Any]]] = None,
    all_activities: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Executes all 6 validation checks and aggregates overall validation_status:
    - Any check fails ('fail') -> 'block'
    - No fail but any warning ('warn') -> 'warn'
    - All pass -> 'pass'
    """
    results: List[Dict[str, Any]] = [
        validate_date_plausibility(report, matched_activity),
        validate_candidate_ambiguity(report, matched_activity, candidates=candidates),
        validate_location_consistency(report, matched_activity),
        validate_duplicate_detection(report, matched_activity, all_reports=all_reports),
        validate_reporter_discipline(report, matched_activity),
        validate_sequence_plausibility(
            report,
            matched_activity,
            all_activities=all_activities,
            all_reports=all_reports
        ),
    ]

    has_fail = any(r["outcome"] == "fail" for r in results)
    has_warn = any(r["outcome"] == "warn" for r in results)

    if has_fail:
        status = "block"
    elif has_warn:
        status = "warn"
    else:
        status = "pass"

    return {
        "status": status,
        "results": results,
    }
