
import { ArrowRight, Play, Database, CheckCircle2, ChevronRight } from 'lucide-react';

export default function Hero() {
  return (
    <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          
          {/* Left Content */}
          <div className="max-w-2xl">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold tracking-wide uppercase mb-6 border border-slate-200">
              <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
              <span>Smart Automation for Plan-Field Integration</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-primary mb-4">
              SETU
            </h1>
            
            <p className="text-lg md:text-xl font-medium text-slate-500 mb-6 tracking-wide">
              Schedule <span className="mx-2">•</span> 
              Execution <span className="mx-2">•</span> 
              Tracking <span className="mx-2">•</span> 
              Unification
            </p>
            
            <h2 className="text-3xl md:text-4xl font-semibold text-primary mb-6 leading-tight">
              From the field’s voice <br className="hidden md:block"/> to the plan’s truth.
            </h2>
            
            <p className="text-lg text-slate-600 mb-10 max-w-xl leading-relaxed">
              SETU connects field progress reports with structured project schedules, turning fragmented execution updates into validated, traceable planning signals.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <a href="#demo" className="inline-flex items-center justify-center px-6 py-3.5 border border-transparent text-base font-medium rounded-md text-white bg-primary hover:bg-slate-800 transition-colors w-full sm:w-auto shadow-sm">
                <Play className="mr-2 -ml-1 h-5 w-5" />
                Watch Demo
              </a>
              
              <div className="flex flex-col items-center sm:items-start w-full sm:w-auto mt-2 sm:mt-0">
                <a href={import.meta.env.VITE_PROTOTYPE_URL || '#prototype'} className="inline-flex items-center justify-center px-6 py-3.5 border border-slate-300 text-base font-medium rounded-md text-primary bg-white hover:bg-slate-50 transition-colors w-full sm:w-auto shadow-sm">
                  Open Prototype
                  <ArrowRight className="ml-2 -mr-1 h-5 w-5 text-slate-400" />
                </a>
                <span className="text-xs text-slate-500 mt-2 font-medium">Working prototype • representative data</span>
              </div>
            </div>
          </div>

          {/* Right Visual */}
          <div className="relative lg:ml-auto w-full max-w-lg lg:max-w-none xl:w-[110%] mt-12 lg:mt-0">
            {/* Background Image Container */}
            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl border border-slate-200">
              <div className="absolute inset-0 bg-slate-900/10 z-10 mix-blend-multiply"></div>
              <img 
                src="https://images.unsplash.com/photo-1581094288338-2314dddb7ece?q=80&w=2070&auto=format&fit=crop" 
                alt="Industrial Oil and Gas Facility" 
                className="absolute inset-0 w-full h-full object-cover object-center"
              />
              
              {/* Product Flow Overlay */}
              <div className="absolute inset-0 z-20 p-6 flex flex-col justify-center items-start">
                <div className="bg-white/95 backdrop-blur-md rounded-xl p-5 shadow-xl border border-slate-200/50 max-w-sm w-full transform -rotate-1 hover:rotate-0 transition-transform duration-500">
                  <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100">
                    <span className="text-sm font-semibold text-slate-800">Pipeline Welding Update</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-50 text-accent border border-blue-100">Field Report</span>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-center text-sm">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center mr-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                      </div>
                      <span className="text-slate-600">Understand & Extract</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center mr-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                      </div>
                      <span className="text-slate-600">Match to WBS-4.2.1</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-6 h-6 rounded-full bg-green-50 flex items-center justify-center mr-3">
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      </div>
                      <span className="text-slate-800 font-medium">Validated against rules</span>
                    </div>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">Awaiting Planner Review</span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>

                {/* Institutional Memory Tag */}
                <div className="mt-6 bg-primary/95 backdrop-blur-md rounded-lg p-4 shadow-lg border border-slate-700 max-w-[280px] transform rotate-1 translate-x-12 hover:rotate-0 transition-transform duration-500">
                  <div className="flex items-start">
                    <Database className="w-5 h-5 text-accent mt-0.5 mr-3 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-white mb-1">Institutional Memory</h4>
                      <p className="text-xs text-slate-300">Learns mapping patterns from every planner review.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Decorative elements */}
            <div className="absolute -z-10 top-1/2 -right-12 w-64 h-64 bg-slate-100 rounded-full blur-3xl opacity-70"></div>
          </div>

        </div>
      </div>
    </section>
  );
}
