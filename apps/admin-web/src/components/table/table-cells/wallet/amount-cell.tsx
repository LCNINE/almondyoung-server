'use client';

import { PlaceholderCell } from '../common/placeholder-cell';

export function AmountCell({ value, currency }: { value: number | null | undefined; currency?: string }) {
  if (value == null) return <PlaceholderCell />;
  const formatted = value.toLocaleString('ko-KR');
  return (
    <span className="font-mono text-sm">
      {formatted}
      {currency ? <span className="ml-1 text-muted-foreground text-xs">{currency}</span> : null}
    </span>
  );
}
