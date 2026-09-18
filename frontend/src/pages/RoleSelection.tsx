import React from 'react';
import { useNavigate } from 'react-router-dom';
import { HardHat, ClipboardCheck, ArrowRight, Layers, ShieldCheck } from 'lucide-react';

export const RoleSelection: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col justify-between p-4 sm:p-8">
      {/* Top Brand Header */}
      <div className="max-w-4xl mx-auto w-full pt-6 pb-2 text-center">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-setu-navy text-white text-xs font-semibold mb-4 shadow-xs">
          <Layers className="w-4 h-4 text-setu-blue-light" />
          <span>SIH26122 · Oil India Limited</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-setu-navy tracking-tight">
          SETU
        </h1>
        <p className="text-xl sm:text-2xl font-bold text-setu-blue mt-2 tracking-tight">
          From field insight to planner-approved progress.
        </p>
        <p className="text-sm text-setu-slate-600 mt-2 max-w-xl mx-auto">
          Intelligent semantic linking bridging daily site contractor notes to Oracle Primavera P6 L5/L6 baseline activities.
        </p>
      </div>

      {/* Role Selection Cards */}
      <div className="max-w-4xl mx-auto w-full my-8">
        <div className="text-center mb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-setu-slate-500">
            Select Your Prototype Persona
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Site Supervisor */}
          <div
            onClick={() => navigate('/supervisor/capture')}
            className="group relative bg-white rounded-2xl border-2 border-setu-slate-200 p-8 shadow-xs hover:border-setu-teal hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-14 h-14 rounded-xl bg-teal-50 border border-teal-200 text-setu-teal flex items-center justify-center mb-5 group-hover:bg-setu-teal group-hover:text-white transition-colors">
                <HardHat className="w-7 h-7" />
              </div>
              <div className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-teal-100 text-teal-800 mb-2">
                Field Operations
              </div>
              <h2 className="text-2xl font-bold text-setu-slate-900 group-hover:text-setu-teal transition-colors">
                Site Supervisor
              </h2>
              <p className="text-sm font-semibold text-setu-slate-700 mt-1">
                Report progress naturally from the field.
              </p>
              <p className="text-xs text-setu-slate-500 mt-3 leading-relaxed">
                Log daily construction updates in plain conversational language. No manual WBS searching or Primavera P6 activity codes required.
              </p>
            </div>

            <div className="mt-8 pt-4 border-t border-setu-slate-100 flex items-center justify-between text-xs font-bold text-setu-teal group-hover:text-setu-teal-dark">
              <span>Enter Supervisor Mode</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Card 2: Lead Planner */}
          <div
            onClick={() => navigate('/planner/command-center')}
            className="group relative bg-white rounded-2xl border-2 border-setu-slate-200 p-8 shadow-xs hover:border-setu-blue hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="w-14 h-14 rounded-xl bg-blue-50 border border-blue-200 text-setu-blue flex items-center justify-center mb-5 group-hover:bg-setu-blue group-hover:text-white transition-colors">
                <ClipboardCheck className="w-7 h-7" />
              </div>
              <div className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 mb-2">
                Project Controls
              </div>
              <h2 className="text-2xl font-bold text-setu-slate-900 group-hover:text-setu-blue transition-colors">
                Lead Planner
              </h2>
              <p className="text-sm font-semibold text-setu-slate-700 mt-1">
                Review, control, and export schedule updates.
              </p>
              <p className="text-xs text-setu-slate-500 mt-3 leading-relaxed">
                Review AI-matched suggestions, inspect candidate rationale, approve or remap links, and download verified schedule diffs.
              </p>
            </div>

            <div className="mt-8 pt-4 border-t border-setu-slate-100 flex items-center justify-between text-xs font-bold text-setu-blue group-hover:text-setu-blue-dark">
              <span>Enter Planner Workspace</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      </div>

      {/* Footer Note */}
      <div className="max-w-2xl mx-auto text-center pb-4 text-xs text-setu-slate-500 flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-setu-slate-400" />
        <span>
          Prototype role simulation — production deployment would use organization SSO and role-based access control.
        </span>
      </div>
    </div>
  );
};
