import { Maximize2, ShieldCheck, Database, Layers } from 'lucide-react';

export default function ProductScreenshot() {
  return (
    <section className="py-24 bg-slate-900 border-t border-slate-800 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Designed for the Planner
          </h2>
          <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto font-medium">
            A comprehensive view of field progress, AI confidence, and validation status.
          </p>
        </div>

        <div className="relative max-w-5xl mx-auto">
          {/* Decorative glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 bg-blue-500/20 rounded-full blur-[100px] pointer-events-none"></div>

          {/* Browser / App Window Mockup */}
          <div className="relative bg-slate-950 rounded-xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[600px] z-10">
            {/* App Header */}
            <div className="h-12 bg-slate-900 border-b border-slate-800 flex items-center px-4 justify-between shrink-0">
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-slate-700"></div>
                <div className="w-3 h-3 rounded-full bg-slate-700"></div>
                <div className="w-3 h-3 rounded-full bg-slate-700"></div>
              </div>
              <div className="text-xs font-bold text-slate-400 tracking-wider">SETU / WBS-4.2.1-WELDING</div>
              <div className="text-slate-500"><Maximize2 size={14} /></div>
            </div>

            {/* App Body */}
            <div className="flex-1 flex overflow-hidden">
              {/* Sidebar */}
              <div className="w-64 bg-slate-900/50 border-r border-slate-800 p-4 hidden md:block">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Field Reports</div>
                <div className="space-y-2">
                  <div className="p-3 bg-slate-800 rounded-lg border border-slate-700">
                    <div className="text-sm font-semibold text-slate-200">Weld Log #892</div>
                    <div className="text-xs text-slate-400 mt-1">Today, 14:30</div>
                  </div>
                  <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-800 opacity-70">
                    <div className="text-sm font-semibold text-slate-400">Civil Inspection</div>
                    <div className="text-xs text-slate-500 mt-1">Yesterday, 09:15</div>
                  </div>
                </div>
              </div>

              {/* Main Content */}
              <div className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto bg-[#0B1120]">
                {/* Header */}
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold text-slate-200">Pipeline Welding - Section B</h3>
                    <p className="text-sm text-slate-400 mt-1">Mapped from: "Completed 45 joints on main pipeline section B today."</p>
                  </div>
                  <div className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-center">
                    <span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span>
                    <span className="text-xs font-bold text-blue-400">92% Match Confidence</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Validation State */}
                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
                    <div className="flex items-center text-slate-300 mb-4 font-semibold">
                      <ShieldCheck className="w-4 h-4 mr-2 text-green-500" />
                      Validation Checks
                    </div>
                    <ul className="space-y-3 text-sm">
                      <li className="flex justify-between text-slate-400"><span className="text-slate-500">Date Logic</span> <span className="text-green-400">Passed</span></li>
                      <li className="flex justify-between text-slate-400"><span className="text-slate-500">Scope Limit</span> <span className="text-green-400">Passed</span></li>
                      <li className="flex justify-between text-slate-400"><span className="text-slate-500">Evidence</span> <span className="text-yellow-400">Needs Review</span></li>
                    </ul>
                  </div>

                  {/* Institutional Memory */}
                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <Database className="w-24 h-24" />
                    </div>
                    <div className="flex items-center text-slate-300 mb-4 font-semibold relative z-10">
                      <Layers className="w-4 h-4 mr-2 text-purple-500" />
                      Institutional Memory
                    </div>
                    <p className="text-sm text-slate-400 relative z-10">
                      Historically, "joints" in this context map to "Weld Count" in P6. 
                      Planner approved this mapping 4 times previously.
                    </p>
                  </div>
                </div>

                {/* Planner Review Action */}
                <div className="mt-auto p-4 bg-slate-800/50 border border-slate-700 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-200">Proposed Schedule Update</div>
                    <div className="text-xs text-slate-400 mt-1">Actual Start: 24-Sep-2026 | Physical % Complete: 45%</div>
                  </div>
                  <div className="flex space-x-3">
                    <button className="px-4 py-2 bg-slate-700 text-white text-sm font-semibold rounded hover:bg-slate-600 transition-colors">Edit</button>
                    <button className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-500 transition-colors">Approve to P6</button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
