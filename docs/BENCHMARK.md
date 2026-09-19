# SETU Matching Engine & Validation Layer: Benchmark Evaluation Report

**Project:** SETU (SIH 2026, Problem Statement SIH26122)  
**Stakeholder:** Oil India Limited  
**Module:** Hybrid Schedule Matching Engine & 6-Check Project Controls Validation Layer  
**Phase:** Phase 4 Location-Aware Matching & Ambiguity Re-Calibration  
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
| **High Tier Top-1 Accuracy** | **100.0% (12 / 12)** | Reports meeting the $\ge 0.82$ confidence threshold achieve 100% exact match against ground truth. |
| **High Tier Top-3 Accuracy** | **100.0% (12 / 12)** | Ground-truth activity is present in top-3 candidates for 100% of auto-linked reports. |
| **Overall Top-1 Hit Rate** | **47.5% (19 / 40)** | Exact match across all confidence tiers (up from 40.0% prior to location scoring). |
| **Overall Top-3 Hit Rate** | **67.5% (27 / 40)** | Ground-truth activity present in top-3 candidates across all reports (up from 60.0%). |
| **Abstention Rate (Low Tier)** | **32.5% (13 / 40)** | Low-confidence or uncorroborated reports intentionally held for manual planner review. |
| **Ground-Truth Validation FP Rate** | **0.0% (0 / 30)** | Zero false-positive blocks across all 6 validation checks when evaluated on ground truth. |

---

## 2. Accuracy & Hit Rates Against Ground Truth

Evaluated against `benchmark_expected_act` across all 40 baseline reports under the calibrated Phase 4 formula:
$$\text{Score} = 0.40 \times \text{Semantic} + 0.30 \times \text{Fuzzy} + 0.10 \times \text{Discipline} + 0.20 \times \text{Location}$$

| Tier | Total Reports ($N$) | Top-1 Hits | Top-1 Accuracy (%) | Top-3 Hits | Top-3 Accuracy (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Overall** | **40** | **19** | **47.5%** | **27** | **67.5%** |
| **High** ($\ge 0.82$) | 12 | 12 | 100.0% | 12 | 100.0% |
| **Medium** ($[0.55, 0.82)$) | 15 | 7 | 46.7% | 14 | 93.3% |
| **Low** ($< 0.55$) | 13 | 0 | 0.0% | 1 | 7.7% |

---

## 3. Routing Confusion Matrix

Comparison between intended tier (derived from ground-truth column `benchmark_intent`) and engine-assigned confidence tier:

| Intended Intent \ Assigned Tier | High (Auto-Link) | Medium (Review) | Low (Unmatched) | Total Intended |
| :--- | :---: | :---: | :---: | :---: |
| **High** (`high_auto_link`) | **12** | 3 | 0 | 15 |
| **Medium** (`medium_planner_review`) | **0** | **12** | 3 | 15 |
| **Low** (`low_unmatched_review`) | **0** | 0 | **10** | 10 |
| **Total Assigned** | **12** | **15** | **13** | **40** |

### Key Observations:
1. **Zero Over-Confident Misroutes:** The entire lower-left quadrant is 0: ambiguous or unmatched updates are NEVER promoted to High auto-link.
2. **Safety Monotonicity:** Misclassifications are strictly conservative: 3 `high_auto_link` updates are held in Medium review; 3 `medium_planner_review` updates are held in Low unmatched queue.
3. **Disambiguation Gain:** Two previously ambiguous High candidates (`UPD-2026-005` Compressor Shed A and `UPD-2026-007` River Crossing C) now legitimately achieve High tier ($\ge 0.82$) with 100% accuracy due to 20% location discrimination.

---

## 4. Top-1 vs Top-2 Score Margin Distribution

Measured distribution of score difference between rank-1 and rank-2 candidates ($s_1 - s_2$):

| Statistic | Distorted Baseline (Pre-4.1) | Clean Baseline (Pre-4.4) | Phase 4 Location-Aware (Post-4.4) |
| :--- | :---: | :---: | :---: |
| **Count** | 40 | 40 | 40 |
| **Min** | 0.0000 | 0.0000 | **0.0001** |
| **P10** | 0.0006 | 0.0006 | **0.0013** |
| **P25** | 0.0025 | 0.0025 | **0.0040** |
| **Median (P50)** | **0.0056** | **0.0056** | **0.0093** *(+66%)* |
| **P75** | 0.0082 | 0.0082 | **0.1958** *(23.9x jump)* |
| **P90** | 0.0146 | 0.0146 | **0.2055** *(14.1x jump)* |
| **Max** | 0.0280 | 0.0280 | **0.2205** *(7.9x jump)* |
| **Mean $\pm$ Std** | $0.0068 \pm 0.0062$ | $0.0068 \pm 0.0062$ | $\mathbf{0.0779 \pm 0.0889}$ |

---

## 5. Candidate Ambiguity Threshold Sweep & Calibration

### Empirical Findings:
- **Correlation with Error:** Pearson correlation between score margin and wrong top-1 match jumped from **$-0.4310$** to **$-0.8222$**. With location scoring, near-ties are extremely strong indicators of genuine ambiguity.
- **Threshold Calibration:** `VALIDATION_AMBIGUITY_THRESHOLD = 0.008` remains optimal. At 0.008, precision against true errors reaches **94.7%** (18 true errors out of 19 flagged).
- **Target Case Resolution:**
  - **`UPD-2026-005` (Compressor Shed A vs Shed B):**
    - *Old (no location):* Top-1 `OIL-MEC-604-B` (0.8394) vs Top-2 `OIL-MEC-604-A` (0.8332), Margin = **0.0062** (Wrong match!).
    - *Phase 4 (location-aware):* Top-1 `OIL-MEC-604-A` (0.8490) vs Top-2 `OIL-MEC-604-B` (0.6533), Margin = **0.1957** (31.6x separation, Correct match!).
  - **`UPD-2026-003` (Section B KP 16-30 vs Section D):**
    - *Old:* Top candidates were Section D and A (0.7526 vs 0.7464, Margin = 0.0062).
    - *Phase 4:* Section B activities promoted to top ranks (~0.80), while Section D/A received location penalty (0.0). Margin widened to **0.0666**.

### Full Empirical Sweep Table:

| Margin Threshold | Flagged Reports | % of Baseline | True Positives (Wrong & Flagged) | False Positives (Correct & Flagged) | Precision | Recall |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **0.001** | 3 | 7.5% | 3 | 0 | 1.000 | 0.143 |
| **0.002** | 6 | 15.0% | 6 | 0 | 1.000 | 0.286 |
| **0.003** | 9 | 22.5% | 8 | 1 | 0.889 | 0.381 |
| **0.004** | 10 | 25.0% | 9 | 1 | 0.900 | 0.429 |
| **0.005** | 13 | 32.5% | 12 | 1 | 0.923 | 0.571 |
| **0.006** | 16 | 40.0% | 15 | 1 | 0.938 | 0.714 |
| **0.007** | 19 | 47.5% | 18 | 1 | 0.947 | 0.857 |
| **0.008** *(Calibrated)* | **19** (Raw) | **47.5%** | **18** | **1** | **0.947** | **0.857** |
| **0.010** | 20 | 50.0% | 18 | 2 | 0.900 | 0.857 |
| **0.015** | 21 | 52.5% | 19 | 2 | 0.905 | 0.905 |
| **0.020** | 21 | 52.5% | 19 | 2 | 0.905 | 0.905 |
| **0.030** | 21 | 52.5% | 19 | 2 | 0.905 | 0.905 |
| **0.050** *(Old Defect)* | 22 | 55.0% | 20 | 2 | 0.909 | 0.952 |

### Ambiguity Warning Categories Breakdown (19 Warnings):

| Ambiguity Type | Count | Percentage | Operational Meaning |
| :--- | :---: | :---: | :--- |
| **`wbs_sibling_location`** | 13 | 68.4% | Top candidates are sibling activities in the same WBS family differing by location qualifiers where the field report does not uniquely resolve location. |
| **`material_work_margin`** | 6 | 31.6% | Top candidates have close scores within the calibrated margin (margin < 0.008) across distinct scopes of work. |
| **Total Warnings** | **19** | **100.0%** | Reconciles exactly with 19 ambiguity warnings across 40 baseline reports. |

> [!NOTE]
> **Raw Sweep vs Narrowed Operational Filter:**  
> - **Raw Sweep:** Evaluates margin threshold across all 40 reports without WBS filtering. At 0.008 with location-aware scores, flags 19/40 (47.5%) with 94.7% precision.
> - **Narrowed Filter:** In production, candidate ambiguity only triggers when top-2 candidates belong to the same WBS family differing by location tokens that the report does not resolve. This eliminates false alarms on distinct tasks while preserving critical near-tie warnings.

---

## 6. Validation Status Evolution Across Project Phases

| Metric | Phase 2 (Defect) | Phase 3 (Distorted Baseline) | Phase 4 Clean Baseline | Phase 4 Location-Aware (Final) |
| :--- | :---: | :---: | :---: | :---: |
| **Formula Weights (Sem/Fuzz/Disc/Loc)** | 0.55/0.35/0.10/0.00 | 0.55/0.35/0.10/0.00 | 0.55/0.35/0.10/0.00 | **0.40/0.30/0.10/0.20** |
| **Ambiguity Threshold / Status** | 0.05 (Block) | 0.008 (Warn) | 0.008 (Warn) | **0.008 (Warn)** |
| **BLOCK Status Count** | 40 (100.0%) | 23 (57.5%) | 9 (22.5%) | **3 (7.5%)** |
| **PASS Status Count** | 0 (0.0%) | 8 (20.0%) | 16 (40.0%) | **20 (50.0%)** |
| **WARN Status Count** | 0 (0.0%) | 9 (22.5%) | 15 (37.5%) | **17 (42.5%)** |
| **Date Plausibility Fails** | 40 (100.0%) | 17 (42.5%) | 3 (7.5%) | **3 (7.5%)** *(0 on GT)* |
| **Location Consistency Fails** | - | 7 (17.5%) | 6 (15.0%) | **0 (0.0%)** *(0 on GT)* |
| **Overall Top-1 Hit Rate** | 40.0% | 40.0% | 40.0% | **47.5% (+7.5%)** |
| **High Tier Top-1 Hit Rate** | 90.0% | 90.0% | 90.0% | **100.0% (+10.0%)** |
| **High Tier Top-3 Hit Rate** | 100.0% | 100.0% | 100.0% | **100.0%** |
| **Over-Confident Misroutes** | 0 | 0 | 0 | **0 (Safety Invariant)** |

---

## 7. Per-Check Breakdown & Ground-Truth Validation Guard

Across all 40 baseline reports:

| Check Name | PASS | WARN | FAIL (BLOCK) | Failure Rate (%) | Ground-Truth Fails ($N=30$) | Ground-Truth FP Rate (%) | Guard Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`date_plausibility`** | 37 | 0 | 3 | 7.5% | **0** | **0.0%** | **PASS** ($\le 5.0\%$) |
| **`candidate_ambiguity`** | 21 | 19 | 0 | 0.0% (Warn) | **0** | **0.0%** | **PASS** |
| **`location_consistency`** | 40 | 0 | 0 | 0.0% | **0** | **0.0%** | **PASS** ($\le 5.0\%$) |
| **`duplicate_detection`** | 40 | 0 | 0 | 0.0% | **0** | **0.0%** | **PASS** ($\le 5.0\%$) |
| **`reporter_discipline`** | 38 | 2 | 0 | 0.0% (Warn) | **0** | **0.0%** | **PASS** ($\le 5.0\%$) |
| **`sequence_plausibility`** | 40 | 0 | 0 | 0.0% | **0** | **0.0%** | **PASS** ($\le 5.0\%$) |

*Master Guard Evaluation:*
- Maximum False Positive Rate on Verified Ground-Truth Links: **0.0%** (0 / 30).
- Permitted Threshold (`VALIDATION_MAX_GROUND_TRUTH_FP_RATE`): **5.0%**.
- Final Verdict: **COMPLIANT & PASSED**.
