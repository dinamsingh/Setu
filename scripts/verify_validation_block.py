#!/usr/bin/env python3
"""Phase 2 & 3 Verification Script: 6-Check Validation Layer and Planner Override.

PS SIH26122 - Oil India Limited (SIH 2026).
Demonstrates:
  (1) Plausible report passes all checks (validation_status = 'pass').
  (2) Implausible date (>60d late) triggers hard failure (validation_status = 'block').
  (3) Conflicting location (e.g. Manifold D vs Manifold A) triggers hard failure (validation_status = 'block').
  (4) Unresolved sibling ambiguity triggers calibrated warning (validation_status = 'warn').
  (5) Planner override: Blocked link cannot be approved without justification;
      providing justification successfully records an audit trail and executes override.

Usage:
    python scripts/verify_validation_block.py
"""

import sys
from pathlib import Path

# Add project root to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from config import settings
from database.supabase_client import (
    LocalMockDatabase,
    override_field_update_validation,
    fetch_planner_audit_logs,
)
from engine.validators import (
    validate_report_matching,
    validate_date_plausibility,
    validate_location_consistency,
    validate_candidate_ambiguity,
)


def main():
    test_storage = settings.DATA_DIR / "verify_validation_mock.json"
    if test_storage.exists():
        test_storage.unlink()

    client = LocalMockDatabase(test_storage)

    print("\n" + "=" * 78)
    print("  SETU EVIDENCE DEMO: VALIDATION LAYER & PLANNER OVERRIDE (PHASES 2 & 3)")
    print("=" * 78)

    # 1. Clean plausible report
    print("\n[SCENARIO 1] Clean Plausible Progress Report...")
    clean_report = {
        "update_id": "UPD-CLEAN-001",
        "reported_date": "2026-04-20",
        "field_text": "Spool erection and field fit-up finished at Manifold A",
        "site_location": "Manifold A Area",
        "reported_by": "Ramesh Borah (Piping Foreman)",
    }
    clean_activity = {
        "activity_id": "OIL-PIP-202-A",
        "activity_name": "Piping Spool Erection and Field Fit-up - Manifold A",
        "wbs_code": "1.2.1.1",
        "discipline": "Piping",
        "planned_start_date": "2026-04-10",
        "planned_finish_date": "2026-05-10",
    }
    res_clean = validate_report_matching(
        report=clean_report,
        matched_activity=clean_activity,
        candidates=[{"activity_id": "OIL-PIP-202-A", "activity_name": clean_activity["activity_name"], "final_score": 0.88}],
    )
    print(f"  Validation Status: '{res_clean['status']}'")
    assert res_clean["status"] == "pass", f"Expected pass, got {res_clean['status']}"

    # 2. Implausible Date (Block)
    print("\n[SCENARIO 2] Impossible Execution Date (>60 Days Past Finish)...")
    date_late_report = {
        "update_id": "UPD-DATE-001",
        "reported_date": "2026-09-15",  # ~4 months after planned finish
        "field_text": "Piping fit-up at Manifold A",
    }
    res_date = validate_date_plausibility(date_late_report, clean_activity)
    print(f"  Check: {res_date['check']} | Outcome: '{res_date['outcome']}'")
    print(f"  Evidence: {res_date['message']}")
    assert res_date["outcome"] == "fail", f"Expected fail, got {res_date['outcome']}"

    # 3. Conflicting Location (Block)
    print("\n[SCENARIO 3] Conflicting Location (Manifold D reported for Manifold A activity)...")
    loc_conflict_report = {
        "update_id": "UPD-LOC-001",
        "field_text": "Spool erection completed at Manifold D today",
        "site_location": "Manifold D Header",
    }
    res_loc = validate_location_consistency(loc_conflict_report, clean_activity)
    print(f"  Check: {res_loc['check']} | Outcome: '{res_loc['outcome']}'")
    print(f"  Evidence: {res_loc['message']}")
    assert res_loc["outcome"] == "fail", f"Expected fail, got {res_loc['outcome']}"

    # 4. Calibrated Ambiguity Warning (Warn, Not Block)
    print("\n[SCENARIO 4] Candidate Ambiguity Check (Calibrated to Warn, Not Block)...")
    cands_ambiguous = [
        {"activity_id": "OIL-PIP-202-A", "activity_name": "Piping Spool Erection - Manifold A", "wbs_code": "1.2.1.1", "final_score": 0.8805},
        {"activity_id": "OIL-PIP-202-D", "activity_name": "Piping Spool Erection - Manifold D", "wbs_code": "1.2.1.4", "final_score": 0.8800},
    ]
    unresolved_report = {
        "update_id": "UPD-AMB-001",
        "field_text": "Spool erection and field fit-up finished today",  # No location mentioned
    }
    res_amb = validate_candidate_ambiguity(unresolved_report, clean_activity, candidates=cands_ambiguous)
    print(f"  Check: {res_amb['check']} | Outcome: '{res_amb['outcome']}'")
    print(f"  Evidence: {res_amb['message']}")
    assert res_amb["outcome"] == "warn", f"Expected warn, got {res_amb['outcome']}"

    # 5. Planner Override Workflow
    print("\n[SCENARIO 5] Planner Override Workflow with Mandatory Justification...")
    # Insert a blocked report into database
    blocked_row = {
        "update_id": "UPD-BLOCK-001",
        "field_text": loc_conflict_report["field_text"],
        "status": "pending",
        "confidence_level": "High",
        "confidence_score": 0.88,
        "matched_activity_id": "OIL-PIP-202-A",
        "validation_status": "block",
        "validation_flags": [res_loc],
    }
    client.table("field_updates").insert([blocked_row]).execute()

    # Attempt override without justification -> Must fail
    try:
        override_field_update_validation(
            client=client,
            update_id="UPD-BLOCK-001",
            planner_name="Planner-1",
            reason="   ",  # Missing justification
        )
        assert False, "Should have rejected empty justification!"
    except ValueError as e:
        print(f"  Correctly rejected empty justification: '{e}'")

    # Submit valid override with justification
    reason_text = "Verified site diary: work physically occurred at Manifold D; confirmed by Site Superintendent."
    override_res = override_field_update_validation(
        client=client,
        update_id="UPD-BLOCK-001",
        planner_name="Lead-Planner-Gogoi",
        reason=reason_text,
    )
    print(f"  Override Execution: Overridden = {override_res.get('validation_overridden')} | Reason = '{override_res.get('override_reason')}'")

    # Check audit log entry
    audit_logs = fetch_planner_audit_logs(client, update_id="UPD-BLOCK-001")
    assert len(audit_logs) >= 1
    override_log = [l for l in audit_logs if l["action"] == "override"]
    assert len(override_log) == 1
    entry = override_log[0]
    print(f"  Audit Log ID: {entry.get('id')} | Action: '{entry.get('action')}' | Planner: '{entry.get('planner_name')}'")
    print(f"  Audit Log Remarks: '{entry.get('remarks')}'")

    assert override_res.get("validation_overridden") is True
    assert entry.get("remarks") == reason_text

    print("\n" + "=" * 78)
    print("  [SUCCESS] VALIDATION LAYER & PLANNER OVERRIDE FULLY VERIFIED!")
    print("=" * 78 + "\n")

    if test_storage.exists():
        test_storage.unlink()


if __name__ == "__main__":
    main()
