'use client';

import { CalendarDays } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useLogoContestStatus } from '@/lib/services/logo-contest';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function ContestPeriod() {
  const { data, isError } = useLogoContestStatus();

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pt-5 pb-5 sm:px-6 sm:pt-6">
      <h1 className="text-xl font-semibold tracking-tight">로고 공모전 출품작</h1>
      <div className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
        <span className="shrink-0 font-medium text-foreground">출품·투표 기간</span>
        {data ? (
          <span className="whitespace-nowrap">
            <time dateTime={data.startsAt}>{formatDate(data.startsAt)}</time>
            {' ~ '}
            <time dateTime={data.endsAt}>{formatDate(data.endsAt)}</time>
          </span>
        ) : isError ? (
          <span>기간을 불러오지 못했습니다.</span>
        ) : (
          <Skeleton className="h-4 w-40" />
        )}
      </div>
    </header>
  );
}
