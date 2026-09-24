# SETU — Evaluator Guide

## 60-second story

SETU converts field progress signals into **planner-reviewable, plan-linked suggestions**.

**Field input → Understand → Match → Validate → Planner approval → Approved export + institutional memory**

### What is actually implemented
- Hybrid schedule matching using domain aliases, RapidFuzz, Sentence-Transformers and location context.
- Confidence tiers and top-3 candidates.
- Six validation checks with pass/warn/block outcomes.
- Planner actions: accept, reject and remap.
- Audit records for planner decisions.
- Synthetic benchmark and reproducible evaluation harness.

### What is intentionally not claimed
- No OIL production deployment.
- No OIL confidential data.
- No production accuracy or ROI claim.
- No silent baseline modification.

## Demo order

1. Start the frontend.
2. Select **Site Supervisor** and submit a field progress report.
3. Switch to **Lead Planner**.
4. Open **Review Queue** and inspect the suggested activity and evidence.
5. Accept/remap/reject the suggestion.
6. Open **Audit & Export** to show traceability and the approved diff.

## Evidence map

| Claim | Evidence in repository |
|---|---|
| Hybrid matching | `engine/ensemble_matcher.py` |
| Semantic embeddings | `engine/embeddings.py` |
| Domain terminology | `data/domain_aliases.json`, `engine/alias_expander.py` |
| Validation | `engine/validators.py` |
| Institutional memory | `tests/test_institutional_memory.py` and planner flow |
| Synthetic benchmark | `data/` + `engine/evaluate.py` + `docs/BENCHMARK.md` |
| Planner audit | `database/schema.sql` + frontend Audit & Export screen |

## Reproducibility

`pytest tests/ -v` runs the automated test suite. `python engine/evaluate.py` regenerates the benchmark metrics from the synthetic fixtures.