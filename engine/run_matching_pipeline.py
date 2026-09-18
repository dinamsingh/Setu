"""CLI Runner for SETU Hybrid Matching Pipeline.

Loads P6 Schedule activities and raw field reports from local data files,
executes the hybrid matching engine, writes results to local CSV and JSON,
and prints an explainable evaluation summary.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
from config import settings
from engine.ensemble_matcher import EnsembleMatcher


def load_schedule_activities(csv_path: Path) -> List[Dict[str, str]]:
    """Loads Primavera P6 schedule activities from CSV."""
    if not csv_path.exists():
        raise FileNotFoundError(f"Schedule CSV not found at {csv_path}")
    df = pd.read_csv(csv_path)
    return df.to_dict(orient="records")


def load_field_updates(file_path: Path) -> List[Dict]:
    """Loads raw field updates from Excel or CSV."""
    if not file_path.exists():
        # Fallback to CSV if xlsx doesn't exist
        csv_fallback = file_path.with_suffix(".csv")
        if csv_fallback.exists():
            df = pd.read_csv(csv_fallback)
        else:
            raise FileNotFoundError(f"Field updates file not found at {file_path}")
    else:
        if file_path.suffix.lower() in [".xlsx", ".xls"]:
            df = pd.read_excel(file_path)
        else:
            df = pd.read_csv(file_path)
            
    return df.to_dict(orient="records")


def run_pipeline(
    schedule_path: Path = settings.P6_SCHEDULE_CSV_PATH,
    updates_path: Path = settings.FIELD_UPDATES_XLSX_PATH,
    output_dir: Path = settings.DATA_DIR
) -> List[Dict]:
    """Executes the end-to-end matching pipeline."""
    print("=" * 70)
    print("SETU - Hybrid Matching Pipeline Execution (SIH26122 - Oil India)")
    print("=" * 70)

    # 1. Load Data
    print(f"Loading Primavera P6 activities from: {schedule_path.name}...")
    activities = load_schedule_activities(schedule_path)
    print(f"Loaded {len(activities)} schedule activities across 6 disciplines.")

    print(f"Loading field updates from: {updates_path.name}...")
    field_updates = load_field_updates(updates_path)
    print(f"Loaded {len(field_updates)} field update reports.")

    # 2. Initialize Matcher
    print("\nInitializing EnsembleMatcher (Sentence-Transformers + RapidFuzz + Aliases)...")
    matcher = EnsembleMatcher(activities=activities)

    # 3. Execute Matching
    print(f"Processing {len(field_updates)} field reports...")
    results = []
    for idx, report in enumerate(field_updates, start=1):
        res = matcher.match_single_report(report, top_k=3)
        results.append(res)

    # 4. Save to Local Artifacts (JSON & CSV)
    out_json = output_dir / "matching_results.json"
    out_csv = output_dir / "matching_results.csv"

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved structured JSON results to: {out_json}")

    # Prepare DataFrame for CSV (serialize candidate_matches as JSON string)
    csv_rows = []
    for r in results:
        csv_rows.append({
            "update_id": r["update_id"],
            "reported_date": r["reported_date"],
            "source_type": r["source_type"],
            "field_text": r["field_text"],
            "expanded_text": r["expanded_text"],
            "applied_aliases": ", ".join(r["applied_aliases"]),
            "matched_activity_id": r["matched_activity_id"],
            "top_activity_name": r["top_activity_name"],
            "top_activity_discipline": r["top_activity_discipline"],
            "confidence_score": r["confidence_score"],
            "confidence_level": r["confidence_level"],
            "matched_layer": r["matched_layer"],
            "status": r["status"],
            "planner_remarks": r["planner_remarks"] or "",
            "candidate_matches_json": json.dumps(r["candidate_matches"])
        })
    df_results = pd.DataFrame(csv_rows)
    df_results.to_csv(out_csv, index=False, encoding="utf-8")
    print(f"Saved CSV results to: {out_csv}")

    # 5. Calculate Metrics Summary
    total = len(results)
    high_count = sum(1 for r in results if r["confidence_level"] == "High")
    med_count = sum(1 for r in results if r["confidence_level"] == "Medium")
    low_count = sum(1 for r in results if r["confidence_level"] == "Low")

    print("\n" + "=" * 70)
    print("PIPELINE EXECUTION METRICS SUMMARY")
    print("=" * 70)
    print(f"Total Reports Processed : {total}")
    print(f"High Confidence (>=0.82): {high_count:2d}  ({(high_count/total)*100:5.1f}%) -> Fast-Track Review Queue")
    print(f"Medium Confidence      : {med_count:2d}  ({(med_count/total)*100:5.1f}%) -> Planner Review Queue")
    print(f"Low / Unmatched (<0.55) : {low_count:2d}  ({(low_count/total)*100:5.1f}%) -> Flagged for Review (Never Dropped)")
    print(f"Review Pending Status   : {total:2d}  (100.0%) -> All updates awaiting Planner Action")
    print("=" * 70)

    # 6. Print 5 Representative Match Examples
    print("\nREPRESENTATIVE EXPLAINABLE MATCH EXAMPLES:")
    print("-" * 70)
    
    # Pick 2 High, 2 Medium, 1 Low
    sample_indices = []
    # Find high examples
    for i, r in enumerate(results):
        if r["confidence_level"] == "High" and len(sample_indices) < 2:
            sample_indices.append(i)
    # Find medium examples
    for i, r in enumerate(results):
        if r["confidence_level"] == "Medium" and len(sample_indices) < 4:
            sample_indices.append(i)
    # Find low example
    for i, r in enumerate(results):
        if r["confidence_level"] == "Low" and len(sample_indices) < 5:
            sample_indices.append(i)

    for rank, idx in enumerate(sample_indices, start=1):
        r = results[idx]
        top_cand = r["candidate_matches"][0]
        print(f"\n[Example {rank}] Tier: {r['confidence_level']} | ID: {r['update_id']}")
        print(f"  Field Text  : \"{r['field_text']}\"")
        if r["applied_aliases"]:
            print(f"  Aliases     : {r['applied_aliases']}")
        print(f"  Matched Task: [{r['matched_activity_id']}] {r['top_activity_name']}")
        print(f"  Discipline  : {r['top_activity_discipline']}")
        print(f"  Final Score : {r['confidence_score']:.4f}")
        print(f"  Breakdown   : Semantic={top_cand['semantic_score']:.3f} (x0.55) + Fuzzy={top_cand['fuzzy_score']:.3f} (x0.35) + DiscBoost={top_cand['discipline_boost']:.1f} (x0.10)")
        print(f"  Status      : {r['status']} (Awaiting Planner Review)")

    print("\n" + "=" * 70)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run SETU Hybrid Matching Pipeline")
    parser.add_argument("--schedule", type=Path, default=settings.P6_SCHEDULE_CSV_PATH, help="Path to schedule CSV")
    parser.add_argument("--updates", type=Path, default=settings.FIELD_UPDATES_XLSX_PATH, help="Path to field updates XLSX/CSV")
    parser.add_argument("--output-dir", type=Path, default=settings.DATA_DIR, help="Directory to save output files")
    args = parser.parse_args()

    run_pipeline(
        schedule_path=args.schedule,
        updates_path=args.updates,
        output_dir=args.output_dir
    )
