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

**Safety boundary:** matching produces suggestions; planner decisions remain the approval point. The prototype does not silently rewrite the baseline.

## Prototype benchmark

The current synthetic benchmark contains:

- **40** field reports
- **220** schedule activities
- **12/12** high-confidence cases top-1 correct
- **67.5%** overall top-3 candidate coverage
- **0** over-confident high-tier misroutes

See the full methodology, dataset scope and calibration analysis in [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Run the prototype

### Python pipeline

Requirements: Python 3.11+

```bash
python -m venv .venv
# activate the environment for your OS
pip install -r requirements.txt
pytest tests/ -v
python engine/evaluate.py
```

The evaluation reads the synthetic schedule/report fixtures and writes benchmark metrics to `data/baseline_metrics.json`.

### Planner frontend

```bash
cd frontend
npm install
npm run dev
```

Recommended demo path:

**Role Selection → Supervisor Capture → Planner Command Center → Review Queue → Audit & Export**

The frontend is a prototype UI and uses Supabase for persistence when configured.

## Repository structure

```text
SETU/
├── config/          # Environment and scoring/validation thresholds
├── data/            # Synthetic benchmark inputs, aliases and generated outputs
├── database/        # PostgreSQL/Supabase schema and data-access layer
├── engine/          # Matching, scoring, validation and evaluation logic
├── frontend/        # React + TypeScript prototype
├── tests/           # Matching, validation, memory and persistence tests
├── docs/            # Benchmark and evaluator-facing technical notes
├── scripts/         # Convenience verification/evaluation scripts
├── requirements.txt
└── README.md
```

## Technical core

| Layer | Prototype implementation |
|---|---|
| Semantic matching | Sentence-Transformers (`all-MiniLM-L6-v2`) |
| Lexical matching | RapidFuzz |
| Context | Domain aliases, discipline and location |
| Persistence | Supabase PostgreSQL + pgvector |
| Planner workflow | React + TypeScript + Vite |
| Validation | Six deterministic project-control checks |
| Audit | Planner decision history + approved export |

The matching score combines semantic, fuzzy, discipline and location signals. Thresholds are configurable in `config/settings.py`.

## Evidence and limitations

- Synthetic datasets are included so the prototype can be reproduced without OIL data.
- The repository does **not** contain confidential OIL project data.
- The benchmark should not be presented as an OIL deployment result.
- Production deployment would require organization-controlled authentication, authorization/RLS, secrets management, integration testing and operational monitoring.

For detailed benchmark methodology and calibration results, see [docs/BENCHMARK.md](docs/BENCHMARK.md).