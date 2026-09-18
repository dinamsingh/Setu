import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RoleSelection } from './pages/RoleSelection';
import { FieldCapture } from './pages/supervisor/FieldCapture';
import { CommandCenter } from './pages/planner/CommandCenter';
import { ScheduleOnboarding } from './pages/planner/ScheduleOnboarding';
import { ReviewQueue } from './pages/planner/ReviewQueue';
import { AuditExport } from './pages/planner/AuditExport';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Screen 1: Role Selection */}
        <Route path="/" element={<RoleSelection />} />

        {/* Screen 2: Supervisor Field Capture */}
        <Route path="/supervisor/capture" element={<FieldCapture />} />

        {/* Screen 3: Planner Command Center */}
        <Route path="/planner/command-center" element={<CommandCenter />} />

        {/* Screen 4: Schedule Onboarding */}
        <Route path="/planner/onboarding" element={<ScheduleOnboarding />} />

        {/* Screen 5: Planner Review Queue (Hero) */}
        <Route path="/planner/review" element={<ReviewQueue />} />

        {/* Screen 6: Audit Trail & Export */}
        <Route path="/planner/audit-export" element={<AuditExport />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
