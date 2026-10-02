import type { ReactNode } from 'react';
import { cn } from '../core/design/cn';

export function Kbd({ children, tone = 'dark' }: { children: ReactNode; tone?: 'dark' | 'muted' | 'light' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-[30px] items-center justify-center rounded px-1.5 font-mono text-xs font-semibold',
        tone === 'dark' && 'bg-[#15171C] text-white',
        tone === 'muted' && 'bg-[#2A303C] text-[#C3C8D2]',
        tone === 'light' && 'bg-[#E2E4E8] text-[#15171C]'
      )}
    >
      {children}
    </span>
  );
}
