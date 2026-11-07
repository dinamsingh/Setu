import { Info } from 'lucide-react';

export function DevelopmentNotice() {
  return (
    <aside aria-label="Development notice" className="shrink-0 border-b border-amber-200/70 bg-amber-50 text-amber-950">
      <div className="mx-auto flex w-full max-w-[90rem] items-start gap-2.5 px-4 py-3 sm:px-6 lg:px-8">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 text-xs leading-relaxed">
          <p className="font-semibold">Development preview</p>
          <p className="mt-0.5">SETU is being actively improved. Some features may not work as expected. Thank you for your patience.</p>
        </div>
      </div>
    </aside>
  );
}
