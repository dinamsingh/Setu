import React from 'react';
import { SearchX, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  actionButton?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No reports found',
  description = 'Try adjusting your search criteria or clear current filters.',
  icon: Icon = SearchX,
  actionButton,
}) => {
  return (
    <div className="text-center py-12 px-4 rounded-xl border border-dashed border-setu-slate-300 bg-white">
      <div className="inline-flex p-3 rounded-full bg-setu-slate-100 text-setu-slate-400 mb-3">
        <Icon className="w-8 h-8" />
      </div>
      <h3 className="text-sm font-bold text-setu-slate-800">{title}</h3>
      <p className="text-xs text-setu-slate-500 mt-1 max-w-sm mx-auto">{description}</p>
      {actionButton && <div className="mt-4">{actionButton}</div>}
    </div>
  );
};
