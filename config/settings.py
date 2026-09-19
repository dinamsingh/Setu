"""Application settings and environment configuration for SETU."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Base Directory of SETU
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env if it exists
load_dotenv(BASE_DIR / ".env")

# Supabase Configurations
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Embedding Model
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")

# Confidence Thresholds
THRESHOLD_HIGH_CONFIDENCE = float(os.getenv("THRESHOLD_HIGH_CONFIDENCE", "0.82"))
THRESHOLD_MEDIUM_CONFIDENCE = float(os.getenv("THRESHOLD_MEDIUM_CONFIDENCE", "0.55"))

# Validation Tolerances & Thresholds (Project Controls)
VALIDATION_DATE_TOLERANCE_DAYS_BEFORE = int(os.getenv("VALIDATION_DATE_TOLERANCE_DAYS_BEFORE", "30"))
VALIDATION_DATE_TOLERANCE_DAYS_AFTER = int(os.getenv("VALIDATION_DATE_TOLERANCE_DAYS_AFTER", "60"))
# Calibrated based on empirical sweep against 40 baseline reports: top1-top2 margins span [0.0000, 0.0280].
# At 0.008 with narrowed confusable-candidate filtering, precision is 88.9% (8/9 flagged reports are true errors)
# without degrading into a 100% block signal.
VALIDATION_AMBIGUITY_THRESHOLD = float(os.getenv("VALIDATION_AMBIGUITY_THRESHOLD", "0.008"))
VALIDATION_MAX_GROUND_TRUTH_FP_RATE = float(os.getenv("VALIDATION_MAX_GROUND_TRUTH_FP_RATE", "0.05"))  # max 5% false-positive rate on ground-truth links


# Local Offline / Mock Database Flag (Disabled by default - forces live Supabase connection)
USE_LOCAL_MOCK_DB = os.getenv("USE_LOCAL_MOCK_DB", "False").lower() in ("true", "1", "yes")

# Debug Settings
DEBUG_MODE = os.getenv("DEBUG_MODE", "False").lower() in ("true", "1", "yes")

# File Paths
DATA_DIR = BASE_DIR / "data"
DATABASE_DIR = BASE_DIR / "database"
DOMAIN_ALIASES_PATH = DATA_DIR / "domain_aliases.json"
P6_SCHEDULE_CSV_PATH = DATA_DIR / "synthetic_p6_schedule.csv"
FIELD_UPDATES_XLSX_PATH = DATA_DIR / "synthetic_field_updates.xlsx"
FIELD_UPDATES_CSV_PATH = DATA_DIR / "synthetic_field_updates.csv"
