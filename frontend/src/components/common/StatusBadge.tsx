import React from 'react';
import { getStatusBadge } from '../../lib/utils';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const { bg, label } = getStatusBadge(status);

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-extrabold tracking-wide uppercase ${bg}`}>
      {label}
    </span>
  );
};
