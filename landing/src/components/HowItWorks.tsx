
import { MessageSquare, BrainCircuit, GitMerge, ShieldCheck, UserCheck, TrendingUp } from 'lucide-react';

const steps = [
  {
    num: '01',
    title: 'FIELD REPORT',
    desc: 'Text, voice, photo or document',
    icon: MessageSquare
  },
  {
    num: '02',
    title: 'UNDERSTAND',
    desc: 'Extracts activity, date, location, quantity and evidence',
    icon: BrainCircuit
  },
  {
    num: '03',
    title: 'MATCH',
    desc: 'Finds relevant schedule activities using context and semantic/fuzzy matching',
    icon: GitMerge
  },
  {
    num: '04',
    title: 'VALIDATE',
    desc: 'Checks scope, dates, logic, evidence and duplicates',
    icon: ShieldCheck
  },
  {
    num: '05',
    title: 'PLANNER APPROVES',
    desc: 'Review, edit, approve or reject',
    icon: UserCheck
  },
  {
    num: '06',
    title: 'TRACK & LEARN',
    desc: 'Approved updates become traceable records and improve future matching',
    icon: TrendingUp
  }
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 bg-slate-50 border-y border-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-sm font-bold tracking-widest text-slate-400 uppercase mb-3">
            How SETU Works
          </h2>
          <p className="text-3xl md:text-4xl font-semibold text-primary">
            From field reports to verified schedule updates in one intelligent flow.
          </p>
        </div>

        {/* Desktop / Horizontal Flow */}
        <div className="hidden lg:block relative mt-20">
          <div className="absolute top-6 left-0 right-0 h-px bg-slate-200" />
          
          <div className="grid grid-cols-6 gap-6">
            {steps.map((step, idx) => (
              <div key={idx} className="relative z-10">
                <div className="w-12 h-12 bg-white border border-slate-200 rounded-lg shadow-sm flex items-center justify-center mb-6 mx-auto group hover:border-slate-300 transition-colors">
                  <step.icon className="w-5 h-5 text-slate-600 group-hover:text-primary transition-colors" />
                </div>
                
                <div className="text-center">
                  <span className="block text-[10px] font-bold text-slate-400 mb-1">{step.num}</span>
                  <h3 className="text-sm font-bold text-primary mb-2 uppercase tracking-wide">
                    {step.title}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed px-2">
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile / Vertical Timeline */}
        <div className="lg:hidden relative">
          <div className="absolute top-0 bottom-0 left-6 w-px bg-slate-200" />
          
          <div className="space-y-10">
            {steps.map((step, idx) => (
              <div key={idx} className="relative z-10 flex items-start pl-2">
                <div className="w-9 h-9 bg-white border border-slate-200 rounded flex items-center justify-center shrink-0 shadow-sm z-10 mt-1">
                  <span className="text-xs font-bold text-slate-500">{step.num}</span>
                </div>
                <div className="ml-6">
                  <div className="flex items-center space-x-2 mb-1">
                    <step.icon className="w-4 h-4 text-slate-400" />
                    <h3 className="text-sm font-bold text-primary uppercase tracking-wide">
                      {step.title}
                    </h3>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
