from database.authz import can


def test_site_cannot_approve_field_update():
    assert can("site", "field_updates", "update") is False


def test_site_cannot_verify_alias():
    assert can("site", "domain_aliases", "update") is False


def test_non_admin_cannot_change_role():
    assert can("planner", "user_roles", "update") is False
    assert can("site", "user_roles", "update") is False
    assert can("engineer", "user_roles", "update") is False


def test_audit_log_is_append_only_for_browser_roles():
    assert can("planner", "planner_audit_logs", "insert") is True
    assert can("planner", "planner_audit_logs", "update") is False
    assert can("planner", "planner_audit_logs", "delete") is False


def test_planner_can_perform_planner_actions():
    assert can("planner", "field_updates", "update") is True
    assert can("planner", "domain_aliases", "update") is True
    assert can("planner", "schedule_activities", "update") is True
    assert can("admin", "user_roles", "update") is True


def test_site_can_submit_only_own_field_update():
    assert can("site", "field_updates", "insert", own=True) is True
    assert can("site", "field_updates", "insert", own=False) is False
