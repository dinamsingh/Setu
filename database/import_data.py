"""Data Ingestion Script for Supabase Database.

Imports Primavera P6 schedule activities (with dense embeddings), domain aliases,
and raw field update reports into Supabase tables using idempotent upserts.
"""

import json
import sys
from pathlib import Path
import pandas as pd

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import settings
from database.supabase_client import (
    get_supabase_client,
    upsert_schedule_activities,
    upsert_domain_aliases,
    upsert_raw_field_updates,
    get_table_counts
)
from engine.embeddings import EmbeddingMatcher


def import_schedule_activities(client, csv_path: Path = settings.P6_SCHEDULE_CSV_PATH) -> int:
    """Reads schedule CSV, generates embeddings, and upserts into schedule_activities."""
    print(f"Reading schedule activities from {csv_path.name}...")
    df = pd.read_csv(csv_path)
    records = df.to_dict(orient="records")

    print(f"Generating dense vector embeddings for {len(records)} activities using all-MiniLM-L6-v2...")
    matcher = EmbeddingMatcher()
    embeddings = matcher.precompute_schedule_embeddings(records)

    # Attach embedding lists to records for vector(384) storage
    activities_payload = []
    for idx, r in enumerate(records):
        activities_payload.append({
            "activity_id": str(r["activity_id"]),
            "activity_name": str(r["activity_name"]),
            "wbs_code": str(r["wbs_code"]),
            "wbs_name": str(r.get("wbs_name", "")),
            "discipline": str(r["discipline"]),
            "planned_start_date": str(r["planned_start_date"]),
            "planned_finish_date": str(r["planned_finish_date"]),
            "planned_progress_pct": float(r.get("planned_progress_pct", 0.0)),
            "unit_of_measure": str(r.get("unit_of_measure", "MTR")),
            "planned_qty": float(r.get("planned_qty", 0.0)),
            "embedding": embeddings[idx].tolist()  # 384 float numbers
        })

    upserted_count = upsert_schedule_activities(client, activities_payload, batch_size=50)
    print(f"Successfully upserted {upserted_count} activities into 'schedule_activities'.")
    return upserted_count


def import_domain_aliases(client, json_path: Path = settings.DOMAIN_ALIASES_PATH) -> int:
    """Reads domain aliases JSON and upserts into domain_aliases."""
    print(f"Reading domain aliases from {json_path.name}...")
    with open(json_path, "r", encoding="utf-8") as f:
        aliases = json.load(f)

    payload = []
    for item in aliases:
        payload.append({
            "field_term": item["field_term"],
            "standard_term": item["standard_term"],
            "discipline": item.get("discipline")
        })

    upserted_count = upsert_domain_aliases(client, payload)
    print(f"Successfully upserted {upserted_count} aliases into 'domain_aliases'.")
    return upserted_count


def import_raw_field_updates(client, file_path: Path = settings.FIELD_UPDATES_XLSX_PATH) -> int:
    """
    Reads field reports (Excel/CSV) and inserts ONLY raw input fields.
    Does NOT use ground-truth benchmark labels for matching.
    Preserves existing match results if records already exist.
    """
    print(f"Reading raw field updates from {file_path.name}...")
    if file_path.suffix.lower() in [".xlsx", ".xls"] and file_path.exists():
        df = pd.read_excel(file_path)
    else:
        csv_path = file_path.with_suffix(".csv")
        df = pd.read_csv(csv_path)

    existing_updates = {
        u.get("update_id"): u
        for u in client.table("field_updates").select("*").execute().data
    }

    raw_payload = []
    for _, row in df.iterrows():
        uid = str(row["update_id"])
        existing = existing_updates.get(uid)

        base_record = {
            "update_id": uid,
            "source_type": str(row.get("source_type", "text")),
            "field_text": str(row["field_text"]),
            "site_location": str(row.get("site_location", "")),
            "reported_by": str(row.get("reported_by", "")),
            "reported_date": str(row.get("reported_date", "")),
        }

        # If record already exists with matching results, preserve them!
        if existing and existing.get("confidence_level") in ["High", "Medium", "Low"]:
            base_record.update({
                "status": existing.get("status", "pending"),
                "confidence_level": existing.get("confidence_level"),
                "confidence_score": existing.get("confidence_score"),
                "matched_activity_id": existing.get("matched_activity_id"),
                "expanded_text": existing.get("expanded_text"),
                "matched_layer": existing.get("matched_layer"),
                "candidate_matches": existing.get("candidate_matches", [])
            })
        else:
            base_record.update({
                "status": "pending",
                "confidence_level": "Pending",
                "confidence_score": 0.0,
                "matched_activity_id": None,
                "expanded_text": None,
                "matched_layer": None,
                "candidate_matches": []
            })

        raw_payload.append(base_record)

    upserted_count = upsert_raw_field_updates(client, raw_payload, batch_size=50)
    print(f"Successfully upserted {upserted_count} raw field updates into 'field_updates'.")
    return upserted_count


def run_all_imports():
    """Executes all imports idempotently."""
    print("=" * 65)
    print("SETU - Supabase Database Ingestion")
    print("=" * 65)

    client = get_supabase_client()
    import_schedule_activities(client)
    import_domain_aliases(client)
    import_raw_field_updates(client)

    counts = get_table_counts(client)
    print("\nDatabase Table Counts Post-Import:")
    for tbl, cnt in counts.items():
        print(f"  - {tbl:22s}: {cnt:4d} rows")
    print("=" * 65)


if __name__ == "__main__":
    run_all_imports()
