'use client';

import { cn } from '@/lib/utils';

interface SectionCardProps {
  title: string;
  subtitle?: string | null;
  action?: {
    label: string;
    onClick: () => void;
  };
  headerRight?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function SectionCard({ title, subtitle, action, headerRight, className, children }: SectionCardProps) {
  return (
    <div className={cn('bg-white', className)}>
      <div className="flex items-center justify-between gap-3 pb-4">
        <h3 className="flex min-w-0 items-center gap-2 text-[15px] font-bold text-gray-900 lg:text-lg">
          <span className="shrink-0">{title}</span>
          {subtitle && (
            <>
              <span aria-hidden className="text-gray-300">
                |
              </span>
              <span className="truncate font-bold">{subtitle}</span>
            </>
          )}
        </h3>
        {headerRight}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="shrink-0 rounded border border-primary px-3 py-1.5 text-[14px] font-medium text-primary transition-colors hover:bg-gray-50"
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
