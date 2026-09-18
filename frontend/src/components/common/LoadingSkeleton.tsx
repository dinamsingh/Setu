import React from 'react';

export const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-setu-slate-200 bg-white p-5 space-y-3">
          <div className="flex justify-between items-center">
            <div className="h-4 bg-setu-slate-200 rounded w-1/4"></div>
            <div className="h-6 bg-setu-slate-200 rounded w-28"></div>
          </div>
          <div className="h-16 bg-setu-slate-100 rounded"></div>
          <div className="flex gap-4">
            <div className="h-4 bg-setu-slate-200 rounded w-1/3"></div>
            <div className="h-4 bg-setu-slate-200 rounded w-1/4"></div>
          </div>
        </div>
      ))}
    </div>
  );
};
