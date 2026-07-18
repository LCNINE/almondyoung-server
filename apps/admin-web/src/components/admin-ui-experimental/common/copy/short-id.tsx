'use client';

import { Copy } from './copy';
import { cn } from '@/lib/utils/ui';

type ShortIdProps = {
  value: string;
  className?: string;
};

/** id 의 뒤 6자만 표시하고 옆에 클릭 복사 버튼(전체 id 를 복사)을 노출한다. */
export function ShortId({ value, className }: ShortIdProps) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="font-mono text-xs text-muted-foreground">
        …{value.slice(-6)}
      </span>
      <Copy content={value} />
    </span>
  );
}
