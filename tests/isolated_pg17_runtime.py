"""Real PostgreSQL 17 checks for migrations 013 -> 014; isolated CI DB only.

No Docker, cloud database, credentials or production data. The auth schema is a
synthetic stand-in for Supabase Auth/JWTs: SQL roles, RLS and SECURITY DEFINER
semantics are real PostgreSQL behavior, but the hosted Auth API is not tested.
"""

import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Barrier

import psycopg

DATABASE_URL = os.environ.get("ISOLATED_PG17_URL", "")
if not DATABASE_URL or "localhost" not in DATABASE_URL and "127.0.0.1" not in DATABASE_URL:
    raise SystemExit("Refusing to run without a local-only ISOLATED_PG17_URL")

SITE = "10000000-0000-4000-8000-000000000001"
ENGINEER = "10000000-0000-4000-8000-000000000002"
PLANNER = "10000000-0000-4000-8000-000000000003"
RECENT_DATE = date.today() - timedelta(days=2)
counts = []


def as_role(role, identity, query, params=(), barrier=None):
    with psycopg.connect(DATABASE_URL, connect_timeout=10) as con:
        with con.cursor() as cur:
            if role not in ("authenticated", "anon"):
                raise AssertionError("Only unprivileged client roles may be tested")
            cur.execute(f"SET LOCAL ROLE {role}")
            cur.execute("SELECT pg_catalog.set_config('request.jwt.claim.role', %s, true)", (role,))
            cur.execute("SELECT pg_catalog.set_config('request.jwt.claim.sub', %s, true)", (identity or "",))
            if barrier:
                barrier.wait(timeout=15)
            cur.execute(query, params)
            if cur.description:
                return cur.fetchone()[0]


def as_owner(query, params=()):
    with psycopg.connect(DATABASE_URL, connect_timeout=10) as con:
        with con.cursor() as cur:
            cur.execute(query, params)
            if cur.description:
                return cur.fetchone()[0]


def expect_sqlstate(label, state, role, identity, query, params=()):
    try:
        as_role(role, identity, query, params)
    except psycopg.Error as exc:
        if exc.sqlstate != state:
            raise AssertionError(f"{label}: expected SQLSTATE {state}, got {exc.sqlstate}: {exc}") from exc
        print(f"PASS {label}: rejected as expected ({state})", flush=True)
        counts.append(label)
        return
    raise AssertionError(f"{label}: unexpectedly succeeded")


def must(label, passed):
    if not passed:
        raise AssertionError(label)
    print(f"PASS {label}", flush=True)
    counts.append(label)


def submit(identity, key, text="Spool fit-up at Manifold A completed today", source="manual_text", barrier=None):
    return as_role(
        "authenticated",
        identity,
        "SELECT public.submit_supervisor_field_update(%s,%s,%s,%s,%s,%s,%s,%s)",
        (text, "Manifold A", RECENT_DATE, "Synthetic Site Observer", "Piping", source, None, key),
        barrier=barrier,
    )


def main():
    must("014 migration RPC exists", as_owner(
        "SELECT to_regprocedure('public.submit_supervisor_field_update(text,text,date,text,text,text,text,text,jsonb,jsonb)') IS NOT NULL"
    ))
    must("import RPC from real 013 migration remains", as_owner(
        "SELECT to_regprocedure('public.import_field_reports(uuid,text,jsonb)') IS NOT NULL"
    ))
    must("014 revokes direct authenticated INSERT privilege", not as_owner(
        "SELECT has_table_privilege('authenticated', 'public.field_updates', 'INSERT')"
    ))
    must("014 receipts table is private", not as_owner(
        "SELECT has_table_privilege('authenticated', 'public.supervisor_submission_receipts', 'SELECT')"
    ))
    must("014 trigger is SECURITY INVOKER", as_owner(
        """SELECT NOT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='protect_field_update_insert_boundary'"""
    ))

    first = submit(SITE, "eval-manual-0001")
    must("authorized Site can submit manual report", first["success"] and not first["replayed"])
    must("manual report starts pending", as_owner(
        "SELECT status = 'pending' AND matched_activity_id IS NULL AND "
        "confidence_score = 0 AND candidate_matches = '[]'::jsonb "
        "AND validation_results = '[]'::jsonb "
        "FROM public.field_updates WHERE id=%s", (first["id"],)
    ))
    replay = submit(SITE, "eval-manual-0001")
    must("replay is idempotent", replay["replayed"] and replay["id"] == first["id"])
    must("only one row for replay key", as_owner(
        "SELECT count(*) = 1 FROM public.supervisor_submission_receipts "
        "WHERE actor_user_id = %s::uuid AND idempotency_key=%s",
        (SITE, "eval-manual-0001"),
    ))
    expect_sqlstate(
        "different payload cannot reuse idempotency key", "23505", "authenticated", SITE,
        "SELECT public.submit_supervisor_field_update(%s,%s,%s,%s,%s,%s,%s,%s)",
        ("Other report narrative", "Manifold A", RECENT_DATE, "Synthetic Site Observer",
         "Piping", "manual_text", None, "eval-manual-0001"),
    )

    engineer = submit(ENGINEER, "eval-engineer-0001", source="voice_transcript")
    must("Engineer voice transcription submission succeeds", engineer["success"] and not engineer["replayed"])
    expect_sqlstate(
        "Planner cannot submit Supervisor report", "42501", "authenticated", PLANNER,
        "SELECT public.submit_supervisor_field_update(%s,%s,%s,%s)",
        ("Unauthorized field report", "Manifold A", RECENT_DATE, "Test Planner"),
    )
    expect_sqlstate(
        "anon cannot submit Supervisor report", "42501", "anon", None,
        "SELECT public.submit_supervisor_field_update(%s,%s,%s,%s)",
        ("Anonymous report", "Manifold A", RECENT_DATE, "Unknown"),
    )
    expect_sqlstate(
        "blank narrative is rejected", "22023", "authenticated", SITE,
        "SELECT public.submit_supervisor_field_update(%s,%s,%s,%s)",
        ("x", "Manifold A", RECENT_DATE, "Synthetic Site Observer"),
    )
    expect_sqlstate(
        "future date is rejected", "22023", "authenticated", SITE,
        "SELECT public.submit_supervisor_field_update(%s,%s,%s,%s)",
        ("Wrong date in report", "Manifold A", date.today() + timedelta(days=4), "Synthetic Site Observer"),
    )
    expect_sqlstate(
        "untrusted source type rejected", "22023", "authenticated", SITE,
        "SELECT public.submit_supervisor_field_update(%s,%s,%s,%s,%s,%s)",
        ("Spoofed source report", "Manifold A", RECENT_DATE, "Synthetic Site Observer", "Piping", "fake_source"),
    )
    expect_sqlstate(
        "direct INSERT blocked even for Site with old INSERT RLS policy", "42501", "authenticated", SITE,
        "INSERT INTO public.field_updates(update_id,source_type,field_text,reported_date,submitted_by_user_id) "
        "VALUES(%s,%s,%s,%s,%s::uuid)",
        ("UPD-DIRECT-DENIED", "manual_text", "Direct bypass", RECENT_DATE, SITE),
    )

    # Exercise the actual existing 013 spreadsheet import RPC after installing 014.
    request_id = uuid.uuid4()
    rows = [{
        "row_number": 2, "field_text": "Synthetic CSV report: weld inspection completed",
        "site_location": "Manifold B", "reported_date": RECENT_DATE.isoformat(),
        "reported_by": "CSV Test Observer", "discipline": "Piping",
    }]
    import_query = "SELECT public.import_field_reports(%s::uuid,%s,%s::jsonb)"
    imported = as_role("authenticated", SITE, import_query, (str(request_id), "csv", json.dumps(rows)))
    must("existing CSV import RPC remains functional", imported["status"] == "completed"
         and imported["imported_count"] == 1)
    imported_repeat = as_role("authenticated", SITE, import_query, (str(request_id), "csv", json.dumps(rows)))
    must("existing CSV replay deduplicates", imported_repeat["replayed"]
         and imported_repeat["duplicate_count"] == 1 and imported_repeat["imported_count"] == 0)
    xlsx = as_role("authenticated", ENGINEER, import_query,
                   (str(uuid.uuid4()), "xlsx", json.dumps(rows)))
    must("existing XLSX import RPC remains functional", xlsx["status"] == "completed"
         and xlsx["imported_count"] == 1)
    must("Planner can see reports through read policy", as_role(
        "authenticated", PLANNER, "SELECT count(*) > 0 FROM public.field_updates"
    ))
    must("Site cannot see Engineer reports", as_role(
        "authenticated", SITE, "SELECT count(*) = 0 FROM public.field_updates WHERE submitted_by_user_id=%s::uuid",
        (ENGINEER,),
    ))

    concurrency_key = "eval-concurrency-0001"
    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(submit, SITE, concurrency_key, barrier=barrier)
        f2 = pool.submit(submit, SITE, concurrency_key, barrier=barrier)
        a, b = f1.result(timeout=35), f2.result(timeout=35)
    must("concurrent same-key replay produces exactly one new report",
         a["id"] == b["id"] and sorted([a["replayed"], b["replayed"]]) == [False, True])
    must("concurrent receipts have exactly one row", as_owner(
        "SELECT count(*) = 1 FROM public.supervisor_submission_receipts "
        "WHERE actor_user_id=%s::uuid AND idempotency_key=%s", (SITE, concurrency_key)
    ))
    print(f"ALL {len(counts)} ISOLATED PG17 BEHAVIORAL CHECKS PASSED", flush=True)


if __name__ == "__main__":
    main()
