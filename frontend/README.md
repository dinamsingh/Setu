# SETU Frontend

React + TypeScript + Vite prototype for the SETU field-to-plan workflow.

## Stack
- React 19 + TypeScript
- Vite 8
- React Router 7
- Tailwind CSS
- Supabase client
- Lucide React
- Recharts
- PapaParse

## Run
```bash
npm install
npm run dev
```

Build and checks:
```bash
npm run build
npm run lint
npm test
```

## Demo routes
- `/` — role selection
- `/supervisor/capture` — field capture
- `/planner/command-center` — planner overview
- `/planner/onboarding` — read-only schedule onboarding
- `/planner/review` — planner review queue
- `/planner/audit-export` — audit trail and approved export

## Prototype boundary
The UI is a hackathon prototype. It uses synthetic/sample data unless configured against a Supabase instance. Production deployment requires organization-controlled authentication, authorization/RLS and operational security controls.