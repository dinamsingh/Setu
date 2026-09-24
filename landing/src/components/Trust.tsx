
import { ShieldAlert, Check, X, Edit3, ArrowDown } from 'lucide-react';

export default function Trust() {
  return (
    <section className="py-24 bg-slate-50 border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-primary tracking-tight">
            Planner Stays In Control
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto font-medium">
            The system recommends and validates. Final schedule changes remain planner-controlled.
          </p>
        </div>

        <div className="max-w-3xl mx-auto">
          <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
            
            <div className="flex flex-col items-center">
              
              <div className="w-full max-w-md bg-slate-50 rounded-lg p-4 border border-slate-100 flex justify-between items-center">
                <span className="font-semibold text-slate-700">SETU Suggests</span>
                <span className="text-xs font-bold px-2 py-1 bg-blue-100 text-blue-700 rounded">92% Confidence</span>
              </div>
              
              <ArrowDown className="my-3 text-slate-300 w-5 h-5" />
              
              <div className="w-full max-w-md bg-slate-50 rounded-lg p-4 border border-slate-100 flex flex-col justify-center items-center">
                <span className="font-semibold text-slate-700">Evidence + Confidence</span>
                <span className="text-sm text-slate-500 mt-1">Photos, dates, extracted context</span>
              </div>
              
              <ArrowDown className="my-3 text-slate-300 w-5 h-5" />
              
              <div className="w-full max-w-md bg-primary rounded-lg p-4 border border-slate-800 flex justify-between items-center text-white shadow-md">
                <span className="font-semibold">Planner Reviews</span>
                <div className="flex space-x-2">
                  <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center"><Check size={16} className="text-green-400" /></div>
                  <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center"><Edit3 size={16} className="text-blue-400" /></div>
                  <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center"><X size={16} className="text-red-400" /></div>
                </div>
              </div>
              
              <ArrowDown className="my-3 text-slate-300 w-5 h-5" />
              
              <div className="w-full max-w-md bg-green-50 rounded-lg p-4 border border-green-200 flex justify-center items-center text-green-800">
                <span className="font-semibold">Traceable Update</span>
              </div>

            </div>

            <div className="mt-12 text-center">
              <div className="inline-flex items-center justify-center px-6 py-3 border-2 border-red-100 bg-red-50 text-red-700 rounded-full font-bold tracking-wide uppercase text-sm">
                <ShieldAlert className="w-5 h-5 mr-2 text-red-500" />
                No Direct Baseline Write
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
