# SETU (Bridge) - AI-Assisted Schedule Linking & Planner Review
**Smart India Hackathon 2026** | **Problem Statement**: SIH26122 (Oil India Limited)

SETU bridges unstructured infrastructure field updates (daily site WhatsApp notes, supervisor logs, Excel reports) to formal **Oracle Primavera P6 L5/L6 schedule activities**. It leverages a hybrid matching engine (Domain Dictionary Expansion + RapidFuzz Lexical Matching + Sentence-Transformers Semantic Embeddings), routes matches to an explainable 3-tier confidence queue, and provides an interactive React Planner Review Queue backed by Supabase PostgreSQL with `pgvector`.

> **Disclaimer**: Illustrative synthetic data — prototype demonstration only. Not direct Primavera import or pilot results.

---

## Architecture & Confidence Routing

```
[ Field Update Text / Excel ]
             │
             ▼
   [ Domain Alias Expander ]  ──► Expands oil & gas slang (spool, stringing, tie-in)
             │
             ▼
  [ Hybrid Ensemble Scorer ]  ──► 0.55 * Semantic + 0.35 * Fuzzy + 0.10 * Discipline Boost
             │
    ┌────────┴──────────────────────────┐
    ▼                                   ▼                                   ▼
High Confidence (>= 0.82)     Medium Confidence (0.55 - 0.81)       Low / Unmatched (< 0.55)
[Suggested Auto-Link]         [Top-3 Candidate Review]              [Flagged for Review]
*All updates remain pending planner verification — no unreviewed automatic changes.*
             │
             ▼
[ React Planner Review Queue ]
   ├── Accept (Approved)
   ├── Reject (Rejected)
   └── Remap (Select candidate or search schedule)
             │
             ▼
[ Immutable Planner Audit Trail & Approved Schedule CSV Export ]
```

---

## React Planner Review Dashboard

Launch the interactive dashboard:
```bash
cd frontend
npm install
npm run dev
```

### Dashboard Capabilities:
1. **Header & Prototype Notice**:
   - Branding: **SETU · AI-Assisted Field-to-Plan Integration**
   - Problem Statement: **SIH26122 · Oil India Limited**
   - Explicit disclaimer badge: *Illustrative synthetic data — prototype demonstration only.*
2. **Real-Time KPI Cards**:
   - Total Ingested Reports (40)
   - High Confidence Suggestions ($\ge 82\%$)
   - Medium Confidence Review Queue ($55\% - 81\%$)
   - Low Confidence Flagged Reports ($< 55\%$)
   - Decision Counter: Approved / Remapped / Rejected / Pending
3. **Interactive Review Queue**:
   - Real-time filters: Confidence Tier, Review Status, Discipline, and Free-Text Search.
   - Raw field evidence preserved visibly.
   - Distinct color status badges: High (Green), Medium (Amber), Low (Red).
4. **Explainable AI Breakdown ("Why this match?")**:
   - Match Confidence Score (labeled as confidence, never "accuracy").
   - Matched Engine Layer (Hybrid / Semantic / Fuzzy / Exact Alias).
   - Domain jargon expansion text.
   - Top-3 candidate ranking table with scores, discipline, and matching rationale.
5. **Human-in-the-Loop Planner Controls**:
   - **Accept**: Marks report as `approved`.
   - **Reject**: Marks report as `rejected` with explanation.
   - **Remap**: Allows selecting from top candidates or searching all 220 P6 activities, updating target task and marking as `remapped`.
   - Planner Remarks input for every decision.
   - Every action writes an immutable row into `planner_audit_logs`.
6. **Analytics & Insights**:
   - Confidence routing donut chart.
   - Discipline-wise workload bar chart.
   - Decision status donut chart.
   - Labeled: *Synthetic prototype routing output — not pilot results.*
7. **Approved Schedule CSV Export**:
   - Downloadable schedule diff containing **only** `approved` and `remapped` items.
   - Columns: `Activity ID`, `Activity Name`, `Reported Date`, `Site Location`, `Field Evidence`, `Confidence Score`, `Planner Status`, `Planner Remarks`.
   - Clean preview table and one-click download.

---

## Supabase Database Schema

The database uses PostgreSQL with the `pgvector` extension across four primary tables:

1. **`schedule_activities`**: 220 Primavera P6 Level 5/6 activities with WBS codes, planned quantities, dates, and 384-dimensional dense vector embeddings (`all-MiniLM-L6-v2`).
2. **`domain_aliases`**: 29 domain terminology mappings for Oil & Gas engineering jargon.
3. **`field_updates`**: 40 ingested daily site logs, confidence scores, confidence levels (High/Medium/Low), top-3 candidate matches, and status (`pending`, `approved`, `rejected`, `remapped`).
4. **`planner_audit_logs`**: Immutable audit records populated exclusively when a human planner accepts, rejects, or remaps an activity.

---

## Quick Start & CLI Instructions

### 1. Prerequisites & Installation
Requires **Python 3.11+**. Install project dependencies:
```bash
pip install -r requirements.txt
```

### 2. Environment Configuration
Copy `.env.example` to `.env` and configure your credentials:
```bash
cp .env.example .env
```
Ensure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are configured.

### 3. Run Test Suite (33 Tests)
```bash
pytest tests/ -v
```

### 4. Run Data Ingestion & Matching Pipeline
```bash
# Ingest 220 activities, 29 aliases, and 40 field updates into Supabase
python database/import_data.py

# Execute hybrid matching and write back to Supabase
python engine/run_supabase_matching.py

# Verify database state and table integrity
python database/verify_database.py
```

### 5. Launch the Review Dashboard
```bash
cd frontend
npm install
npm run dev
```

---

## Repository Structure

```text
SETU/
├── config/
│   ├── __init__.py
│   └── settings.py                  # Environment configuration & threshold values
├── data/
│   ├── domain_aliases.json          # 29 Oil India engineering terminology mappings
│   ├── generate_p6_schedule.py      # Generator for 220 L5/L6 Primavera P6 activities
│   ├── generate_field_updates.py    # Generator for 40 daily field logs (CSV + Excel)
│   ├── synthetic_p6_schedule.csv    # 220 Primavera activities across 6 disciplines
│   ├── synthetic_field_updates.xlsx # 40 realistic field reports (High, Med, Low)
│   ├── matching_results.csv         # Standalone matching pipeline tabular results
│   ├── matching_results.json        # Standalone matching pipeline structured JSON
│   └── planner_approved_schedule_updates.csv # Exported planner-approved diff CSV
├── database/
│   ├── __init__.py
│   ├── schema.sql                   # Supabase PostgreSQL + pgvector schema & stored proc
│   ├── supabase_client.py           # Supabase client factory & separate CRUD access layer
│   ├── import_data.py               # Ingestion script for schedule, aliases, and raw reports
│   └── verify_database.py           # Database audit script verifying counts & sample records
├── engine/
│   ├── __init__.py
│   ├── alias_expander.py            # Domain jargon expansion & discipline detection
│   ├── fuzzy_matcher.py             # RapidFuzz token set and sort lexical matching
│   ├── embeddings.py                # Sentence-transformers (all-MiniLM-L6-v2) vector search
│   ├── ensemble_matcher.py          # Hybrid scoring & 3-tier confidence classification
│   ├── run_matching_pipeline.py     # Local CLI runner for batch matching
│   └── run_supabase_matching.py     # Database matching runner integrating with Supabase
├── frontend/                        # React + Vite + TypeScript Planner/Supervisor dashboard
│   ├── src/
│   │   ├── components/              # KPI cards, badges, review card, remap modal
│   │   ├── hooks/                   # useFieldUpdates, useScheduleData, useAuditLogs
│   │   ├── lib/                     # Supabase client & helpers
│   │   ├── pages/                   # Planner (CommandCenter, ReviewQueue, AuditExport) & Supervisor (FieldCapture)
│   │   └── types/
│   └── package.json
└── tests/
    ├── __init__.py
    ├── test_data_validation.py      # Dataset & schema integrity tests
    ├── test_alias_expander.py       # Alias expansion tests
    ├── test_fuzzy_matcher.py        # Lexical matching tests
    ├── test_ensemble_matcher.py     # Hybrid scoring, boundary, and explainability tests
    └── test_supabase_mapping.py     # Supabase row mapping & idempotent import tests
```

---

## Scoring Formula & Explainability

$$\text{Final Score} = 0.55 \times \text{Semantic Score} + 0.35 \times \text{Fuzzy Score} + 0.10 \times \text{Discipline Boost}$$

- **Semantic Score**: Cosine similarity between dense 384-dimensional query and activity embeddings.
- **Fuzzy Score**: RapidFuzz token set ratio evaluating lexical overlap.
- **Discipline Boost**: +1.0 when candidate's engineering discipline matches detected domain jargon or query context.
- **Confidence Tiers**:
  - **High** ($\ge 0.82$): Suggested Auto-Link for expedited planner signoff.
  - **Medium** ($0.55 \le \text{Score} < 0.82$): Top-3 candidate options presented in Planner Review Queue.
  - **Low** ($< 0.55$): Retained and flagged for review; **never silently dropped**.
