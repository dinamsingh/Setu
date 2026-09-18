# SETU Frontend — React + TypeScript Enterprise Web Application

Production-grade web application for **SETU: AI-Assisted Field-to-Plan Integration** (Smart India Hackathon 2026 · Problem Statement: SIH26122 · Oil India Limited).

---

## Tech Stack

- **Framework**: React 18+ with TypeScript & Vite
- **Routing**: React Router DOM (v6)
- **Database Client**: `@supabase/supabase-js` (direct PostgREST integration)
- **Styling**: Tailwind CSS (Enterprise Industrial Palette)
- **Icons**: Lucide React
- **Data Visualization**: Recharts
- **CSV Handling**: PapaParse

---

## Setup & Running Locally

### 1. Navigate to the Frontend Directory
```bash
cd frontend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
# Windows PowerShell
Copy-Item .env.example .env.local

# Linux / macOS
cp .env.example .env.local
```

Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are configured with your Supabase credentials.

### 4. Start Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### 5. Build for Production
```bash
npm run build
```

---

## Application Routes & Screens

1. `/` — **Role Selection**: Persona switcher between Site Supervisor and Lead Planner.
2. `/supervisor/capture` — **Supervisor Field Capture**: Form for logging free-text site progress notes directly into Supabase.
3. `/planner/command-center` — **Planner Command Center**: Executive KPI metrics, attention alerts, and confidence/discipline charts.
4. `/planner/onboarding` — **Schedule Onboarding**: Read-only baseline schedule inspector and CSV schema validator.
5. `/planner/review` — **Planner Review Queue (Hero Screen)**: Interactive review queue with "Why this match?" explainability expanders, and Accept / Remap / Reject planner controls.
6. `/planner/audit-export` — **Audit Trail & Controlled Export**: Immutable planner decision audit table and planner-approved schedule diff CSV download.
