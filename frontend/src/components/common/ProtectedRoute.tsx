import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import type { UserRole } from '../types';

export function ProtectedRoute({ roles }: { roles?: Exclude<UserRole, null>[] }) {
  const { session, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-setu-slate-600">Checking session…</div>;
  }

  if (!session) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  if (!role) {
    return <div className="min-h-screen flex items-center justify-center p-6 text-center text-red-700">
      This account is authenticated but has no SETU role assignment. Ask an administrator to seed <code>user_roles</code>.
    </div>;
  }

  if (roles && !roles.includes(role)) {
    return <Navigate to={role === 'planner' || role === 'admin' ? '/planner/command-center' : '/supervisor/capture'} replace />;
  }

  return <Outlet />;
}