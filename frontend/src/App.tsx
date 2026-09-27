import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RoleSelection } from './pages/RoleSelection';
import { FieldCapture } from './pages/supervisor/FieldCapture';
import { CommandCenter } from './pages/planner/CommandCenter';
import { ScheduleOnboarding } from './pages/planner/ScheduleOnboarding';
import { ReviewQueue } from './pages/planner/ReviewQueue';
import { AuditExport } from './pages/planner/AuditExport';
import { AuthProvider } from './lib/AuthContext';
import { ProtectedRoute } from './components/common/ProtectedRoute';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
        {/* Screen 1: Role Selection */}
        <Route path="/" element={<RoleSelection />} />

        <Route element={<ProtectedRoute roles={['site', 'engineer']} />}>
          <Route path="/supervisor/capture" element={<FieldCapture />} />
        </Route>

        <Route element={<ProtectedRoute roles={['planner', 'admin']} />}>
          <Route path="/planner/command-center" element={<CommandCenter />} />
          <Route path="/planner/onboarding" element={<ScheduleOnboarding />} />
          <Route path="/planner/review" element={<ReviewQueue />} />
          <Route path="/planner/audit-export" element={<AuditExport />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
