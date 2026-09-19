"""Synthetic Field Update Report Generator for Oil India Infrastructure Projects.

Generates realistic noisy field text updates, Excel logs, and site supervisor notes
covering High-Confidence (Auto-Link), Medium-Confidence (Planner Review),
and Low-Confidence (Unmatched / Review Flag) categories.
"""

import csv
from datetime import date, timedelta
from pathlib import Path
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent
OUTPUT_CSV = DATA_DIR / "synthetic_field_updates.csv"
OUTPUT_XLSX = DATA_DIR / "synthetic_field_updates.xlsx"

# Diverse realistic field updates with expected benchmark categories
FIELD_REPORTS = [
    # --- HIGH CONFIDENCE CANDIDATES (Clear match via domain alias or strong semantic similarity) ---
    {
        "source_type": "whatsapp_log",
        "field_text": "Spool erection and field fit-up successfully finished at Manifold A today.",
        "reported_by": "Ramesh Borah (Piping Foreman)",
        "site_location": "Duliajan Manifold Area A",
        "benchmark_expected_act": "OIL-PIP-202-A",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "text",
        "field_text": "Completed right of way ROW clearing, grubbing & grading for Section B pipeline route.",
        "reported_by": "Diganta Saikia (Pipeline Engr)",
        "site_location": "Section B ROW",
        "benchmark_expected_act": "OIL-PLN-102-B",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "excel",
        "field_text": "100% NDT radiography testing carried out on all 12 weld joints at KP 16 to 30.",
        "reported_by": "Sunil Gogoi (QA/QC Inspector)",
        "site_location": "Section B KP 16-30",
        "benchmark_expected_act": "OIL-PLN-107-B",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "excel",
        "field_text": "High tension HT cable pulling and routing completed across Feeder C.",
        "reported_by": "Pranab Phukan (Elec Supervisor)",
        "site_location": "Substation Feeder C",
        "benchmark_expected_act": "OIL-ELE-403-C",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Dial gauge cold and hot alignment of compressor motor shaft finalized in Shed A.",
        "reported_by": "Ankur Barua (Mechanical Lead)",
        "site_location": "Compressor Shed A",
        "benchmark_expected_act": "OIL-MEC-604-A",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "text",
        "field_text": "Reinforcement steel bar rebar cutting, bending and fixing done for Foundation B.",
        "reported_by": "Manoj Chetia (Civil Foreman)",
        "site_location": "Compressor Foundation B",
        "benchmark_expected_act": "OIL-CIV-304-B",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "excel",
        "field_text": "Horizontal directional drilling HDD river crossing pulled through at Crossing C.",
        "reported_by": "Subhashish Roy (HDD Incharge)",
        "site_location": "River Crossing C",
        "benchmark_expected_act": "OIL-PLN-111-C",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Golden tie-in welding at existing header connection completed at Manifold D.",
        "reported_by": "Debojit Hazarika (Welding Sup)",
        "site_location": "Manifold D Header",
        "benchmark_expected_act": "OIL-PIP-203-D",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "excel",
        "field_text": "Bench calibration of pressure and temperature transmitters completed for Batch A.",
        "reported_by": "Nayan Moni (Inst Engineer)",
        "site_location": "Field Lab Batch A",
        "benchmark_expected_act": "OIL-INS-504-A",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "text",
        "field_text": "Installation of 33kV/415V main stepdown transformer completed in Substation A.",
        "reported_by": "Bhaskar Sarma (Elec Lead)",
        "site_location": "Main Substation A",
        "benchmark_expected_act": "OIL-ELE-401-A",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Trench padding, backfilling and soil compaction completed KP 31 to 45 Section C.",
        "reported_by": "Bikash Mech (Pipeline Sup)",
        "site_location": "Pipeline Section C",
        "benchmark_expected_act": "OIL-PLN-110-C",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "excel",
        "field_text": "Dyke bund wall civil construction around crude storage Tank B finished up to 2m height.",
        "reported_by": "Rohit Verma (Civil Engr)",
        "site_location": "Crude Tank Dyke B",
        "benchmark_expected_act": "OIL-CIV-307-B",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Emergency shutdown valve ESDV stroke testing and calibration carried out at Station D.",
        "reported_by": "Pankaj Kalita (Inst Tech)",
        "site_location": "ESDV Station D",
        "benchmark_expected_act": "OIL-INS-507-D",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "text",
        "field_text": "Flare knockout drum KOD skidded vessel erection placed on foundation at Area B.",
        "reported_by": "Tapan Dutta (Rigger Lead)",
        "site_location": "Flare Area B",
        "benchmark_expected_act": "OIL-MEC-602-B",
        "benchmark_intent": "high_auto_link"
    },
    {
        "source_type": "excel",
        "field_text": "Piping spool prefabrication at field workshop Manifold C 42 joints welded.",
        "reported_by": "Jyoti Lahon (Piping QC)",
        "site_location": "Yard Manifold C",
        "benchmark_expected_act": "OIL-PIP-201-C",
        "benchmark_intent": "high_auto_link"
    },

    # --- MEDIUM CONFIDENCE CANDIDATES (Ambiguous / partial phrasing / requires Planner Review) ---
    {
        "source_type": "whatsapp_log",
        "field_text": "Hydrotesting done today on line 3 section B, holding 95 bar pressure.",
        "reported_by": "Hiren Das (Site Incharge)",
        "site_location": "Section B Line 3",
        "benchmark_expected_act": "OIL-PIP-205-B",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "text",
        "field_text": "Lowering work completed today for pipeline near river bank area.",
        "reported_by": "Mukesh Tiwari (Lowering Sup)",
        "site_location": "River Bank Sector",
        "benchmark_expected_act": "OIL-PLN-109-A",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "excel",
        "field_text": "PCC layer poured for main compressor block, curing initiated.",
        "reported_by": "Amitabh Baruah (Civil Sup)",
        "site_location": "Compressor Block",
        "benchmark_expected_act": "OIL-CIV-303-A",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Cable tray fixing and cable laying ongoing along the overhead pipe rack.",
        "reported_by": "Kamal Baruah (Electrician)",
        "site_location": "Overhead Rack Area",
        "benchmark_expected_act": "OIL-ELE-402-A",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "excel",
        "field_text": "Chemical copper earthing pit digging and backfilling with compound completed.",
        "reported_by": "Bipul Sharma (Elec Contractor)",
        "site_location": "Grid Substation",
        "benchmark_expected_act": "OIL-ELE-406-B",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "text",
        "field_text": "Golden tie-in joint welded at header junction, visual check passed.",
        "reported_by": "Gaurav Singh (Welding Inspector)",
        "site_location": "Junction Skid",
        "benchmark_expected_act": "OIL-PIP-203-A",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Valve pit wall concrete casted today, 18 cum consumed.",
        "reported_by": "Jiten Deka (Civil Supervisor)",
        "site_location": "Station Valve Pit",
        "benchmark_expected_act": "OIL-CIV-308-C",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "excel",
        "field_text": "Gas compressor skid positioned on foundation bolts with 50 ton crane.",
        "reported_by": "Sanjib Bora (Heavy Rigging)",
        "site_location": "Compressor Shed D",
        "benchmark_expected_act": "OIL-MEC-603-D",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "DCS instrument signal checking in progress with control room engineer.",
        "reported_by": "Anil Sonowal (Automation Engr)",
        "site_location": "Control Room Loop",
        "benchmark_expected_act": "OIL-INS-508-B",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "text",
        "field_text": "Flange bolt torquing and tensioning inspection completed on main skid.",
        "reported_by": "Kishore Nath (Mechanical Foreman)",
        "site_location": "Main Skid Manifold",
        "benchmark_expected_act": "OIL-PIP-206-A",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Stringing of 14-inch coated pipes done for 85 joints along right of way.",
        "reported_by": "Suraj Tamang (Pipe Hauler)",
        "site_location": "ROW Chainage 12",
        "benchmark_expected_act": "OIL-PLN-103-A",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "excel",
        "field_text": "Non-shrink epoxy grouting poured below dispatch pump baseplate.",
        "reported_by": "Dipen Borpatra (Pump Station Lead)",
        "site_location": "Pump Shed B",
        "benchmark_expected_act": "OIL-MEC-605-B",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "RTU panel installed and terminal wiring connected in local shelter.",
        "reported_by": "Ashim Bhattacharya (SCADA Eng)",
        "site_location": "RTU Shelter C",
        "benchmark_expected_act": "OIL-INS-501-C",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "text",
        "field_text": "Pigging run tool launched and retrieved successfully with zero damage to cup.",
        "reported_by": "Ranjit Moran (Pipeline Operator)",
        "site_location": "Pig Receiver Station B",
        "benchmark_expected_act": "OIL-PLN-112-B",
        "benchmark_intent": "medium_planner_review"
    },
    {
        "source_type": "excel",
        "field_text": "Formwork and water curing of concrete block completed, 14 days finished.",
        "reported_by": "Rajib Borgohain (Civil QC)",
        "site_location": "Block C Foundation",
        "benchmark_expected_act": "OIL-CIV-306-C",
        "benchmark_intent": "medium_planner_review"
    },

    # --- LOW CONFIDENCE / UNMATCHED CANDIDATES (Casual logs, weather delays, notes - Never dropped!) ---
    {
        "source_type": "whatsapp_log",
        "field_text": "Continuous heavy torrential rain since 9 AM, site completely waterlogged, civil work suspended.",
        "reported_by": "Site Incharge Office",
        "site_location": "All Sectors",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Daily safety toolbox meeting conducted with 45 workers regarding working at height and PPE.",
        "reported_by": "HSE Officer Dibrugarh",
        "site_location": "Safety Muster Point",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "text",
        "field_text": "Site DG generator 250 kVA fuel tank filled with 800 liters diesel, oil filter replaced.",
        "reported_by": "Utility Mechanic",
        "site_location": "DG Yard",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "excel",
        "field_text": "Local village panchayat delegation visited site regarding culvert crossing access road.",
        "reported_by": "Liaison Officer",
        "site_location": "Village Approach Gate",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Hydraulic excavator CAT 320 broken down due to blown oil hose, mechanic team dispatched.",
        "reported_by": "Equipment Store Incharge",
        "site_location": "KP 22 Workshop",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "text",
        "field_text": "Catering and drinking water delivery received for night shift crew.",
        "reported_by": "Camp Administrator",
        "site_location": "Base Camp Mess",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "excel",
        "field_text": "Third party ISO audit team completed documentation review in admin building.",
        "reported_by": "QA Auditor",
        "site_location": "Conference Hall",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Forest department ranger conducted joint boundary pillar verification.",
        "reported_by": "Survey Team 2",
        "site_location": "Reserve Forest Boundary",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "text",
        "field_text": "Site perimeter floodlights bulb replacement completed on Mast 4.",
        "reported_by": "Maintenance Electrician",
        "site_location": "Perimeter Mast 4",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    },
    {
        "source_type": "whatsapp_log",
        "field_text": "Scaffolding dismantled from administrative building stairwell.",
        "reported_by": "General Labor Gang",
        "site_location": "Admin Building",
        "benchmark_expected_act": None,
        "benchmark_intent": "low_unmatched_review"
    }
]


def generate_field_updates():
    p6_csv = DATA_DIR / "synthetic_p6_schedule.csv"
    p6_df = pd.read_csv(p6_csv)
    p6_map = {row["activity_id"]: row for _, row in p6_df.iterrows()}
    
    completion_keywords = ["completed", "finished", "finalized", "done", "pulled through", "poured"]
    unmatched_base = date(2026, 5, 1)
    rows = []
    
    for idx, rep in enumerate(FIELD_REPORTS, start=1):
        exp_act = rep["benchmark_expected_act"]
        if exp_act and exp_act in p6_map:
            act_info = p6_map[exp_act]
            p_start = date.fromisoformat(act_info["planned_start_date"])
            p_finish = date.fromisoformat(act_info["planned_finish_date"])
            text_lower = rep["field_text"].lower()
            if any(k in text_lower for k in completion_keywords):
                # Completion claim: within 3 days of planned_finish_date (not before p_start)
                offset = (idx % 3)
                rep_date = min(p_finish, max(p_start, p_finish - timedelta(days=offset)))
            else:
                # Ongoing / progress claim: between planned_start_date and planned_finish_date
                offset = (idx % 5) + 1
                rep_date = min(p_finish, p_start + timedelta(days=offset))
        else:
            # Unmatched reports spread across the project calendar
            rep_date = unmatched_base + timedelta(days=(idx * 7) % 90)
            
        rows.append({
            "update_id": f"UPD-2026-{idx:03d}",
            "reported_date": rep_date.isoformat(),
            "source_type": rep["source_type"],
            "field_text": rep["field_text"],
            "site_location": rep["site_location"],
            "reported_by": rep["reported_by"],
            "benchmark_expected_act": rep["benchmark_expected_act"] or "UNMATCHED",
            "benchmark_intent": rep["benchmark_intent"]
        })
        
    df = pd.DataFrame(rows)
    
    # Save CSV
    df.to_csv(OUTPUT_CSV, index=False, encoding="utf-8")
    print(f"Generated {len(df)} field updates in {OUTPUT_CSV}")
    
    # Save Excel
    df.to_excel(OUTPUT_XLSX, index=False, engine="openpyxl")
    print(f"Generated Excel workbook in {OUTPUT_XLSX}")
    
    return len(df)


# ---------------------------------------------------------------------------
# Independent Synthetic Validation Fixtures (Phase 2 Project Controls)
# Kept separate from FIELD_REPORTS so original 40 baseline reports and the
# 10/15/15 tier distribution test remain strictly intact.
# ---------------------------------------------------------------------------
VALIDATION_FIXTURES = [
    {
        "fixture_id": "VAL-DATE-BLOCK-001",
        "name": "Date Implausibility (Early Start Block)",
        "source_type": "text",
        "field_text": "Spool erection and field fit-up successfully finished at Manifold A today.",
        "reported_by": "Ramesh Borah (Piping Foreman)",
        "site_location": "Duliajan Manifold Area A",
        "reported_date": "2024-01-10",
        "expected_check": "date_plausibility",
        "expected_validation_status": "block",
        "expected_confidence_level": "High",
        "description": "High confidence link blocked due to completion claimed 2.5 years before planned start."
    },
    {
        "fixture_id": "VAL-AMBIG-BLOCK-002",
        "name": "Candidate Ambiguity Block",
        "source_type": "text",
        "field_text": "Box-up work completed at Manifold B",
        "reported_by": "Ramesh Borah (Piping Foreman)",
        "site_location": "Manifold B",
        "reported_date": "2026-06-20",
        "expected_check": "candidate_ambiguity",
        "expected_validation_status": "block",
        "expected_confidence_level": "High",
        "description": "High confidence match where top 2 candidates differ by margin < 0.05."
    },
    {
        "fixture_id": "VAL-LOC-BLOCK-003",
        "name": "Location Conflict Block",
        "source_type": "text",
        "field_text": "Piping spool erection and field fit-up work completed at Manifold B",
        "reported_by": "Ramesh Borah (Piping Foreman)",
        "site_location": "Manifold B Area",
        "reported_date": "2026-06-20",
        "target_activity_id": "OIL-PIP-202-A",
        "expected_check": "location_consistency",
        "expected_validation_status": "block",
        "description": "Report states Manifold B while target activity is Manifold A."
    },
    {
        "fixture_id": "VAL-DISC-WARN-004",
        "name": "Cross-Discipline Warning",
        "source_type": "text",
        "field_text": "High tension HT cable pulling and routing completed across Feeder C.",
        "reported_by": "Manoj Chetia (Civil Foreman)",
        "site_location": "Substation Feeder C",
        "reported_date": "2026-06-20",
        "target_activity_id": "OIL-ELE-403-C",
        "expected_check": "reporter_discipline",
        "expected_validation_status": "warn",
        "description": "Civil foreman reporting electrical cable work raises cross-discipline warning."
    }
]


def generate_validation_fixtures():
    """Generates synthetic validation fixtures JSON file for demo and automated tests."""
    val_file = DATA_DIR / "validation_fixtures.json"
    import json
    with open(val_file, "w", encoding="utf-8") as f:
        json.dump(VALIDATION_FIXTURES, f, indent=2)
    print(f"Generated {len(VALIDATION_FIXTURES)} validation fixtures in {val_file}")
    return val_file


if __name__ == "__main__":
    generate_field_updates()
    generate_validation_fixtures()
