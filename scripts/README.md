# SETU Evidence and Verification Scripts

This directory contains standalone, reproducible evidence scripts that verify the core engineering guarantees of **SETU (PS SIH26122 - Oil India Limited, SIH 2026)**.

All scripts run without external services using the deterministic offline mock database (`LocalMockDatabase`) and standard Python environment.

---

## Script Catalog

### 1. `scripts/verify_learning_loop.py` — Reviewed Institutional Memory Loop (Phase 1)
**What it proves:**
- **Step 1 (Cold Start):** Unrecognized field jargon (*"Box-up work completed at Manifold B"*) correctly routes to the **Low** tier / Unmatched queue rather than fabricating a false match.
- **Step 2 (Quarantine Guarantee):** When a planner proposes an alias (*"box-up" -> "Piping Spool Erection..."*), it is stored in the database with status `'proposed'`. Subsequent field updates with identical wording remain quarantined in the Low tier. **Unreviewed knowledge never automatically enters production.**
- **Step 3 (Human Governance):** A human reviewer approves the alias, updating its status to `'verified'` and triggering hot-reloading into the matching engine.
- **Step 4 (Closed-Loop Improvement):** A new field update with the same phrasing is automatically recognized, matching at the **High/Medium** tier with the verified alias explicitly cited in `applied_aliases`.

**How to run:**
```bash
python scripts/verify_learning_loop.py
```

---

### 2. `scripts/verify_validation_block.py` — 6-Check Validation Layer & Planner Override (Phases 2 & 3)
**What it proves:**
- **Scenario 1 (Plausible Report):** Clean updates with matching disciplines, dates within window, and correct locations pass all 6 checks (`validation_status = 'pass'`).
- **Scenario 2 (Temporal Violation):** Reports claiming progress >60 days after planned finish are blocked (`validation_status = 'block'`, outcome = `'fail'`).
- **Scenario 3 (Location Conflict):** Reports citing conflicting facilities (e.g. Manifold D work matched to a Manifold A activity) are blocked (`validation_status = 'block'`, outcome = `'fail'`).
- **Scenario 4 (Candidate Ambiguity Calibration):** Sibling location variants with close similarity scores trigger calibrated warnings (`outcome = 'warn'`), keeping project controls informative without creating a degenerate 100% block signal.
- **Scenario 5 (Planner Override):** Blocked or ambiguous suggestions cannot be approved without a justification. Providing a non-empty rationale writes a tamper-evident audit record to `planner_audit_logs` and transitions the report to approved/remapped.

**How to run:**
```bash
python scripts/verify_validation_block.py
```

---

### 3. `scripts/run_evaluation.py` — Full Benchmark Evaluation Harness (Phase 3)
**What it proves:**
- Computes empirical metrics against ground truth across all 40 baseline reports:
  - **Top-1 / Top-3 Hit Rates:** Overall (40.0% / 60.0%) and High Tier (90.0% / 100.0%).
  - **Routing Confusion Matrix:** Intended tier vs engine-assigned tier.
  - **Core Safety Metric:** **0 Over-Confident Misroutes** (no ambiguous/unmatched report placed in High).
  - **Abstention Rate:** 37.5% routed to Low tier for planner review.
  - **Margin Distribution & Ambiguity Calibration:** Full percentile sweep and correlation analysis.
  - **Validation Status Distribution:** Verifies healthy spread (Block 57.5%, Pass 17.5%, Warn 25.0%) with no single check dominating >60%.
- Exports machine-readable baseline to `data/baseline_metrics.json`.

**How to run:**
```bash
python scripts/run_evaluation.py
# Or output raw JSON:
python scripts/run_evaluation.py --json
```

---

## Reproducibility Requirements
- Python 3.10+
- Dependencies: `pandas`, `numpy`, `rapidfuzz`, `sentence-transformers`, `torch`
- No live Supabase connection or API keys required (uses offline mock database fallback automatically).
