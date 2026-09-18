import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  icon?: LucideIcon;
  variant?: 'default' | 'high' | 'medium' | 'low' | 'blue';
  onClick?: () => void;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  onClick,
}) => {
  const variantStyles = {
    default: 'border-setu-slate-200 text-setu-slate-900',
    high: 'border-emerald-200 bg-emerald-50/40 text-emerald-950',
    medium: 'border-amber-200 bg-amber-50/40 text-amber-950',
    low: 'border-rose-200 bg-rose-50/40 text-rose-950',
    blue: 'border-blue-200 bg-blue-50/40 text-blue-950',
  };

  const textStyles = {
    default: 'text-setu-slate-800',
    high: 'text-setu-green-dark',
    medium: 'text-setu-amber-dark',
    low: 'text-setu-red-dark',
    blue: 'text-setu-blue',
  };

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border bg-white p-5 shadow-xs transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''
      } ${variantStyles[variant]}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-setu-slate-500">
          {label}
        </span>
        {Icon && (
          <div className={`p-2 rounded-lg bg-setu-slate-50 ${textStyles[variant]}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
      <div className={`text-3xl font-extrabold mt-2 tracking-tight ${textStyles[variant]}`}>
        {value}
      </div>
      {subtitle && (
        <p className="text-xs text-setu-slate-500 mt-1 font-medium">{subtitle}</p>
      )}
    </div>
  );
};
