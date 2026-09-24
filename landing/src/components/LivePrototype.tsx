
import { ArrowRight, Laptop } from 'lucide-react';

export default function LivePrototype() {
  const prototypeUrl = import.meta.env.VITE_PROTOTYPE_URL;

  return (
    <section id="prototype" className="py-24 bg-slate-50 border-t border-slate-200">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Laptop className="w-8 h-8 text-accent" />
        </div>
        
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-primary mb-4">
          Explore the working SETU prototype.
        </h2>
        
        <p className="text-lg text-slate-500 mb-10 max-w-2xl mx-auto leading-relaxed">
          See field-report ingestion, matching, validation and planner review using representative project data.
        </p>

        {prototypeUrl ? (
          <a 
            href={prototypeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center px-8 py-4 border border-transparent text-lg font-medium rounded-md text-white bg-primary hover:bg-slate-800 transition-colors shadow-sm"
          >
            Open SETU Prototype
            <ArrowRight className="ml-2 h-5 w-5" />
          </a>
        ) : (
          <div className="inline-flex flex-col items-center">
            <button disabled className="inline-flex items-center justify-center px-8 py-4 border border-slate-300 text-lg font-medium rounded-md text-slate-400 bg-slate-100 cursor-not-allowed">
              Prototype Unavailable
            </button>
            <span className="text-xs text-slate-500 mt-3">Prototype URL is currently not configured in the environment.</span>
          </div>
        )}
      </div>
    </section>
  );
}
