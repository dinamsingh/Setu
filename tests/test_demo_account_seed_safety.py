"""Guard against accidentally shipping hard-coded Supabase demo credentials.

Account creation must use the Supabase Auth administration interface; SQL scripts
may assign roles to already-created users but must not manipulate auth.users.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = (ROOT / "database" / "seed_demo_users.sql").read_text(encoding="utf-8")
SQL = SEED.lower()


def test_demo_seed_never_sets_or_commits_passwords():
    assert "raw_password" not in SQL
    assert "encrypted_password" not in SQL
    assert "gen_salt" not in SQL
    assert "crypt(" not in SQL
    assert "create or replace function" not in SQL


def test_demo_seed_never_writes_supabase_auth_tables():
    for token in ("insert into auth.users", "update auth.users", "delete from auth.users",
                  "insert into auth.identities", "update auth.identities"):
        assert token not in SQL


def test_role_seeding_requires_explicit_preexisting_user_identifiers():
    assert "replace_with_evaluator_site_email" in SQL
    assert "replace_with_evaluator_planner_email" in SQL
    assert "from auth.users" in SQL
    assert "auth account not found" in SQL
    assert "role <> v_mapping.role" in SQL
    assert "on conflict (user_id)" in SQL
