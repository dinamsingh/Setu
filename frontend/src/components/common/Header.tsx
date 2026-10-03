import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layers, LogOut, UserCircle2 } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';

interface HeaderProps {
  currentRole?: 'supervisor' | 'planner';
}

export const Header: React.FC<HeaderProps> = ({ currentRole }) => {
  const navigate = useNavigate();
  const { user, role, signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      navigate('/');
    }
  };

  const roleLabel = role
    ? role === 'admin'
      ? 'Administrator'
      : role === 'planner'
      ? 'Lead Planner'
      : role === 'engineer'
      ? 'Field Engineer'
      : 'Site Supervisor'
    : currentRole === 'planner'
    ? 'Lead Planner'
    : 'Site Supervisor';

  return (
    <header className="sticky top-0 z-40 border-b border-setu-slate-700 bg-setu-navy text-white shadow-sm">
      <div className="mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            to="/"
            className="group flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-setu-blue-light/50"
          >
            <div className="flex h-9 w-9 items-center justify-center bg-setu-blue text-white transition-colors group-hover:bg-setu-blue-light">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-extrabold tracking-tight text-white">SETU</span>
                <span className="hidden border border-setu-slate-600 px-2 py-0.5 text-[11px] font-semibold text-setu-slate-200 sm:inline">
                  Oil India Limited
                </span>
              </div>
              <p className="hidden text-xs font-medium text-setu-slate-300 sm:block">
                Field evidence to project controls
              </p>
            </div>
          </Link>

          <div className="hidden border-l border-setu-slate-700 pl-4 text-[11px] text-setu-slate-400 lg:block">
            Prototype workspace · synthetic demonstration data
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 border border-setu-slate-700 bg-setu-navy-dark px-2.5 py-1.5 text-xs font-medium sm:px-3">
              <UserCircle2 className="h-4 w-4 shrink-0 text-setu-blue-light" />
              <div className="flex flex-col text-left">
                {user?.email && (
                  <span className="hidden max-w-[140px] truncate text-[10px] text-setu-slate-400 sm:block">
                    {user.email}
                  </span>
                )}
                <span className="font-semibold text-white">{roleLabel}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1.5 border border-setu-slate-600 bg-setu-slate-800 px-2.5 py-1.5 text-xs font-medium text-setu-slate-200 transition-colors hover:border-red-700 hover:bg-red-900/50 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-400/40"
              title="Sign out of SETU"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
