import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  CalendarRange,
  ClipboardCheck,
  Database,
  FileCheck2,
  Gauge,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const primaryItems = [
    { to: '/planner/command-center', label: 'Control Room', icon: Gauge },
    { to: '/planner/review', label: 'Review Queue', icon: ClipboardCheck },
    { to: '/planner/schedule-actuals', label: 'Schedule Actuals', icon: CalendarRange },
    { to: '/planner/audit-export', label: 'Audit & Export', icon: FileCheck2 },
  ];

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 border-l-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue-light/50 ${
      isActive
        ? 'border-setu-blue-light bg-setu-slate-800 text-white'
        : 'border-transparent text-setu-slate-300 hover:border-setu-slate-500 hover:bg-setu-slate-800/70 hover:text-white'
    }`;

  return (
    <aside className="w-full shrink-0 border-b border-setu-slate-800 bg-setu-slate-900 text-setu-slate-300 md:min-h-[calc(100vh-4rem)] md:w-64 md:border-b-0 md:border-r">
      <div className="flex h-full flex-col p-3 md:p-4">
        <div className="hidden md:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-setu-slate-500">
            Planner workspace
          </div>
          <h2 className="mt-1 text-sm font-semibold text-white">Project controls</h2>
        </div>

        <nav aria-label="Planner workspace" className="mt-0 grid grid-cols-2 gap-1 md:mt-6 md:grid-cols-1">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-3 border-t border-setu-slate-800 pt-3 md:mt-auto">
          <div className="hidden px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-setu-slate-500 md:block">
            Project setup
          </div>
          <NavLink
            to="/planner/onboarding"
            className={({ isActive }) =>
              `mt-1 flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue-light/50 ${
                isActive
                  ? 'bg-setu-slate-800 text-white'
                  : 'text-setu-slate-400 hover:bg-setu-slate-800/70 hover:text-white'
              }`
            }
          >
            <Database className="h-3.5 w-3.5" />
            <span>Baseline index / CSV preview</span>
          </NavLink>
          <p className="hidden px-3 pt-2 text-[11px] leading-4 text-setu-slate-500 md:block">
            Schedule baseline stays read-only.
          </p>
        </div>
      </div>
    </aside>
  );
};
