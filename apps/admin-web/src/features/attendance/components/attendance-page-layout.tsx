import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils/ui';

export function AttendancePageLayout({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const width = wide ? 'max-w-7xl' : 'max-w-xl';

  return (
    <main className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div
          className={cn(
            'mx-auto grid min-h-14 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 px-4',
            width
          )}
        >
          <Link
            href="/attendance"
            aria-label="오늘의 근무로 돌아가기"
            className="flex size-11 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:bg-slate-200"
          >
            <ChevronLeft className="size-6" aria-hidden />
          </Link>
          <h1 className="min-w-0 text-center text-base font-semibold text-slate-900">
            {title}
          </h1>
          <span className="size-11" aria-hidden />
        </div>
      </header>
      <div
        className={cn(
          'mx-auto min-w-0 space-y-6 px-4 pt-6 pb-[max(24px,env(safe-area-inset-bottom))]',
          width
        )}
      >
        {children}
      </div>
    </main>
  );
}
