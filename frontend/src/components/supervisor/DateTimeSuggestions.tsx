import { Clock, X, Check, Sparkles, AlertTriangle } from 'lucide-react';
import type { TemporalSuggestion, DateCandidate } from '../../lib/temporalParser';

export interface DateTimeSuggestionsProps {
  suggestions: TemporalSuggestion[];
  currentReportedDate: string;
  onApplyDate: (date: string, suggestion: TemporalSuggestion, candidate?: DateCandidate) => void;
  onDismissSuggestion: (id: string) => void;
  onDismissAll?: () => void;
}

export const DateTimeSuggestions = ({
  suggestions,
  currentReportedDate,
  onApplyDate,
  onDismissSuggestion,
  onDismissAll,
}: DateTimeSuggestionsProps) => {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  const getIntentBadgeClasses = (intent: string) => {
    switch (intent) {
      case 'completed_work':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'future_plan':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'in_progress':
        return 'bg-sky-50 text-sky-800 border-sky-200';
      case 'uncertain':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div
      role="region"
      aria-label="Date and time suggestions from narrative"
      className="mt-3 rounded-2xl border border-blue-200/90 bg-[#F0F5FC] p-3.5 sm:p-4 text-xs text-[#112344] shadow-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 font-bold text-[#1557A0] sm:text-sm">
            <Sparkles size={15} className="text-[#1557A0]" aria-hidden="true" />
            Date &amp; time mentions detected
          </span>
          <span className="rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#1557A0]">
            Asia/Kolkata (IST)
          </span>
        </div>
        {onDismissAll && suggestions.length > 0 && (
          <button
            type="button"
            onClick={onDismissAll}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline decoration-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            Dismiss all
          </button>
        )}
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
        Suggested dates extracted from your narrative. Applying a date updates the Reported Date field below without modifying your narrative. Time info is advisory only.
      </p>

      <div className="mt-3 space-y-2.5">
        {suggestions.map((s) => {
          const badgeClass = getIntentBadgeClasses(s.intent);
          const hasCandidates = s.candidates && s.candidates.length > 0;
          const hasResolvedDate = Boolean(s.resolvedDate);
          const isDateLess = !hasCandidates && !hasResolvedDate;
          const isFutureIntent = s.intent === 'future_plan';

          return (
            <div
              key={s.id}
              className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-900">
                    &ldquo;{s.rawExpression}&rdquo;
                  </span>
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}
                  >
                    {s.intentBadge}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onDismissSuggestion(s.id)}
                  aria-label={`Dismiss suggestion for "${s.rawExpression}"`}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>

              <p className="mt-1 text-[11px] leading-normal text-slate-600">
                {s.explanation}
              </p>

              {s.time && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-600">
                  <Clock size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
                  <span>
                    Time mentioned: <strong className="font-semibold text-slate-800">{s.time.display}</strong> (Advisory only &mdash; form saves date)
                  </span>
                </div>
              )}

              {isFutureIntent && (
                <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-[11px] text-amber-900">
                  <AlertTriangle size={13} className="shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
                  <span>
                    <strong>Planned future activity:</strong> Field reports typically record today&apos;s progress or past actuals. Setting a future report date is advisory.
                  </span>
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {s.isAmbiguous ? (
                  <>
                    <span className="text-[11px] font-medium text-slate-500">
                      Choose date:
                    </span>
                    {s.candidates.map((c) => {
                      const isSelected = c.date === currentReportedDate;
                      const isFutureCandidate = c.relation === 'future';

                      return (
                        <button
                          key={c.date}
                          type="button"
                          onClick={() => onApplyDate(c.date, s, c)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            isSelected
                              ? 'border border-emerald-300 bg-emerald-50 text-emerald-800'
                              : isFutureCandidate
                              ? 'border border-amber-300 bg-amber-50/90 text-amber-900 hover:bg-amber-100'
                              : 'bg-[#1557A0] text-white hover:bg-[#0C315D]'
                          }`}
                        >
                          {isSelected && <Check size={13} aria-hidden="true" />}
                          Use {c.label}
                          {isSelected && ' (Selected)'}
                        </button>
                      );
                    })}
                  </>
                ) : !isDateLess ? (
                  (() => {
                    const targetDate = s.resolvedDate || s.candidates[0]?.date;
                    if (!targetDate) return null;
                    const isSelected = targetDate === currentReportedDate;
                    const isFutureCandidate = isFutureIntent || s.candidates[0]?.relation === 'future';
                    const label = s.candidates[0]?.label || targetDate;

                    return (
                      <button
                        type="button"
                        onClick={() => onApplyDate(targetDate, s, s.candidates[0])}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                          isSelected
                            ? 'border border-emerald-300 bg-emerald-50 text-emerald-800'
                            : isFutureCandidate
                            ? 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                            : 'bg-[#1557A0] text-white hover:bg-[#0C315D]'
                        }`}
                      >
                        {isSelected && <Check size={13} aria-hidden="true" />}
                        {isFutureCandidate ? `Set future date: ${label}` : `Use ${label}`}
                        {isSelected && ' (Selected)'}
                      </button>
                    );
                  })()
                ) : (
                  <div className="text-[11px] italic text-slate-500">
                    No date specified in narrative. Current reported date is preserved.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
