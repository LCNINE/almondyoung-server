'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { MonthlyAttendancePerson } from '@packages/domain-types/attendance';
import { Skeleton } from '@/components/ui/skeleton';
import {
  paginateStatistics,
  statisticsDuration,
  statisticsPageNumbers,
  type StatisticsFilter,
} from '../lib/statistics-model';

export function StatisticsPeople({
  people,
  pending,
}: {
  people: MonthlyAttendancePerson[];
  pending: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatisticsFilter>('all');
  const [requestedPage, setRequestedPage] = useState(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const view = paginateStatistics(people, search, filter, requestedPage);
  const missing = people.filter(
    (person) => person.missingCheckoutDays > 0
  ).length;

  function changePage(page: number) {
    setRequestedPage(page);
    heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    heading.current?.focus({ preventScroll: true });
  }

  return (
    <section className="min-w-0" aria-busy={pending}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2
          ref={heading}
          tabIndex={-1}
          className="scroll-mt-24 text-xl font-bold tracking-tight text-slate-950 outline-none"
        >
          직원별 통계{' '}
          <span className="ml-1 text-base font-medium text-slate-400">
            {pending ? '—' : people.length}
          </span>
        </h2>
        <span className="text-xs text-slate-400">10명씩 보기</span>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex w-fit rounded-xl bg-slate-100 p-1"
          aria-label="직원 통계 필터"
        >
          {(
            [
              ['all', '전체', people.length],
              ['missing', '확인 필요', missing],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setRequestedPage(1);
              }}
              className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${filter === value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {label}
              <span
                className={`ml-1.5 text-xs ${value === 'missing' && count > 0 ? 'text-orange-600' : 'text-slate-400'}`}
              >
                {pending ? '—' : count}
              </span>
            </button>
          ))}
        </div>
        <div className="relative min-w-0 sm:w-64">
          <Search
            className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-slate-400"
            aria-hidden
          />
          <input
            aria-label="직원 이름 검색"
            placeholder="직원 이름 검색"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setRequestedPage(1);
            }}
            className="h-11 w-full rounded-xl border-0 bg-slate-100 pr-11 pl-10 text-base outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 sm:text-sm"
          />
          {search && (
            <button
              type="button"
              aria-label="직원 검색 지우기"
              onClick={() => {
                setSearch('');
                setRequestedPage(1);
              }}
              className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-xl text-slate-500"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))_minmax(0,1.2fr)] gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 text-xs font-medium text-slate-500 md:grid"
        >
          <span>직원</span>
          <span className="text-center">출근</span>
          <span className="text-center">퇴근 완료</span>
          <span className="text-center">퇴근 미기록</span>
          <span className="text-right">기록시간</span>
        </div>
        {pending ? (
          <div role="status" className="divide-y divide-slate-100 px-5">
            <span className="sr-only">직원 통계를 불러오고 있어요.</span>
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="flex items-center gap-3 py-6">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-5 w-28" />
                <Skeleton className="ml-auto h-5 w-20" />
              </div>
            ))}
          </div>
        ) : view.rows.length ? (
          <ul
            aria-label="직원별 월별 통계 목록"
            className="divide-y divide-slate-100"
          >
            {view.rows.map((person) => (
              <li
                key={person.userId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))_minmax(0,1.2fr)] md:gap-4 md:py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500"
                  >
                    {person.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold leading-6 text-slate-900">
                      {person.name}
                    </h3>
                    {person.ongoingDays > 0 && (
                      <p className="text-xs leading-5 text-emerald-700">
                        근무 진행 중
                      </p>
                    )}
                    {person.recordedDays === 0 && (
                      <p className="text-xs leading-5 text-slate-400">
                        이 달 기록 없음
                      </p>
                    )}
                  </div>
                </div>
                <p className="col-start-2 row-start-1 text-right text-sm font-bold tabular-nums text-slate-900 md:col-start-5">
                  <span className="sr-only">기록시간 </span>
                  {statisticsDuration(person.recordedMinutes)}
                </p>
                <p className="col-span-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 md:hidden">
                  <span>출근 {person.recordedDays}일</span>
                  <span>퇴근 완료 {person.completedDays}일</span>
                  <span
                    className={
                      person.missingCheckoutDays
                        ? 'font-medium text-orange-700'
                        : ''
                    }
                  >
                    퇴근 미기록 {person.missingCheckoutDays}건
                  </span>
                </p>
                <p className="hidden text-center text-sm tabular-nums text-slate-700 md:col-start-2 md:row-start-1 md:block">
                  <span className="sr-only">출근 </span>
                  {person.recordedDays}일
                </p>
                <p className="hidden text-center text-sm tabular-nums text-slate-700 md:col-start-3 md:row-start-1 md:block">
                  <span className="sr-only">퇴근 완료 </span>
                  {person.completedDays}일
                </p>
                <p className="hidden text-center text-sm tabular-nums md:col-start-4 md:row-start-1 md:block">
                  {person.missingCheckoutDays ? (
                    <span className="inline-flex rounded-md bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700">
                      <span className="sr-only">퇴근 미기록 </span>
                      {person.missingCheckoutDays}건
                    </span>
                  ) : (
                    <span className="text-slate-300">
                      —<span className="sr-only">퇴근 미기록 없음</span>
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-6 py-14 text-center">
            <Search
              className="mx-auto mb-3 size-7 text-slate-300"
              aria-hidden
            />
            <p className="font-semibold text-slate-700">
              {search.trim()
                ? '검색한 직원이 없어요'
                : filter === 'missing'
                  ? '확인이 필요한 직원이 없어요'
                  : '집계할 직원이 없어요'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {search.trim()
                ? '다른 이름으로 다시 검색해 주세요.'
                : '직원과 출퇴근 기록을 등록하면 여기에 표시돼요.'}
            </p>
          </div>
        )}
      </div>
      {!pending && view.total > 0 && (
        <div className="mt-5 space-y-3">
          <p role="status" className="text-center text-xs text-slate-500">
            전체 {view.total}명 중 {view.start}–{view.end}명
          </p>
          <nav
            aria-label="직원 통계 페이지"
            className="flex items-center justify-center gap-1"
          >
            <button
              type="button"
              aria-label="이전 페이지"
              disabled={view.page === 1}
              onClick={() => changePage(view.page - 1)}
              className="flex size-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default disabled:opacity-25"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            {statisticsPageNumbers(view.page, view.pageCount).map(
              (number, index) =>
                number === 'ellipsis' ? (
                  <span
                    key={`gap-${index}`}
                    className="flex size-9 items-center justify-center text-slate-400"
                    aria-hidden
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={number}
                    type="button"
                    aria-label={`${number}페이지`}
                    aria-current={number === view.page ? 'page' : undefined}
                    onClick={() => changePage(number)}
                    className={`size-9 rounded-xl text-sm font-semibold focus-visible:ring-2 focus-visible:ring-indigo-500 ${number === view.page ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    {number}
                  </button>
                )
            )}
            <button
              type="button"
              aria-label="다음 페이지"
              disabled={view.page === view.pageCount}
              onClick={() => changePage(view.page + 1)}
              className="flex size-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default disabled:opacity-25"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </nav>
        </div>
      )}
    </section>
  );
}
