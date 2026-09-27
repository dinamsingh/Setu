# SETU — Field-to-Plan Integration Prototype

**Smart India Hackathon 2026 · SIH26122 · Oil India Limited**

SETU is a prototype for linking unstructured field progress reports to **read-only Primavera P6 L5/L6 schedule activities**, with confidence scoring, validation, planner review, auditability, and reusable institutional memory.

> **Prototype status:** benchmark data is synthetic and self-labelled. Results are engineering-calibration results, not OIL pilot or production accuracy.

## What the prototype demonstrates

1. **Capture** — field notes and structured reports
2. **Understand** — normalize terminology and extract activity/date/location/quantity/evidence
3. **Match** — domain aliases + fuzzy matching + Sentence-Transformers semantic similarity + location context
4. **Validate** — date, scope/location, duplicate, reporter/discipline, sequence and candidate-ambiguity checks
5. **Planner review** — accept, reject or remap with evidence
6. **Trace & learn** — approved export, audit history and institutional-memory records

```
[ Field Update Text / Excel ]
             │
             ▼
   [ Domain Alias Expander ]  ──► Expands oil & gas slang (spool, stringing, tie-in)
             │
             ▼
  [ Hybrid Ensemble Scorer ]  ──► 0.40 * Semantic + 0.30 * Fuzzy + 0.10 * Discipline + 0.20 * Location
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

**Safety boundary:** matching produces suggestions; planner decisions remain the approval point. The prototype does not silently rewrite the baseline.

## Prototype benchmark

The current synthetic benchmark contains:

- **40** field reports
- **220** schedule activities
- **12/12** high-confidence cases top-1 correct
- **67.5%** overall top-3 candidate coverage
- **0** over-confident high-tier misroutes

See the full methodology, dataset scope and calibration analysis in [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Authentication, Roles & Row Level Security

SETU implements Supabase Auth for browser sessions and PostgreSQL Row Level Security (RLS) for authorization.

Roles:
- `field_engineer`: submits site reports and views activity progress.
- `project_planner`: reviews matches, overrides links, and exports approved schedule updates.
- `admin`: manages user roles and system configuration.

Security enforcement:
- The browser only receives the publishable/anon key and user session JWT.
- Backend CLI and matching workers use `SUPABASE_SERVICE_ROLE_KEY` to run background batch processing without exposing credentials to the client.
- Database RLS strictly isolates table operations (`field_reports`, `schedule_tasks`, `matches`, `planner_audit_logs`).
- Route guards on the frontend enforce role redirection, backed by database RLS.

## Run the prototype

### 1. Prerequisites & Python Pipeline

Requirements: Python 3.11+

```bash
python -m venv .venv
# activate the environment for your OS
pip install -r requirements.txt
pytest tests/ -v
python engine/evaluate.py
```

The evaluation reads the synthetic schedule/report fixtures and writes benchmark metrics to `data/baseline_metrics.json`.

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure credentials:
```bash
cp .env.example .env
```
Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for server-side CLI workers. For frontend applications, configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

### 3. Frontend Applications

#### Planner Prototype (React + Vite)
```bash
# From repository root:
npm run dev

# Or directly:
cd frontend
npm install
npm run dev
```

Recommended demo path:
**Role Sign-in → Field Capture → Planner Command Center → Review Queue → Audit & Export**

#### Public Landing Page
```bash
cd landing
npm install
npm run dev
```

## Repository structure

```text
SETU/
├── config/          # Environment and scoring/validation thresholds
├── data/            # Synthetic benchmark inputs, aliases and generated outputs
├── database/        # PostgreSQL/Supabase schema, migrations (Auth/RLS) & data access
├── engine/          # Matching, scoring, validation and evaluation logic
├── frontend/        # React + TypeScript planner review prototype
├── landing/         # Public product landing page
├── tests/           # Matching, validation, authorization and persistence tests
├── docs/            # Benchmark, security and evaluator-facing technical notes
├── scripts/         # Convenience verification/evaluation scripts
├── package.json     # Root convenience scripts for frontend dev/build
├── requirements.txt
└── README.md
```

## Technical core

| Layer | Prototype implementation |
|---|---|
| Semantic matching | Sentence-Transformers (`all-MiniLM-L6-v2`) |
| Lexical matching | RapidFuzz |
| Context | Domain aliases, discipline and location |
| Persistence & Vector | Supabase PostgreSQL + pgvector |
| Security & Auth | Supabase Auth + PostgreSQL Row Level Security (RLS) |
| Planner workflow | React + TypeScript + Vite |
| Validation | Six deterministic project-control checks |
| Audit | Planner decision history + approved export |

The matching score combines semantic, fuzzy, discipline and location signals. Thresholds are configurable in `config/settings.py`.

## Evidence and limitations

- Synthetic datasets are included so the prototype can be reproduced without OIL data.
- The repository does **not** contain confidential OIL project data.
- The benchmark should not be presented as an OIL deployment result.
- Operational deployment requires organization-controlled infrastructure, production secrets management, and live Primavera P6 integration adapters.

For detailed benchmark methodology and calibration results, see [docs/BENCHMARK.md](docs/BENCHMARK.md).