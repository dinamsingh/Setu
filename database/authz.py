"""Deterministic authorization model used only by the local mock/test layer.

The real production enforcement lives in Supabase PostgreSQL RLS policies in
database/schema.sql. This module mirrors the intended matrix so offline tests
can verify application behaviour without a live Supabase project.
"""

from typing import Literal

Role = Literal["site", "engineer", "planner", "admin"]


def can(role: Role, resource: str, action: str, *, own: bool = False) -> bool:
    if resource == "schedule_activities":
        return action == "select" or (role in ("planner", "admin") and action in {"insert", "update", "delete"})

    if resource == "field_updates":
        if action == "insert":
            return role in ("site", "engineer") and own
        if action == "select":
            return own or role in ("planner", "admin")
        if action == "update":
            return role in ("planner", "admin")
        return False

    if resource == "domain_aliases":
        if action == "select":
            return True
        if action == "insert":
            return role in ("site", "engineer", "planner", "admin") and own
        if action == "update":
            return role in ("planner", "admin")
        return False

    if resource == "planner_audit_logs":
        if action == "insert":
            return True
        if action == "select":
            return role in ("planner", "admin")
        # Append-only browser model.
        return False

    if resource == "user_roles":
        if action == "select":
            return True  # database policy narrows this to self/admin
        if action in {"insert", "update", "delete"}:
            return role == "admin"
        return False

    return False
