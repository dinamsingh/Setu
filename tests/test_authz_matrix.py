"""Deterministic mock authorization model test suite for SETU Phase 5.

NOTE ON VERIFICATION BOUNDARY:
- These tests verify the application authorization matrix using the deterministic
  model in database/authz.py.
- Live PostgreSQL Row Level Security (RLS) enforcement is defined in database/schema.sql
  and database/migrations/005_auth_rls.sql.
- Mock tests prove internal consistency of the permission matrix; live Supabase RLS
  must be verified separately against a PostgreSQL instance.
"""

import pytest
from database.authz import can


# 1. site cannot approve field update
def test_1_site_cannot_approve_field_update():
    """Site supervisor cannot update field update status (approve/reject/remap)."""
    assert can("site", "field_updates", "update") is False


# 2. engineer cannot approve field update
def test_2_engineer_cannot_approve_field_update():
    """Field engineer cannot update field update status (approve/reject/remap)."""
    assert can("engineer", "field_updates", "update") is False


# 3. site cannot verify alias
def test_3_site_cannot_verify_alias():
    """Site supervisor cannot verify or reject domain aliases."""
    assert can("site", "domain_aliases", "update") is False


# 4. engineer cannot verify alias
def test_4_engineer_cannot_verify_alias():
    """Field engineer cannot verify or reject domain aliases."""
    assert can("engineer", "domain_aliases", "update") is False


# 5. non-admin cannot change own role
def test_5_non_admin_cannot_change_own_role():
    """Non-admin roles cannot escalate or change their own assigned role."""
    for role in ("site", "engineer", "planner"):
        assert can(role, "user_roles", "update", own=True) is False
        assert can(role, "user_roles", "insert", own=True) is False
        assert can(role, "user_roles", "delete", own=True) is False


# 6. non-admin cannot change another user's role
def test_6_non_admin_cannot_change_another_user_role():
    """Non-admin roles cannot modify another user's role assignment."""
    for role in ("site", "engineer", "planner"):
        assert can(role, "user_roles", "update", own=False) is False
        assert can(role, "user_roles", "insert", own=False) is False
        assert can(role, "user_roles", "delete", own=False) is False


# 7. audit logs cannot be updated
def test_7_audit_logs_cannot_be_updated():
    """Planner audit logs are append-only: UPDATE is prohibited for all browser roles."""
    for role in ("site", "engineer", "planner", "admin"):
        assert can(role, "planner_audit_logs", "update") is False


# 8. audit logs cannot be deleted
def test_8_audit_logs_cannot_be_deleted():
    """Planner audit logs are append-only: DELETE is prohibited for all browser roles."""
    for role in ("site", "engineer", "planner", "admin"):
        assert can(role, "planner_audit_logs", "delete") is False


# 9. planner can perform planner actions
def test_9_planner_can_perform_planner_actions():
    """Planner can review field updates, review aliases, view logs, and update schedules."""
    assert can("planner", "field_updates", "update") is True
    assert can("planner", "field_updates", "select", own=False) is True
    assert can("planner", "domain_aliases", "update") is True
    assert can("planner", "domain_aliases", "select") is True
    assert can("planner", "schedule_activities", "select") is True
    assert can("planner", "schedule_activities", "update") is True
    assert can("planner", "planner_audit_logs", "insert") is True
    assert can("planner", "planner_audit_logs", "select") is True


# 10. admin can perform admin actions
def test_10_admin_can_perform_admin_actions():
    """Admin can manage user roles, review field updates, review aliases, and view logs."""
    assert can("admin", "user_roles", "insert") is True
    assert can("admin", "user_roles", "update") is True
    assert can("admin", "user_roles", "delete") is True
    assert can("admin", "user_roles", "select") is True
    assert can("admin", "field_updates", "update") is True
    assert can("admin", "domain_aliases", "update") is True
    assert can("admin", "schedule_activities", "update") is True
    assert can("admin", "planner_audit_logs", "select") is True


# 11. site can perform allowed field-update actions
def test_11_site_can_perform_allowed_field_update_actions():
    """Site supervisor can insert and select only their own field updates."""
    assert can("site", "field_updates", "insert", own=True) is True
    assert can("site", "field_updates", "insert", own=False) is False
    assert can("site", "field_updates", "select", own=True) is True
    assert can("site", "field_updates", "select", own=False) is False
    assert can("site", "domain_aliases", "select") is True
    assert can("site", "domain_aliases", "insert", own=True) is True


# 12. engineer can perform allowed field-update actions
def test_12_engineer_can_perform_allowed_field_update_actions():
    """Field engineer can insert and select only their own field updates."""
    assert can("engineer", "field_updates", "insert", own=True) is True
    assert can("engineer", "field_updates", "insert", own=False) is False
    assert can("engineer", "field_updates", "select", own=True) is True
    assert can("engineer", "field_updates", "select", own=False) is False
    assert can("engineer", "domain_aliases", "select") is True
    assert can("engineer", "domain_aliases", "insert", own=True) is True

