'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { attendanceApi } from '@/lib/api/domains/attendance';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { seoulDate } from '@packages/domain-types/attendance';
import { ATTENDANCE_KEY, useAttendance } from '../hooks/use-attendance';
import { useAttendanceAccess } from '../hooks/use-attendance-access';
import { StatisticsPeople } from './statistics-people';
import { StatisticsBasis, StatisticsSummary } from './statistics-summary';

function adjacentMonth(month: string, delta: number) {
  const [year, number] = month.split('-').map(Number);

  return new Date(Date.UTC(year, number - 1 + delta, 1))
    .toISOString()
    .slice(0, 7);
}

export function AttendanceStatistics({
  showHeading = true,
  initialMonth,
}: {
  showHeading?: boolean;
  initialMonth?: string;
}) {
  const me = useAttendance();
  const { canSeeStatistics, statisticsState } = useAttendanceAccess();
  const currentMonth = seoulDate(new Date()).slice(0, 7);
  const [month, setMonth] = useState(initialMonth ?? currentMonth);
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'statistics', month],
    queryFn: () => attendanceApi.monthlyStatistics(month),
    enabled: canSeeStatistics,
  });

  if (me.isError) {
    return (
      <p role="alert">
        사용자 정보를 불러오지 못했어요.{' '}
        <button className="underline" onClick={() => me.refetch()}>
          다시 시도
        </button>
      </p>
    );
  }

  if (statisticsState.status === 'error') {
    return (
      <p role="alert">
        권한 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.
      </p>
    );
  }

  if (me.isPending || statisticsState.status === 'loading') {
    return (
      <Skeleton
        className="h-48 w-full rounded-3xl"
        aria-label="권한을 확인하고 있어요."
      />
    );
  }

  if (!canSeeStatistics) {
    return (
      <p
        role="alert"
        className="rounded-2xl border bg-white p-6 text-sm text-slate-600"
      >
        전체 직원의 월별 통계를 볼 권한이 없어요.
      </p>
    );
  }

  return (
    <section
      className="mx-auto min-w-0 max-w-5xl space-y-6 sm:space-y-8"
      aria-busy={query.isPending}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          {showHeading && (
            <h1 className="text-[28px] leading-10 font-bold tracking-tight text-slate-950">
              월별 출퇴근 통계
            </h1>
          )}
          <p
            className={`${showHeading ? 'mt-1' : ''} text-sm leading-6 text-slate-500`}
          >
            한 달의 기록을 모아 한눈에 살펴보세요.
          </p>
        </div>
        {showHeading && (
          <Button
            variant="ghost"
            className="min-h-11 shrink-0 gap-2 rounded-xl text-slate-500"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RotateCw
              className={`size-4 ${query.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden
            />
            <span className="hidden sm:inline">새로고침</span>
            <span className="sr-only sm:hidden">새로고침</span>
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-xl text-slate-500"
            aria-label="이전 달"
            disabled={month === '1900-01'}
            onClick={() => setMonth(adjacentMonth(month, -1))}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Button>
          <label className="min-w-0">
            <span className="sr-only">조회할 월</span>
            <input
              type="month"
              min="1900-01"
              max="9998-12"
              aria-label="조회할 월"
              value={month}
              onChange={(event) => {
                if (
                  /^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(
                    event.target.value
                  ) &&
                  event.target.value <= '9998-12'
                ) {
                  setMonth(event.target.value);
                }
              }}
              className="min-h-11 w-40 min-w-0 rounded-xl border-0 bg-transparent px-1 text-center text-lg font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-xl text-slate-500"
            aria-label="다음 달"
            disabled={month === '9998-12'}
            onClick={() => setMonth(adjacentMonth(month, 1))}
          >
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        </div>
        {month !== currentMonth && (
          <button
            type="button"
            onClick={() => setMonth(currentMonth)}
            className="min-h-10 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            이번 달
          </button>
        )}
      </div>
      {query.isError ? (
        <div
          role="alert"
          className="rounded-2xl border bg-white p-6 text-sm text-slate-600"
        >
          통계를 불러오지 못했어요.{' '}
          <button className="underline" onClick={() => query.refetch()}>
            다시 시도
          </button>
        </div>
      ) : (
        <>
          <StatisticsSummary
            month={month}
            totals={query.data?.totals}
            pending={query.isPending}
          />
          <StatisticsPeople
            key={month}
            people={query.data?.people ?? []}
            pending={query.isPending}
          />
          <StatisticsBasis />
        </>
      )}
    </section>
  );
}
