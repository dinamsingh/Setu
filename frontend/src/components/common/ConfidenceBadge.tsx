import React from 'react';
import { getConfidenceColor } from '../../lib/utils';

interface ConfidenceBadgeProps {
  level: string;
  score?: number | null;
  showLabel?: boolean;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({
  level,
  score,
  showLabel = true,
}) => {
  const isAwaiting = !level || level.toLowerCase() === 'pending';
  const { bg, text, border, label } = getConfidenceColor(level);
  const scorePercent = !isAwaiting && score != null ? `${(Number(score) * 100).toFixed(1)}%` : null;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${bg} ${text} ${border}`}
      title={isAwaiting ? 'Awaiting AI Matching Worker' : `Confidence Score: ${scorePercent || 'Pending'} · ${label}`}
    >
      <span className="font-bold">{isAwaiting ? 'Awaiting Matching' : level}</span>
      {scorePercent && (
        <span className="font-mono text-[11px] opacity-90">({scorePercent})</span>
      )}
      {showLabel && !isAwaiting && (
        <span className="hidden sm:inline-block font-normal text-[11px] border-l border-current/20 pl-1.5 opacity-85">
          {label}
        </span>
      )}
    </div>
  );
};
