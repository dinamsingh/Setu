
import { Database, RefreshCw, Layers } from 'lucide-react';

export default function InstitutionalMemory() {
  return (
    <section className="py-24 bg-white border-t border-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-primary tracking-tight">
            Institutional Memory
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto font-medium">
            Every reviewed update improves the next cycle.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mb-20 max-w-5xl mx-auto">
          <div className="bg-slate-50 p-8 rounded-2xl border border-slate-100 transition-colors hover:border-slate-300">
            <Database className="w-8 h-8 text-slate-700 mb-6" />
            <h3 className="text-lg font-bold text-slate-800 mb-4">STORE</h3>
            <ul className="space-y-2 text-slate-600 text-sm font-medium">
              <li>• Validated mappings</li>
              <li>• Planner corrections</li>
              <li>• Execution patterns</li>
              <li>• Evidence metadata</li>
            </ul>
          </div>
          
          <div className="bg-slate-50 p-8 rounded-2xl border border-slate-100 transition-colors hover:border-slate-300">
            <RefreshCw className="w-8 h-8 text-accent mb-6" />
            <h3 className="text-lg font-bold text-slate-800 mb-4">LEARN</h3>
            <ul className="space-y-2 text-slate-600 text-sm font-medium">
              <li>• Improve matching accuracy</li>
              <li>• Learn project terminology</li>
              <li>• Adapt to specific patterns</li>
            </ul>
          </div>

          <div className="bg-slate-50 p-8 rounded-2xl border border-slate-100 transition-colors hover:border-slate-300">
            <Layers className="w-8 h-8 text-success mb-6" />
            <h3 className="text-lg font-bold text-slate-800 mb-4">REUSE</h3>
            <ul className="space-y-2 text-slate-600 text-sm font-medium">
              <li>• Across project packages</li>
              <li>• Across entire projects</li>
              <li>• Faster team onboarding</li>
              <li>• Historical planning</li>
            </ul>
          </div>
        </div>

        {/* Subtle loop visualization */}
        <div className="max-w-4xl mx-auto hidden md:block">
          <div className="flex items-center justify-between relative">
            <div className="absolute left-10 right-10 top-1/2 h-px bg-slate-200 -z-10 border-t border-dashed border-slate-300"></div>
            
            <div className="bg-white px-4">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Planner Review</div>
            </div>
            <div className="bg-white px-4">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Verified Mapping</div>
            </div>
            <div className="bg-white px-4">
              <div className="text-xs font-bold text-primary uppercase tracking-wider text-center bg-slate-100 py-1 px-3 rounded">Inst. Memory</div>
            </div>
            <div className="bg-white px-4">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Better Matching</div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
