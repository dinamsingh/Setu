# SETU Matching Engine & Validation Layer: Benchmark Evaluation Report

**Project:** SETU (SIH 2026, Problem Statement SIH26122)  
**Stakeholder:** Oil India Limited  
**Module:** Hybrid Schedule Matching Engine & 6-Check Project Controls Validation Layer  
**Date:** September 2026  

---

> [!IMPORTANT]
> **Dataset Disclaimer & Benchmark Scope**  
> These benchmark results are measured strictly on a synthetic, self-labelled dataset comprising **40 field progress updates** and **220 Primavera P6 schedule activities** (`data/synthetic_field_updates.csv` and `data/synthetic_p6_schedule.csv`).  
> They represent an offline engineering calibration and regression baseline, **not an active operational field pilot result**.  
> This report contains **zero claims regarding cost savings, commercial ROI, or project time reduction**.

---

## 1. Executive Summary & Core Safety Metrics

| Metric | Measured Value | Operational Meaning |
| :--- | :--- | :--- |
| **Over-Confident Misroutes** | **0 / 40 (0.0%)** | Zero reports intended for planner review or unmatched queues were placed in High auto-link tier. |
| **High Tier Top-1 Accuracy** | **90.0% (9 / 10)** | Reports meeting the $\ge 0.82$ confidence threshold achieve 90% top-1 exact match. |
| **High Tier Top-3 Accuracy** | **100.0% (10 / 10)** | Ground-truth activity is in the top-3 candidate list for 100% of auto-linked reports. |
| **Overall Top-1 Hit Rate** | **40.0% (16 / 40)** | Exact match across all confidence tiers including ambiguous and completely unmatched reports. |
| **Overall Top-3 Hit Rate** | **60.0% (24 / 40)** | Ground-truth activity present in top-3 candidates across all reports. |
| **Abstention Rate (Low Tier)** | **37.5% (15 / 40)** | Low-confidence or uncorroborated reports intentionally held for manual planner review. |

---

## 2. Accuracy & Hit Rates Against Ground Truth

Evaluated against `benchmark_expected_act` across all 40 baseline reports:

| Tier | Total Reports ($N$) | Top-1 Hits | Top-1 Accuracy (%) | Top-3 Hits | Top-3 Accuracy (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Overall** | **40** | **16** | **40.0%** | **24** | **60.0%** |
| **High** ($\ge 0.82$) | 10 | 9 | 90.0% | 10 | 100.0% |
| **Medium** ($[0.55, 0.82)$) | 15 | 7 | 46.7% | 12 | 80.0% |
| **Low** ($< 0.55$) | 15 | 0 | 0.0% | 2 | 13.3% |

---

## 3. Routing Confusion Matrix

Comparison between intended tier (derived from ground-truth column `benchmark_intent`) and engine-assigned confidence tier:

| Intended Intent \ Assigned Tier | High (Auto-Link) | Medium (Review) | Low (Unmatched) | Total Intended |
| :--- | :---: | :---: | :---: | :---: |
| **High** (`high_auto_link`) | **10** | 5 | 0 | 15 |
| **Medium** (`medium_planner_review`) | **0** | **10** | 5 | 15 |
| **Low** (`low_unmatched_review`) | **0** | 0 | **10** | 10 |
| **Total Assigned** | **10** | **15** | **15** | **40** |

### Key Observations:
1. **Safety Monotonicity:** When the engine misclassifies tier, it errs strictly towards caution (e.g. 5 `high_auto_link` reports held in Medium; 5 `medium_planner_review` held in Low).
2. **Zero Over-Confident Misroutes:** The top-right cell and middle-left cell are 0: no ambiguous or unmatched update is ever promoted to High auto-link.

---

## 4. Top-1 vs Top-2 Score Margin Distribution

Measured distribution of score difference between rank-1 and rank-2 candidates ($s_1 - s_2$):

| Statistic | Value |
| :--- | :--- |
| **Count** | 40 |
| **Min** | 0.0000 |
| **10th Percentile (P10)** | 0.0006 |
| **25th Percentile (P25)** | 0.0025 |
| **Median (P50)** | **0.0056** |
| **75th Percentile (P75)** | 0.0082 |
| **90th Percentile (P90)** | 0.0146 |
| **Max** | 0.0280 |
| **Mean $\pm$ Std** | $0.0068 \pm 0.0062$ |

---

## 5. Candidate Ambiguity Threshold Sweep & Calibration

### Empirical Findings:
- **Correlation:** Pearson correlation between margin and actually wrong top-1 match is **$-0.4310$** (moderate negative correlation: smaller score margins correlate with higher error probability).
- **Previous Defect:** In Phase 2, threshold was set arbitrarily to `0.05`. Because the maximum margin in the entire 40-report dataset is `0.0280`, `40 / 40` reports failed candidate ambiguity, causing 100% `validation_status = 'block'`.
- **Calibration Action:**
  1. Softened outcome from `'fail'` (block) to `'warn'`. Near-ties warrant planner review, not automated refusal of work.
  2. Narrowed trigger to isolate sibling activities in the same WBS family differing only by location tokens where the field report text does not resolve which one.
  3. Calibrated threshold to **`0.008`** based on the sweep below:

| Margin Threshold | Flagged Reports | % of Baseline | True Positives (Wrong & Flagged) | False Positives (Correct & Flagged) | Precision | Recall |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **0.001** | 7 | 17.5% | 5 | 2 | 0.714 | 0.208 |
| **0.002** | 9 | 22.5% | 6 | 3 | 0.667 | 0.250 |
| **0.003** | 12 | 30.0% | 9 | 3 | 0.750 | 0.375 |
| **0.004** | 16 | 40.0% | 12 | 4 | 0.750 | 0.500 |
| **0.005** | 17 | 42.5% | 12 | 5 | 0.706 | 0.500 |
| **0.006** | 20 | 50.0% | 14 | 6 | 0.700 | 0.583 |
| **0.007** | 26 | 65.0% | 18 | 8 | 0.692 | 0.750 |
| **0.008** *(Chosen)* | **28** (Raw) / **9** (Narrowed) | **70.0%** (Raw) / **22.5%** (Narrowed) | **20** (Raw) / **8** (Narrowed) | **8** (Raw) / **1** (Narrowed) | **0.714** (Raw) / **0.889** (Narrowed) | **0.833** (Raw) / **0.333** (Narrowed) |
| **0.010** | 31 | 77.5% | 23 | 8 | 0.742 | 0.958 |
| **0.015** | 36 | 90.0% | 24 | 12 | 0.667 | 1.000 |
| **0.020** | 38 | 95.0% | 24 | 14 | 0.632 | 1.000 |
| **0.030** | 40 | 100.0% | 24 | 16 | 0.600 | 1.000 |
| **0.050** *(Defect)* | 40 | 100.0% | 24 | 16 | 0.600 | 1.000 |

*Justification for 0.008:* Combined with narrowed confusable-candidate filtering, threshold 0.008 flags 9 reports (22.5% of baseline), achieving **88.9% precision** (8 true errors / 1 false alarm) without overwhelming the reviewer or degenerating into a constant signal.

---

## 6. Validation Status Distribution: Before vs After Calibration

| Validation Status | Before Calibration (`thresh=0.05`, outcome `'fail'`) | After Calibration (`thresh=0.008`, outcome `'warn'`) | Change Rationale |
| :--- | :---: | :---: | :--- |
| **BLOCK** | **40 (100.0%)** | **23 (57.5%)** | Hard blocks strictly reserved for physically impossible dates (>60d late) and conflicting facilities. |
| **WARN** | **0 (0.0%)** | **10 (25.0%)** | Informs planner of near-tie sibling candidates or reporter discipline divergence without locking approval. |
| **PASS** | **0 (0.0%)** | **7 (17.5%)** | Clean, fully corroborated updates can proceed directly to standard approval. |

---

## 7. Per-Check Breakdown (Post-Calibration)

Across all 40 baseline reports, breakdown of outcomes for the 6 independent checks:

| Check Name | PASS | WARN | FAIL (BLOCK) | Failure Rate (%) |
| :--- | :---: | :---: | :---: | :---: |
| **`date_plausibility`** | 21 | 0 | 19 | 47.5% |
| **`candidate_ambiguity`** | 18 | 22 | 0 | 0.0% (Calibrated to Warn) |
| **`location_consistency`** | 33 | 0 | 7 | 17.5% |
| **`duplicate_detection`** | 40 | 0 | 0 | 0.0% |
| **`reporter_discipline`** | 38 | 2 | 0 | 0.0% (Soft Warning) |
| **`sequence_plausibility`** | 40 | 0 | 0 | 0.0% |

*Safety Guard Compliance:* No single check exceeds the maximum allowed 60% failure ceiling, ensuring that validation flags remain informative and differentiated.
