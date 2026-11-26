import type { ReactNode } from 'react';
import { cn } from '../core/design/cn';

export function Kbd({
  children,
  tone = 'dark',
  className,
}: {
  children: ReactNode;
  tone?: 'dark' | 'muted' | 'light' | 'outline';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center font-mono',
        tone !== 'outline' && 'h-6 min-w-[30px] rounded px-1.5 text-xs font-semibold',
        tone === 'dark' && 'bg-[#15171C] text-white',
        tone === 'muted' && 'bg-[#2A303C] text-[#C3C8D2]',
        tone === 'outline' && 'h-auto min-w-[23px] rounded-[4px] border border-current px-1 py-0.5 text-[11px] font-normal opacity-65',
        tone === 'light' && 'bg-[#E2E4E8] text-[#15171C]',
        className
      )}
    >
      {children}
    </span>
  );
}
