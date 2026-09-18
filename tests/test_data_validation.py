"""Data Validation and Phase 1 Sanity Test Suite for SETU."""

import json
from pathlib import Path
import pandas as pd
import pytest

from config import settings


def test_p6_schedule_data():
    """Verify synthetic Primavera P6 schedule CSV file integrity."""
    csv_path = settings.P6_SCHEDULE_CSV_PATH
    assert csv_path.exists(), f"Missing P6 schedule CSV at {csv_path}"
    
    df = pd.read_csv(csv_path)
    
    # 1. Row count requirement (> 100)
    assert len(df) >= 100, f"Expected at least 100 activities, found {len(df)}"
    
    # 2. Required columns present
    required_cols = [
        "activity_id", "activity_name", "discipline", "wbs_code",
        "wbs_name", "planned_start_date", "planned_finish_date",
        "planned_progress_pct", "unit_of_measure", "planned_qty"
    ]
    for col in required_cols:
        assert col in df.columns, f"Missing required column '{col}' in schedule CSV"
        
    # 3. Uniqueness of activity IDs
    assert df["activity_id"].is_unique, "Found duplicate activity_id in schedule CSV"
    
    # 4. Valid non-empty values
    assert df["activity_name"].str.strip().ne("").all(), "Found empty activity_name"
    assert df["wbs_code"].str.strip().ne("").all(), "Found empty wbs_code"
    
    # 5. Discipline representation
    expected_disciplines = {"Pipeline", "Piping", "Civil", "Electrical", "Instrumentation", "Mechanical"}
    actual_disciplines = set(df["discipline"].unique())
    assert expected_disciplines.issubset(actual_disciplines), (
        f"Missing disciplines: {expected_disciplines - actual_disciplines}"
    )
    
    # 6. Valid date logic
    start_dates = pd.to_datetime(df["planned_start_date"])
    finish_dates = pd.to_datetime(df["planned_finish_date"])
    assert (start_dates <= finish_dates).all(), "Found activities where start_date > finish_date"


def test_field_updates_data():
    """Verify synthetic field updates in both CSV and Excel formats."""
    csv_path = settings.FIELD_UPDATES_CSV_PATH
    xlsx_path = settings.FIELD_UPDATES_XLSX_PATH
    
    assert csv_path.exists(), f"Missing field updates CSV at {csv_path}"
    assert xlsx_path.exists(), f"Missing field updates Excel at {xlsx_path}"
    
    df_csv = pd.read_csv(csv_path)
    df_xlsx = pd.read_excel(xlsx_path)
    
    # 1. Row count (at least 40)
    assert len(df_csv) >= 40, f"Expected >= 40 field updates, found {len(df_csv)}"
    assert len(df_xlsx) == len(df_csv), "Mismatch between CSV and Excel row counts"
    
    # 2. Required columns
    expected_cols = [
        "update_id", "reported_date", "source_type", "field_text",
        "site_location", "reported_by", "benchmark_expected_act", "benchmark_intent"
    ]
    for col in expected_cols:
        assert col in df_csv.columns, f"Missing column '{col}' in field updates"
        
    # 3. Text content validity
    assert df_csv["field_text"].str.strip().ne("").all(), "Found empty field_text"
    
    # 4. Routing tiers coverage
    intents = set(df_csv["benchmark_intent"].unique())
    assert "high_auto_link" in intents, "Missing 'high_auto_link' benchmark updates"
    assert "medium_planner_review" in intents, "Missing 'medium_planner_review' benchmark updates"
    assert "low_unmatched_review" in intents, "Missing 'low_unmatched_review' benchmark updates"
    
    # 5. Low confidence never silently dropped (benchmark indicates UNMATCHED / note)
    low_updates = df_csv[df_csv["benchmark_intent"] == "low_unmatched_review"]
    assert len(low_updates) >= 5, "Expected at least 5 unmatched/low confidence test cases"


def test_domain_aliases():
    """Verify domain aliases dictionary."""
    alias_path = settings.DOMAIN_ALIASES_PATH
    assert alias_path.exists(), f"Missing domain aliases JSON at {alias_path}"
    
    with open(alias_path, "r", encoding="utf-8") as f:
        aliases = json.load(f)
        
    assert isinstance(aliases, list), "domain_aliases.json must be a list of alias objects"
    assert len(aliases) >= 20, f"Expected at least 20 aliases, found {len(aliases)}"
    
    terms = set()
    for item in aliases:
        assert "field_term" in item, "Missing 'field_term' in alias entry"
        assert "standard_term" in item, "Missing 'standard_term' in alias entry"
        assert "discipline" in item, "Missing 'discipline' in alias entry"
        assert item["field_term"].strip(), "Empty field_term found"
        assert item["standard_term"].strip(), "Empty standard_term found"
        terms.add(item["field_term"].lower())
        
    # Key Oil & Gas keywords must be present
    crucial_terms = ["spool", "tie-in", "hydrotest", "stringing", "row", "rebar", "pcc", "rcc"]
    for ct in crucial_terms:
        assert ct in terms, f"Crucial domain term '{ct}' missing from aliases dictionary"


def test_database_schema_sql():
    """Verify SQL migration file contains all required schema constructs."""
    schema_path = settings.DATABASE_DIR / "schema.sql"
    assert schema_path.exists(), f"Missing schema.sql at {schema_path}"
    
    sql_text = schema_path.read_text(encoding="utf-8").lower()
    
    # Check pgvector extension
    assert "create extension if not exists vector" in sql_text, "Missing pgvector extension"
    
    # Check all 4 tables
    assert "create table if not exists schedule_activities" in sql_text
    assert "create table if not exists domain_aliases" in sql_text
    assert "create table if not exists field_updates" in sql_text
    assert "create table if not exists planner_audit_logs" in sql_text
    
    # Check stored procedure
    assert "create or replace function match_schedule_activities" in sql_text
    assert "vector(384)" in sql_text


def test_config_settings():
    """Verify application configuration defaults."""
    assert 0.7 <= settings.THRESHOLD_HIGH_CONFIDENCE <= 0.95
    assert 0.4 <= settings.THRESHOLD_MEDIUM_CONFIDENCE < settings.THRESHOLD_HIGH_CONFIDENCE
    assert settings.EMBEDDING_MODEL_NAME == "sentence-transformers/all-MiniLM-L6-v2"
