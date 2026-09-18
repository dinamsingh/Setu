"""Supabase Client and Database Access Layer for SETU.

Handles connection to Supabase PostgreSQL (or local mock persistence),
providing robust, separated CRUD methods for schedule_activities, domain_aliases,
field_updates, and planner_audit_logs.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import settings


# ---------------------------------------------------------------------------
# Local Mock Persistence (Ensures fail-proof hackathon demos and offline testing)
# ---------------------------------------------------------------------------

class LocalMockQueryBuilder:
    """Emulates Supabase Postgrest chained query builder for local execution."""

    def __init__(self, table_name: str, db: "LocalMockDatabase"):
        self.table_name = table_name
        self.db = db
        self._select_cols = "*"
        self._filters = []
        self._action = "select"
        self._payload = None
        self._on_conflict = None

    def select(self, columns: str = "*"):
        self._select_cols = columns
        self._action = "select"
        return self

    def insert(self, data: Any):
        self._payload = data if isinstance(data, list) else [data]
        self._action = "insert"
        return self

    def upsert(self, data: Any, on_conflict: Optional[str] = None):
        self._payload = data if isinstance(data, list) else [data]
        self._on_conflict = on_conflict
        self._action = "upsert"
        return self

    def update(self, data: Dict):
        self._payload = data
        self._action = "update"
        return self

    def delete(self):
        self._action = "delete"
        return self

    def eq(self, column: str, value: Any):
        self._filters.append((column, "eq", value))
        return self

    def neq(self, column: str, value: Any):
        self._filters.append((column, "neq", value))
        return self

    def execute(self) -> "LocalMockResponse":
        rows = self.db.get_table(self.table_name)

        if self._action == "select":
            filtered = rows
            for col, op, val in self._filters:
                if op == "eq":
                    filtered = [r for r in filtered if r.get(col) == val]
                elif op == "neq":
                    filtered = [r for r in filtered if r.get(col) != val]
            return LocalMockResponse(filtered)

        elif self._action == "insert":
            import uuid
            for item in self._payload:
                if "id" not in item:
                    int_ids = [r.get("id") for r in rows if isinstance(r.get("id"), int)]
                    if int_ids or self.table_name == "domain_aliases":
                        item["id"] = max(int_ids or [0]) + 1
                    else:
                        item["id"] = str(uuid.uuid4())
                rows.append(item)
            self.db.save()
            return LocalMockResponse(self._payload)

        elif self._action == "upsert":
            conflict_col = self._on_conflict or "id"
            for item in self._payload:
                conflict_val = item.get(conflict_col)
                existing_idx = None
                for idx, r in enumerate(rows):
                    if r.get(conflict_col) == conflict_val:
                        existing_idx = idx
                        break
                if existing_idx is not None:
                    rows[existing_idx].update(item)
                else:
                    rows.append(item)
            self.db.save()
            return LocalMockResponse(self._payload)

        elif self._action == "update":
            updated = []
            for r in rows:
                match = True
                for col, op, val in self._filters:
                    if op == "eq" and r.get(col) != val:
                        match = False
                        break
                if match:
                    r.update(self._payload)
                    updated.append(r)
            self.db.save()
            return LocalMockResponse(updated)

        elif self._action == "delete":
            kept = []
            deleted = []
            for r in rows:
                match = True
                for col, op, val in self._filters:
                    if op == "eq" and r.get(col) != val:
                        match = False
                        break
                if match:
                    deleted.append(r)
                else:
                    kept.append(r)
            self.db.set_table(self.table_name, kept)
            self.db.save()
            return LocalMockResponse(deleted)

        return LocalMockResponse([])


class LocalMockResponse:
    def __init__(self, data: List[Dict]):
        self.data = data


class LocalMockDatabase:
    """In-memory & JSON file backed storage mimicking Supabase tables."""

    def __init__(self, storage_file: Path):
        self.storage_file = storage_file
        self.tables: Dict[str, List[Dict]] = {
            "schedule_activities": [],
            "domain_aliases": [],
            "field_updates": [],
            "planner_audit_logs": []
        }
        self.load()

    def load(self):
        if self.storage_file.exists():
            try:
                with open(self.storage_file, "r", encoding="utf-8") as f:
                    self.tables = json.load(f)
                # Ensure backward-compatible defaults for domain_aliases
                for idx, al in enumerate(self.tables.get("domain_aliases", [])):
                    al.setdefault("id", idx + 1)
                    al.setdefault("status", "verified")
                    al.setdefault("origin", "seed")
            except Exception:
                pass

    def save(self):
        self.storage_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.storage_file, "w", encoding="utf-8") as f:
            json.dump(self.tables, f, indent=2)

    def get_table(self, name: str) -> List[Dict]:
        self.load()
        return self.tables.setdefault(name, [])

    def set_table(self, name: str, rows: List[Dict]):
        self.tables[name] = rows

    def table(self, table_name: str) -> LocalMockQueryBuilder:
        return LocalMockQueryBuilder(table_name, self)


# ---------------------------------------------------------------------------
# Supabase Client Factory
# ---------------------------------------------------------------------------

_mock_db_instance: Optional[LocalMockDatabase] = None


def get_database_mode() -> str:
    """Returns a readable string representing current database mode."""
    if settings.USE_LOCAL_MOCK_DB:
        return "Local Mock / JSON Storage (data/local_supabase_mock.json)"
    project_ref = settings.SUPABASE_URL.replace("https://", "").split(".")[0]
    return f"Supabase REST API (Live Cloud Project: {project_ref})"


def get_supabase_client(require_remote: bool = False) -> Any:
    """
    Returns an active Supabase client.
    When USE_LOCAL_MOCK_DB=False, strictly connects to live Supabase project
    and fails loudly if credentials are missing or invalid.
    """
    global _mock_db_instance

    url = settings.SUPABASE_URL.strip()
    key = (settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY).strip()

    if not settings.USE_LOCAL_MOCK_DB or require_remote:
        if not url or not key or url.startswith("https://your-project-id"):
            raise ValueError(
                "Missing or unconfigured Supabase credentials in .env!\n"
                "Please configure valid SUPABASE_URL and SUPABASE_ANON_KEY in your .env file."
            )
        from supabase import create_client
        return create_client(url, key)

    # Use local mock database ONLY if explicitly enabled via USE_LOCAL_MOCK_DB=True
    if _mock_db_instance is None:
        mock_file = settings.DATA_DIR / "local_supabase_mock.json"
        _mock_db_instance = LocalMockDatabase(mock_file)

    return _mock_db_instance


# ---------------------------------------------------------------------------
# Modular Database Access Functions (Kept separate from matching logic)
# ---------------------------------------------------------------------------

def get_table_counts(client: Any) -> Dict[str, int]:
    """Returns row counts for all four primary tables."""
    counts = {}
    for table_name in ["schedule_activities", "domain_aliases", "field_updates", "planner_audit_logs"]:
        res = client.table(table_name).select("*").execute()
        counts[table_name] = len(res.data) if res.data else 0
    return counts


def fetch_schedule_activities(client: Any) -> List[Dict]:
    """Fetches all Primavera P6 schedule activities."""
    res = client.table("schedule_activities").select("*").execute()
    return res.data or []


def upsert_schedule_activities(client: Any, activities: List[Dict], batch_size: int = 50) -> int:
    """Upserts schedule activities in batches based on activity_id."""
    total_upserted = 0
    for i in range(0, len(activities), batch_size):
        batch = activities[i:i + batch_size]
        client.table("schedule_activities").upsert(batch, on_conflict="activity_id").execute()
        total_upserted += len(batch)
    return total_upserted


def fetch_domain_aliases(client: Any, status: Optional[str] = None) -> List[Dict]:
    """Fetches domain aliases, optionally filtered by status (e.g. 'verified', 'proposed')."""
    query = client.table("domain_aliases").select("*")
    if status:
        query = query.eq("status", status)
    res = query.execute()
    return res.data or []


def fetch_verified_domain_aliases(client: Any) -> List[Dict]:
    """Fetches only verified domain aliases for use in matching engine expansion."""
    return fetch_domain_aliases(client, status="verified")


def propose_domain_alias(client: Any, alias_data: Dict) -> Dict:
    """Inserts a proposed domain alias awaiting planner review."""
    payload = {
        "field_term": alias_data["field_term"].strip().lower(),
        "standard_term": alias_data["standard_term"].strip(),
        "discipline": alias_data.get("discipline"),
        "status": "proposed",
        "origin": alias_data.get("origin", "planner_correction"),
        "source_update_id": alias_data.get("source_update_id"),
        "proposed_by": alias_data.get("proposed_by", "Lead Project Planner"),
    }
    res = client.table("domain_aliases").insert(payload).execute()
    return res.data[0] if res.data else payload


def review_domain_alias(
    client: Any,
    alias_id: Any,
    status: str,
    reviewed_by: str = "Lead Project Planner"
) -> None:
    """Updates the status of an alias to 'verified' or 'rejected' with reviewer timestamp."""
    from datetime import datetime, timezone
    if status not in ("verified", "rejected"):
        raise ValueError(f"Invalid review status '{status}'. Must be 'verified' or 'rejected'.")
    payload = {
        "status": status,
        "reviewed_by": reviewed_by,
        "reviewed_at": datetime.now(timezone.utc).isoformat()
    }
    client.table("domain_aliases").update(payload).eq("id", alias_id).execute()


def requeue_field_update_for_rematch(
    client: Any,
    update_id: str,
    planner_name: str = "Lead Project Planner",
    remarks: str = "Re-queued for re-matching with updated domain dictionary"
) -> None:
    """
    Re-queues a field update row for matching by resetting confidence_level to 'Pending'.
    Strictly refuses to touch already-reviewed rows (status in 'approved', 'rejected', 'remapped').
    Enforced in data access layer.
    """
    res = client.table("field_updates").select("*").eq("update_id", update_id).execute()
    if not res.data:
        raise ValueError(f"Field update '{update_id}' not found.")
    row = res.data[0]
    curr_status = (row.get("status") or "").lower()
    if curr_status in ("approved", "rejected", "remapped"):
        raise ValueError(
            f"Cannot re-queue update '{update_id}': Row is already reviewed with status '{curr_status}'. "
            "Re-queue is strictly limited to unreviewed rows."
        )

    update_payload = {
        "confidence_level": "Pending",
        "confidence_score": None,
    }
    client.table("field_updates").update(update_payload).eq("update_id", update_id).execute()

    audit_record = {
        "field_update_id": row.get("id"),
        "action": "requeue",
        "previous_activity_id": row.get("matched_activity_id"),
        "new_activity_id": None,
        "planner_name": planner_name,
        "remarks": remarks,
    }
    create_planner_audit_log(client, audit_record)


def upsert_domain_aliases(client: Any, aliases: List[Dict]) -> int:
    """Upserts domain aliases based on field_term."""
    client.table("domain_aliases").upsert(aliases, on_conflict="field_term").execute()
    return len(aliases)


def fetch_field_updates(client: Any, status: Optional[str] = None) -> List[Dict]:
    """Fetches field updates, optionally filtered by status."""
    query = client.table("field_updates").select("*")
    if status:
        query = query.eq("status", status)
    res = query.execute()
    return res.data or []


def upsert_raw_field_updates(client: Any, updates: List[Dict], batch_size: int = 50) -> int:
    """Upserts raw field reports based on update_id."""
    total_upserted = 0
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i + batch_size]
        client.table("field_updates").upsert(batch, on_conflict="update_id").execute()
        total_upserted += len(batch)
    return total_upserted


def update_field_update_match(client: Any, update_id: str, match_data: Dict) -> None:
    """Writes back match results to a specific field update record."""
    client.table("field_updates").update(match_data).eq("update_id", update_id).execute()


def create_planner_audit_log(client: Any, audit_record: Dict) -> None:
    """Creates a planner decision audit trail log entry."""
    client.table("planner_audit_logs").insert(audit_record).execute()
