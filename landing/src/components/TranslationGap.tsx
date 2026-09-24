
import { HardHat, CalendarDays, ArrowRightLeft } from 'lucide-react';

export default function TranslationGap() {
  return (
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-primary tracking-tight">
            Bridging the Translation Gap
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto font-medium">
            Translate execution language into planning language — without silently changing the baseline.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row items-center justify-between gap-8 lg:gap-4 max-w-5xl mx-auto">
          
          {/* Field Reality */}
          <div className="flex-1 w-full bg-slate-50 rounded-2xl p-8 border border-slate-200 shadow-sm relative">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600">
                <HardHat size={20} />
              </div>
              <h3 className="text-xl font-bold text-slate-800">Field Reality</h3>
            </div>
            
            <ul className="space-y-3">
              {['Text notes', 'Voice updates', 'Photos & evidence', 'Documents & sheets', 'Fragmented terminology', 'Delayed reporting'].map((item, i) => (
                <li key={i} className="flex items-center text-slate-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mr-3"></span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* SETU Bridge */}
          <div className="flex flex-col items-center justify-center py-4 lg:py-0 shrink-0 z-10 lg:-mx-8">
            <div className="w-20 h-20 bg-primary rounded-full flex flex-col items-center justify-center shadow-xl border-4 border-white">
              <span className="text-white font-bold text-lg tracking-tight">SETU</span>
            </div>
            <div className="hidden lg:flex w-full mt-4 justify-center items-center">
              <ArrowRightLeft className="text-slate-300 w-6 h-6" />
            </div>
          </div>

          {/* Planning Reality */}
          <div className="flex-1 w-full bg-slate-900 rounded-2xl p-8 shadow-sm relative">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-blue-400">
                <CalendarDays size={20} />
              </div>
              <h3 className="text-xl font-bold text-white">Planning Reality</h3>
            </div>
            
            <ul className="space-y-3">
              {['Structured activities', 'WBS (Work Breakdown)', 'Strict dates', 'Dependencies', 'Schedule logic', 'Project controls'].map((item, i) => (
                <li key={i} className="flex items-center text-slate-300 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-600 mr-3"></span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </section>
  );
}
