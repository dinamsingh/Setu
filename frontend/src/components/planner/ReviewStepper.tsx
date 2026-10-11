import { Check } from 'lucide-react';
import type { reviewStage } from '../../lib/guidedReview';

const steps = ['Evidence', 'AI Match', 'Validation', 'Planner Decision', 'Done'];

export function ReviewStepper({ stage }: { stage: ReturnType<typeof reviewStage> }) {
  return <nav aria-label="Review progress" className="border-b border-setu-slate-200 bg-setu-slate-50 px-4 py-4 sm:px-5">
    <ol className="grid grid-cols-5 gap-1 sm:gap-3">
      {steps.map((label, index) => {
        const current = stage.current === index + 1;
        const complete = !current && stage.completed[index];
        return <li key={label} aria-current={current ? 'step' : undefined}
          className={`flex min-w-0 flex-col gap-1.5 border-t-2 pt-2 text-[10px] font-semibold sm:text-xs ${current
            ? 'border-setu-teal text-setu-navy' : complete ? 'border-setu-green text-setu-green-dark' : 'border-setu-slate-200 text-setu-slate-500'}`}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-sm font-mono ${current ? 'bg-setu-navy text-white'
            : complete ? 'bg-emerald-100' : 'bg-setu-slate-200'}`}>
            {complete ? <Check aria-hidden="true" className="h-4 w-4" /> : index + 1}
          </span>
          <span>{label}</span><span className="sr-only">{current ? 'Current step' : complete ? 'Completed' : 'Not completed'}</span>
        </li>;
      })}
    </ol>
    <p className="mt-3 max-w-prose text-xs leading-5 text-setu-slate-600">{stage.guidance}</p>
  </nav>;
}
