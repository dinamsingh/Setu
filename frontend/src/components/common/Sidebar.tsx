import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  CalendarClock, 
  CheckSquare, 
  FileSpreadsheet, 
  Database,
  Cpu
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const navItems = [
    {
      to: '/planner/command-center',
      label: 'Command Center',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      to: '/planner/review',
      label: 'Review Queue',
      icon: CheckSquare,
      badge: 'Hero',
    },
    {
      to: '/planner/onboarding',
      label: 'Schedule Onboarding',
      icon: CalendarClock,
      badge: null,
    },
    {
      to: '/planner/audit-export',
      label: 'Audit & Export',
      icon: FileSpreadsheet,
      badge: null,
    },
  ];

  return (
    <aside className="w-64 bg-setu-slate-900 text-setu-slate-300 border-r border-setu-slate-800 flex flex-col justify-between shrink-0 min-h-[calc(100vh-4rem)]">
      <div className="p-4 space-y-6">
        {/* Workspace Title */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-setu-slate-400">
            Workspace
          </div>
          <h2 className="text-sm font-semibold text-white mt-0.5">
            Lead Planner Portal
          </h2>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-setu-blue text-white shadow-sm'
                      : 'text-setu-slate-300 hover:bg-setu-slate-800 hover:text-white'
                  }`
                }
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-setu-teal text-white">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Baseline Status Card at bottom */}
      <div className="p-4 m-3 rounded-lg bg-setu-slate-800/80 border border-setu-slate-700/60 text-xs">
        <div className="flex items-center space-x-1.5 text-setu-blue-light font-semibold mb-1">
          <Database className="w-3.5 h-3.5" />
          <span>Active Baseline: v1.0</span>
        </div>
        <div className="space-y-1 text-setu-slate-400">
          <div className="flex justify-between">
            <span>Indexed Activities:</span>
            <span className="text-white font-medium">220</span>
          </div>
          <div className="flex justify-between">
            <span>Disciplines:</span>
            <span className="text-white font-medium">6</span>
          </div>
          <div className="flex items-center space-x-1 pt-1.5 border-t border-setu-slate-700 text-[11px] text-setu-green-light">
            <Cpu className="w-3 h-3" />
            <span>pgvector (384-dim) Ready</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
