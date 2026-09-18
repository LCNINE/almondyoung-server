import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function PhoneFrame({
  children,
  screenClassName,
}: {
  children: ReactNode;
  screenClassName?: string;
}) {
  return (
    <div className="h-[420px] w-[196px] shrink-0 sm:h-[600px] sm:w-[280px]">
      <div className="origin-top-left scale-[0.7] sm:scale-100">
        <div className="relative h-[600px] w-[280px] rounded-[49px] border-[14px] border-black bg-black shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
          <div className="absolute top-[95px] -left-[3px] h-[26px] w-[3px] rounded-l-sm bg-neutral-800" />
          <div className="absolute top-[140px] -left-[3px] h-[44px] w-[3px] rounded-l-sm bg-neutral-800" />
          <div className="absolute top-[195px] -left-[3px] h-[44px] w-[3px] rounded-l-sm bg-neutral-800" />
          <div className="absolute top-[160px] -right-[3px] h-[60px] w-[3px] rounded-r-sm bg-neutral-800" />

          <div className="flex h-full w-full flex-col overflow-hidden rounded-[36px] bg-black">
            <div className="relative flex h-[55px] items-center justify-center">
              <div className="h-[5px] w-[48px] rounded-full bg-neutral-800 shadow-[inset_0_0_4px_#242424]" />
              <div className="absolute top-[26px] left-[92px] h-[9px] w-[9px] rounded-full bg-[radial-gradient(circle_at_60%_40%,#5b5b70,#202020_55%,#080808_75%)]" />
            </div>

            <div className={cn('relative flex flex-1 flex-col', screenClassName)}>
              {children}
            </div>

            <div className="flex h-[60px] items-center justify-center">
              <div className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-gradient-to-br from-neutral-700 via-black to-neutral-900 ring-1 ring-neutral-700">
                <div className="h-[38px] w-[38px] rounded-full bg-black" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
