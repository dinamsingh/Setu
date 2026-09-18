"""Synthetic Primavera P6 L5/L6 Schedule Generator for Oil India Infrastructure Projects.

Generates realistic project activities with WBS codes, planned dates, disciplines,
and standard engineering descriptions matching SIH26122 requirements.
"""

import csv
from datetime import date, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = DATA_DIR / "synthetic_p6_schedule.csv"

# Pre-defined realistic engineering templates across disciplines
DISCIPLINE_TEMPLATES = {
    "Pipeline": [
        ("OIL-PLN-101", "Topographical Survey and Centerline Staking - Section {sec}", "1.1.1.{idx}", "MTR", 5000),
        ("OIL-PLN-102", "Right of Way (ROW) Clearing, Grubbing & Grading - Section {sec}", "1.1.2.{idx}", "MTR", 5000),
        ("OIL-PLN-103", "Line Pipe Hauling, Offloading and Stringing along ROW - KP {kp_start}-{kp_end}", "1.1.3.{idx}", "MTR", 3000),
        ("OIL-PLN-104", "Trench Excavation in Normal and Hard Soil Strata - KP {kp_start}-{kp_end}", "1.1.4.{idx}", "MTR", 3000),
        ("OIL-PLN-105", "Pipeline Cold Field Bending and Joint Fit-Up - KP {kp_start}-{kp_end}", "1.1.5.{idx}", "JOINTS", 120),
        ("OIL-PLN-106", "Mainline Pipe Welding by Semi-Automatic GMAW - KP {kp_start}-{kp_end}", "1.1.6.{idx}", "JOINTS", 120),
        ("OIL-PLN-107", "Non-Destructive Testing (NDT) 100% Radiography of Welds - KP {kp_start}-{kp_end}", "1.1.7.{idx}", "JOINTS", 120),
        ("OIL-PLN-108", "Field Joint Coating and Holiday Detection Testing - KP {kp_start}-{kp_end}", "1.1.8.{idx}", "JOINTS", 120),
        ("OIL-PLN-109", "Lowering of Coated Pipeline Section into Trench - KP {kp_start}-{kp_end}", "1.1.9.{idx}", "MTR", 3000),
        ("OIL-PLN-110", "Trench Padding, Backfilling and Soil Compaction - KP {kp_start}-{kp_end}", "1.1.10.{idx}", "MTR", 3000),
        ("OIL-PLN-111", "Horizontal Directional Drilling (HDD) River Crossing - Crossing {sec}", "1.1.11.{idx}", "MTR", 850),
        ("OIL-PLN-112", "Caliper and Gauging Pigging Run of Completed Section - Section {sec}", "1.1.12.{idx}", "SECT", 1),
        ("OIL-PLN-113", "Hydrostatic Pressure Testing of Mainline Pipe - KP {kp_start}-{kp_end}", "1.1.13.{idx}", "KM", 10),
    ],
    "Piping": [
        ("OIL-PIP-201", "Piping Spool Prefabrication at Field Workshop - Manifold {sec}", "1.2.1.{idx}", "IN-DIA", 450),
        ("OIL-PIP-202", "Piping Spool Erection and Field Fit-up - Manifold {sec}", "1.2.2.{idx}", "MTR", 250),
        ("OIL-PIP-203", "Golden Tie-In Welding at Existing Header Connection - Manifold {sec}", "1.2.3.{idx}", "JOINTS", 8),
        ("OIL-PIP-204", "Non-Destructive Testing (NDT) Radiography of Piping Welds - Line {sec}", "1.2.4.{idx}", "JOINTS", 45),
        ("OIL-PIP-205", "Hydrostatic Testing of Process Piping Manifold - Section {sec}", "1.2.5.{idx}", "LOOPS", 2),
        ("OIL-PIP-206", "Piping Flange Bolt Torquing and Tensioning Inspection - Skid {sec}", "1.2.6.{idx}", "JOINTS", 32),
        ("OIL-PIP-207", "Installation of Manual Gate, Globe and Check Valves - Section {sec}", "1.2.7.{idx}", "NOS", 16),
        ("OIL-PIP-208", "Pipe Support Erection, Clamping and Spring Hanger Setup - Area {sec}", "1.2.8.{idx}", "MT", 12),
        ("OIL-PIP-209", "Piping Line Cleaning, Flushing and Chemical Dewatering - Area {sec}", "1.2.9.{idx}", "MTR", 600),
        ("OIL-PIP-210", "Piping Line Insulation and Cladding Application - Header {sec}", "1.2.10.{idx}", "MTR", 300),
    ],
    "Civil": [
        ("OIL-CIV-301", "Site Grading, Leveling and Boundary Fencing - Location {sec}", "1.3.1.{idx}", "SQM", 4000),
        ("OIL-CIV-302", "Bulk Earth Excavation for Compressor Foundation - Area {sec}", "1.3.2.{idx}", "CUM", 800),
        ("OIL-CIV-303", "Plain Cement Concrete (PCC) Blinding Layer 1:4:8 - Foundation {sec}", "1.3.3.{idx}", "CUM", 120),
        ("OIL-CIV-304", "Reinforcement Steel Bar (Rebar) Cutting, Bending & Fixing - Foundation {sec}", "1.3.4.{idx}", "MT", 45),
        ("OIL-CIV-305", "Reinforced Cement Concrete (RCC) M30 Casting - Foundation {sec}", "1.3.5.{idx}", "CUM", 350),
        ("OIL-CIV-306", "Water Curing and Formwork Striking of Concrete - Block {sec}", "1.3.6.{idx}", "DAYS", 14),
        ("OIL-CIV-307", "Dyke Bund Wall Civil Construction around Crude Storage - Tank {sec}", "1.3.7.{idx}", "MTR", 220),
        ("OIL-CIV-308", "Construction of Concrete Valve Pit and Sump Pit - Station {sec}", "1.3.8.{idx}", "NOS", 4),
        ("OIL-CIV-309", "Pipe Rack Structural Pedestal Concrete Casting - Area {sec}", "1.3.9.{idx}", "NOS", 24),
    ],
    "Electrical": [
        ("OIL-ELE-401", "Installation of 33kV/415V Main Oil Field Stepdown Transformer - Substation {sec}", "1.4.1.{idx}", "NOS", 2),
        ("OIL-ELE-402", "Cable Tray Support Erection and Overhead Tray Laying - Rack {sec}", "1.4.2.{idx}", "MTR", 450),
        ("OIL-ELE-403", "High Tension (HT) Cable Pulling and Routing - Feeder {sec}", "1.4.3.{idx}", "MTR", 1200),
        ("OIL-ELE-404", "Low Tension (LT) Power & Control Cable Laying - MCC {sec}", "1.4.4.{idx}", "MTR", 1800),
        ("OIL-ELE-405", "Cable Glanding, Crimping and Terminal Lugging at Switchgear - Panel {sec}", "1.4.5.{idx}", "NOS", 64),
        ("OIL-ELE-406", "Chemical Earth Pit Drilling and Copper Earthing Grid Laying - Station {sec}", "1.4.6.{idx}", "PITS", 12),
        ("OIL-ELE-407", "Motor Control Center (MCC) Panel Alignment & Busbar Torquing - Room {sec}", "1.4.7.{idx}", "PANELS", 8),
        ("OIL-ELE-408", "Insulation Resistance (IR) Megger Testing of Feeder Cables - Feeder {sec}", "1.4.8.{idx}", "CIRCUITS", 18),
    ],
    "Instrumentation": [
        ("OIL-INS-501", "Installation of Remote Terminal Unit (RTU) & DCS PLC Control Panels - Control Room {sec}", "1.5.1.{idx}", "PANELS", 4),
        ("OIL-INS-502", "Instrument Multi-Pair Armored Signal Cable Laying - Loop {sec}", "1.5.2.{idx}", "MTR", 2200),
        ("OIL-INS-503", "Instrument Junction Box (JB) Termination and Glanding - Area {sec}", "1.5.3.{idx}", "NOS", 16),
        ("OIL-INS-504", "Bench Calibration of Pressure and Temperature Transmitters - Batch {sec}", "1.5.4.{idx}", "NOS", 35),
        ("OIL-INS-505", "Field Installation of Coriolis Flow Meters on Trunkline - Manifold {sec}", "1.5.5.{idx}", "NOS", 6),
        ("OIL-INS-506", "Instrument Impulse Line SS Tubing and Pressure Testing - Manifold {sec}", "1.5.6.{idx}", "MTR", 320),
        ("OIL-INS-507", "Emergency Shutdown Valve (ESDV) Stroke Testing and Calibration - Station {sec}", "1.5.7.{idx}", "NOS", 8),
        ("OIL-INS-508", "End-to-End DCS Loop Checking and Signal Verification - Loop {sec}", "1.5.8.{idx}", "LOOPS", 45),
    ],
    "Mechanical": [
        ("OIL-MEC-601", "Rigging and Erection of 3-Phase Test Separator Vessel - Area {sec}", "1.6.1.{idx}", "NOS", 1),
        ("OIL-MEC-602", "Flare Knockout Drum (KOD) Skidded Vessel Erection - Area {sec}", "1.6.2.{idx}", "NOS", 1),
        ("OIL-MEC-603", "Reciprocating Gas Compressor Skid Positioning and Rough Leveling - Shed {sec}", "1.6.3.{idx}", "SKIDS", 2),
        ("OIL-MEC-604", "Dial Gauge Cold and Hot Alignment of Compressor Motor Shaft - Shed {sec}", "1.6.4.{idx}", "UNITS", 2),
        ("OIL-MEC-605", "Non-Shrink Epoxy Grouting under Rotary Equipment Baseplates - Skid {sec}", "1.6.5.{idx}", "CUM", 8),
        ("OIL-MEC-606", "Centrifugal Crude Oil Dispatch Pump Skid Erection & Alignment - Station {sec}", "1.6.6.{idx}", "SKIDS", 3),
        ("OIL-MEC-607", "Air Fin Cooler Bundle Lifting and Structural Mounting - Rack {sec}", "1.6.7.{idx}", "BUNDLES", 4),
    ]
}


def generate_schedule():
    activities = []
    base_date = date(2026, 4, 1)
    
    # We will generate across multiple sectors/sub-areas to reach 100+ comprehensive activities
    sectors = ["A", "B", "C", "D"]
    
    act_counter = 1
    for disc, templates in DISCIPLINE_TEMPLATES.items():
        for t_code, t_desc, t_wbs, uom, qty in templates:
            for s_idx, sec in enumerate(sectors):
                # Unique Activity ID e.g. OIL-PIP-201-A
                activity_id = f"{t_code}-{sec}"
                kp_start = (s_idx * 15) + 1
                kp_end = kp_start + 15
                
                desc = t_desc.format(sec=sec, kp_start=kp_start, kp_end=kp_end)
                wbs_code = t_wbs.format(idx=s_idx + 1)
                
                # Realistic staggered dates across project execution
                start_offset = (act_counter * 3) % 120
                duration_days = 15 + ((act_counter * 7) % 35)
                start_date = base_date + timedelta(days=start_offset)
                finish_date = start_date + timedelta(days=duration_days)
                
                # Realistic planned progress % (staggered for current status)
                progress = round(float((act_counter * 13) % 100), 1)
                
                activities.append({
                    "activity_id": activity_id,
                    "activity_name": desc,
                    "discipline": disc,
                    "wbs_code": wbs_code,
                    "wbs_name": f"{disc} Execution Section {sec}",
                    "planned_start_date": start_date.isoformat(),
                    "planned_finish_date": finish_date.isoformat(),
                    "planned_progress_pct": progress,
                    "unit_of_measure": uom,
                    "planned_qty": qty
                })
                act_counter += 1

    # Save to CSV
    with open(OUTPUT_FILE, mode="w", newline="", encoding="utf-8") as f:
        fieldnames = [
            "activity_id", "activity_name", "discipline", "wbs_code",
            "wbs_name", "planned_start_date", "planned_finish_date",
            "planned_progress_pct", "unit_of_measure", "planned_qty"
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(activities)

    print(f"Generated {len(activities)} Primavera P6 schedule activities in {OUTPUT_FILE}")
    return len(activities)


if __name__ == "__main__":
    generate_schedule()
