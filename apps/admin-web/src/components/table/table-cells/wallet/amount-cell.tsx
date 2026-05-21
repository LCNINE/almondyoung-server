'use client';

import { cn } from '@/lib/utils/cn';

import { PlaceholderCell } from '../common/placeholder-cell';

export function AmountCell({
  value,
  currency,
  className,
}: {
  value: number | null | undefined;
  currency?: string;
  className?: string;
}) {
  if (value == null) return <PlaceholderCell />;
  const formatted = value.toLocaleString('ko-KR');
  return (
    <div className={cn('font-mono text-sm text-right', className)}>
      {formatted}
      {currency ? (
        <span className="ml-1 text-xs text-muted-foreground">{currency}</span>
      ) : null}
    </div>
  );
}
