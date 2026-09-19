import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layers, ShieldAlert, LogOut, UserCircle2 } from 'lucide-react';
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
    <header className="bg-setu-navy text-white border-b border-setu-slate-700 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & Subtitle */}
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center space-x-2.5 group">
              <div className="w-9 h-9 rounded bg-setu-blue flex items-center justify-center font-bold text-white shadow-inner group-hover:bg-setu-blue-light transition-colors">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-extrabold text-xl tracking-tight text-white">SETU</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-setu-slate-800 text-setu-slate-300 border border-setu-slate-700">
                    SIH26122
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-setu-amber-dark text-white">
                    Oil India Limited
                  </span>
                </div>
                <p className="text-xs text-setu-slate-300 font-medium hidden sm:block">
                  AI-Assisted Field-to-Plan Integration
                </p>
              </div>
            </Link>
          </div>

          {/* Prototype Disclaimer Pill */}
          <div className="hidden md:flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-950/60 border border-amber-600/40 text-amber-200 text-xs font-medium">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>Illustrative synthetic data — prototype demonstration only.</span>
          </div>

          {/* User Session & Role & Sign Out */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 bg-setu-navy-dark px-3 py-1.5 rounded-md border border-setu-slate-700 text-xs font-medium">
              <UserCircle2 className="w-4 h-4 text-setu-blue-light" />
              <div className="flex flex-col text-left">
                {user?.email && (
                  <span className="text-[10px] text-setu-slate-400 truncate max-w-[140px]">
                    {user.email}
                  </span>
                )}
                <span className="text-white font-semibold">
                  {roleLabel}
                </span>
              </div>
            </div>

            <button
              onClick={handleSignOut}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-setu-slate-800 hover:bg-red-900/50 hover:text-red-200 text-setu-slate-200 border border-setu-slate-600 hover:border-red-700 transition-colors"
              title="Sign out of SETU"
            >
              <LogOut className="w-3.5 h-3.5 text-setu-blue-light group-hover:text-red-300" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
