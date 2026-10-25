import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RoleSelection } from './pages/RoleSelection';
import { FieldCapture } from './pages/supervisor/FieldCapture';
import { CommandCenter } from './pages/planner/CommandCenter';
import { ScheduleOnboarding } from './pages/planner/ScheduleOnboarding';
import { ReviewQueue } from './pages/planner/ReviewQueue';
import { AuditExport } from './pages/planner/AuditExport';
import { ScheduleActuals } from './pages/planner/ScheduleActuals';
import { AuthProvider } from './lib/AuthContext';
import { ProtectedRoute } from './components/common/ProtectedRoute';

/** Production authentication and all existing protected SETU routes. */
export const AuthenticatedApp: React.FC = () => (
  <AuthProvider>
    <Routes>
      <Route path="/" element={<RoleSelection />} />
      <Route element={<ProtectedRoute roles={['site', 'engineer']} />}>
        <Route path="/supervisor/capture" element={<FieldCapture />} />
      </Route>
      <Route element={<ProtectedRoute roles={['planner', 'admin']} />}>
        <Route path="/planner/command-center" element={<CommandCenter />} />
        <Route path="/planner/onboarding" element={<ScheduleOnboarding />} />
        <Route path="/planner/review" element={<ReviewQueue />} />
        <Route path="/planner/schedule-actuals" element={<ScheduleActuals />} />
        <Route path="/planner/audit-export" element={<AuditExport />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </AuthProvider>
);

export default AuthenticatedApp;
