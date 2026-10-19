'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { attendanceApi } from '@/lib/api/domains/attendance';
import {
  LEAVE_LABELS,
  halfDaySchedule,
  type LeaveInput,
  type LeaveRecurrence,
  seoulDate,
  type CalendarLeave,
  type LeaveType,
} from '@packages/domain-types/attendance';
import {
  ATTENDANCE_KEY,
  useAttendance,
  useAttendanceAction,
} from '../hooks/use-attendance';
import {
  buildCalendarWeeks,
  calendarDays,
  shiftCalendarDate,
  calendarLeavesForScope,
  type CalendarScope,
} from '../lib/calendar-layout';
import { VacationPeriodFields } from './vacation-period-fields';
import { vacationDdayLabel, vacationPeriodDays } from '../lib/vacation-period';

const LEAVE_COLORS: Record<LeaveType, string> = {
  full: 'bg-emerald-600 text-white',
  am: 'bg-amber-100 text-amber-900',
  pm: 'bg-sky-100 text-sky-900',
};

export function SharedCalendar({
  initialScope = 'shared',
  showHeading = true,
  fitViewport = false,
}: {
  initialScope?: CalendarScope;
  showHeading?: boolean;
  fitViewport?: boolean;
}) {
  const queryClient = useQueryClient();
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeMoved = useRef(false);
  const { data: me } = useAttendance();
  const today = seoulDate(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [scope, setScope] = useState<CalendarScope>(initialScope);
  const [editor, setEditor] = useState<{
    day: string;
    existing?: CalendarLeave;
  } | null>(null);
  function calendarQuery(targetMonth: string) {
    const days = calendarDays(targetMonth);

    return {
      queryKey: [...ATTENDANCE_KEY, 'calendar', targetMonth],
      queryFn: () =>
        attendanceApi.calendar(
          shiftCalendarDate(days[0], -1),
          shiftCalendarDate(days[days.length - 1], 1)
        ),
      staleTime: 60_000,
    };
  }

  useEffect(() => {
    for (const delta of [-1, 1]) {
      const date = new Date(`${month}-15T12:00:00`);

      date.setMonth(date.getMonth() + delta);

      const adjacent = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      void queryClient.prefetchQuery(calendarQuery(adjacent));
    }
  }, [month, queryClient]);
  const query = useQuery(calendarQuery(month));
  const visibleLeaves = calendarLeavesForScope(
    query.data ?? [],
    me?.userId,
    scope
  );
  const weeks = buildCalendarWeeks(month, visibleLeaves);
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleLanes, setVisibleLanes] = useState(3);

  useEffect(() => {
    const grid = gridRef.current;

    if (!grid) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const rowHeight = entry.contentRect.height / weeks.length;

      setVisibleLanes(rowHeight >= 76 ? 3 : rowHeight >= 62 ? 2 : 1);
    });

    observer.observe(grid);

    return () => observer.disconnect();
  }, [weeks.length]);
  const remove = useAttendanceAction(
    attendanceApi.removeLeave,
    '일정을 삭제했어요.'
  );
  const selectedLeaves = visibleLeaves.filter((item) => item.date === selected);
  const selectedLabel = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${selected}T12:00:00`));

  function selectDay(day: string) {
    if (selected === day) {
      setDaySheetOpen(true);
    }

    setSelected(day);
  }

  function openEditor(existing?: CalendarLeave) {
    setDaySheetOpen(false);
    setEditor({ day: existing?.date ?? selected, existing });
  }

  function moveMonth(delta: number) {
    const date = new Date(`${month}-15T12:00:00`);

    date.setMonth(date.getMonth() + delta);

    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    setMonth(next);

    setSelected(`${next}-01`);
  }

  return (
    <section
      aria-busy={query.isPending}
      className={`flex min-w-0 flex-col gap-2 motion-reduce:[&_[data-slot=skeleton]]:animate-none ${fitViewport ? 'h-full min-h-0' : 'h-[calc(100dvh-12rem)] min-h-[420px]'}`}
    >
      {query.isPending && (
        <span role="status" className="sr-only">
          일정을 불러오는 중이에요.
        </span>
      )}
      <div className="flex shrink-0 items-center justify-between gap-2">
        {showHeading && (
          <div>
            {showHeading && (
              <h1 className="text-2xl font-bold">
                {scope === 'personal'
                  ? '내 휴가·반차 일정'
                  : '직원 휴가·반차 캘린더'}
              </h1>
            )}
            <p className="mt-2 text-sm text-slate-600">
              {scope === 'personal'
                ? '내 일정을 확인하고 등록·수정해요.'
                : '직원들의 휴가와 반차를 함께 확인해요.'}
            </p>
          </div>
        )}
        <div className="ml-auto flex shrink-0 gap-2">
          <Button
            variant="outline"
            className="min-h-11 text-xs sm:text-sm"
            onClick={() =>
              setScope(scope === 'personal' ? 'shared' : 'personal')
            }
          >
            {scope === 'personal' ? '다른 직원 일정 보기' : '내 일정만 보기'}
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-1 px-3 py-1 sm:px-4">
            <h2 className="text-base font-bold tracking-tight">
              {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월
            </h2>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="mr-1 h-11 rounded-full px-4 text-xs sm:h-8"
                onClick={() => {
                  setMonth(today.slice(0, 7));
                  setSelected(today);
                }}
              >
                오늘
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="sr-only focus:not-sr-only focus:size-11 focus:rounded-full"
                aria-label="지난달"
                onClick={() => moveMonth(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="sr-only focus:not-sr-only focus:size-11 focus:rounded-full"
                aria-label="다음 달"
                onClick={() => moveMonth(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 px-3 pb-1 sm:px-4">
            {(['full', 'am', 'pm'] as const).map((type) => (
              <span
                key={type}
                className="flex items-center gap-1.5 text-xs text-slate-500"
              >
                <span className={`size-2.5 rounded-sm ${LEAVE_COLORS[type]}`} />
                {LEAVE_LABELS[type]}
              </span>
            ))}
          </div>
          <div className="grid shrink-0 grid-cols-7 border-t border-slate-200">
            {'일월화수목금토'.split('').map((day, index) => (
              <span
                key={day}
                className={`py-1 text-center text-xs font-medium ${index === 0 ? 'text-rose-500' : index === 6 ? 'text-sky-600' : 'text-slate-600'}`}
              >
                {day}
              </span>
            ))}
          </div>
          <div
            ref={gridRef}
            onPointerDown={(event) => {
              if (!event.isPrimary) {
                return;
              }

              swipeStart.current = { x: event.clientX, y: event.clientY };
              swipeMoved.current = false;
            }}
            onPointerMove={(event) => {
              const start = swipeStart.current;

              if (!start) {
                return;
              }

              const dx = Math.abs(event.clientX - start.x);
              const dy = Math.abs(event.clientY - start.y);

              if (dx > 12 && dx > dy * 1.5) {
                swipeMoved.current = true;
              }
            }}
            onPointerUp={(event) => {
              const start = swipeStart.current;

              swipeStart.current = null;

              if (!start) {
                return;
              }

              const dx = event.clientX - start.x;
              const dy = event.clientY - start.y;

              if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                swipeMoved.current = true;
                moveMonth(dx < 0 ? 1 : -1);
              }
            }}
            onPointerCancel={() => {
              swipeStart.current = null;
              swipeMoved.current = false;
            }}
            onClickCapture={(event) => {
              if (swipeMoved.current) {
                event.preventDefault();
                event.stopPropagation();
                swipeMoved.current = false;
              }
            }}
            className="grid touch-pan-y select-none min-h-0 flex-1 border-t border-slate-200"
            style={{
              gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`,
            }}
          >
            {weeks.map((week) => (
              <div
                key={week.days[0]}
                className="relative grid min-h-0 grid-cols-7 overflow-hidden border-b border-slate-200 last:border-b-0"
              >
                {week.days.map((day, weekday) => {
                  const leaves = visibleLeaves.filter(
                    (item) => item.date === day
                  );
                  const extra = week.segments.filter(
                    (segment) =>
                      segment.lane >= visibleLanes &&
                      segment.from <= day &&
                      segment.to >= day
                  ).length;
                  const inMonth = day.startsWith(month);

                  return (
                    <div
                      key={day}
                      className="relative min-h-0 min-w-0 border-r border-slate-100 last:border-r-0"
                    >
                      <button
                        type="button"
                        aria-label={`${day} 휴가·반차 ${leaves.length}명${leaves.length ? ': ' + leaves.map((item) => `${item.name} ${LEAVE_LABELS[item.type]}`).join(', ') : ''}`}
                        aria-pressed={selected === day}
                        onClick={() => selectDay(day)}
                        onDoubleClick={() => {
                          setSelected(day);
                          setDaySheetOpen(true);
                        }}
                        aria-haspopup="dialog"
                        className={`relative flex h-full min-h-0 w-full min-w-0 flex-col items-center pt-0.5 pb-0 transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-indigo-600 ${selected === day ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'}`}
                      >
                        <span
                          className={`flex size-5 items-center justify-center rounded-full text-xs ${day === today ? 'bg-slate-900 font-semibold text-white' : !inMonth ? 'text-slate-400' : weekday === 0 ? 'text-rose-600' : weekday === 6 ? 'text-sky-700' : 'text-slate-600'}`}
                        >
                          {Number(day.slice(-2))}
                        </span>
                      </button>
                      {extra > 0 && (
                        <button
                          type="button"
                          aria-label={`${day} 전체 일정 ${leaves.length}명 보기`}
                          aria-haspopup="dialog"
                          className="absolute inset-x-0 bottom-0 z-20 flex h-3.5 min-w-0 items-center justify-center rounded text-[10px] font-medium text-slate-600 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-indigo-600 sm:inset-x-0.5"
                          onClick={() => {
                            setSelected(day);
                            setDaySheetOpen(true);
                          }}
                        >
                          <span className="sm:hidden">+{extra}</span>
                          <span className="hidden sm:inline">
                            +{extra}명 더 보기
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-6 grid grid-cols-7 gap-y-px px-0.5"
                >
                  {query.isPending && (
                    <div className="col-span-7 space-y-px px-1">
                      {Array.from({ length: visibleLanes }, (_, lane) => (
                        <Skeleton key={lane} className="h-3 w-4/7" />
                      ))}
                    </div>
                  )}
                  {week.segments
                    .filter((segment) => segment.lane < visibleLanes)
                    .map((segment) => (
                      <span
                        key={segment.id}
                        style={{
                          gridColumn: `${segment.column} / span ${segment.span}`,
                          gridRow: segment.lane + 1,
                        }}
                        className={`mx-0.5 h-3 truncate px-1 text-[9px] font-medium leading-3 sm:text-[11px] ${segment.continuesBefore ? 'rounded-r-sm' : segment.continuesAfter ? 'rounded-l-sm' : 'rounded-sm'} ${LEAVE_COLORS[segment.type]}`}
                      >
                        {segment.continuesBefore ? '‹ ' : ''}
                        {segment.name} · {LEAVE_LABELS[segment.type]}
                        {segment.continuesAfter ? ' ›' : ''}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
          {query.isError && (
            <p role="alert" className="p-4 text-sm text-red-600">
              일정을 불러오지 못했어요.{' '}
              <button onClick={() => query.refetch()} className="underline">
                다시 시도
              </button>
            </p>
          )}
        </div>
      </div>
      <p className="sr-only">
        좌우로 밀어 월을 넘기고, 선택한 날짜를 한 번 더 눌러 일정을 보세요.
      </p>
      <div className="flex h-14 shrink-0 justify-end px-1">
        <Button
          size="icon"
          className="z-30 size-14 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-900/20 hover:bg-indigo-700"
          aria-label={`${selected} 내 휴가·반차 등록`}
          disabled={!me}
          onClick={() => openEditor()}
        >
          <Plus className="size-6" aria-hidden />
        </Button>
      </div>
      <Drawer open={daySheetOpen} onOpenChange={setDaySheetOpen}>
        <DrawerContent className="mx-auto w-full max-w-2xl data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:rounded-t-3xl motion-reduce:transition-none">
          <DrawerHeader className="border-b px-5 pt-4 pb-4 text-left sm:px-6 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <DrawerTitle>{selectedLabel}</DrawerTitle>
                <DrawerDescription className="mt-1">
                  {query.isPending
                    ? ' '
                    : `휴가·반차 ${selectedLeaves.length}명`}
                </DrawerDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-11 rounded-full text-indigo-600"
                  aria-label="선택한 날짜에 내 휴가·반차 등록"
                  disabled={!me}
                  onClick={() => openEditor()}
                >
                  <Plus className="size-6" aria-hidden />
                </Button>
                <DrawerClose asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-11 rounded-full"
                    aria-label="그날 일정 닫기"
                  >
                    <X className="size-5" aria-hidden />
                  </Button>
                </DrawerClose>
              </div>
            </div>
          </DrawerHeader>
          <div
            className="min-h-44 min-w-0 space-y-3 overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-6"
            aria-busy={query.isPending}
          >
            {query.isPending && (
              <div className="space-y-3 motion-reduce:[&_[data-slot=skeleton]]:animate-none">
                <span role="status" className="sr-only">
                  그날 일정을 불러오는 중이에요.
                </span>
                {[0, 1].map((row) => (
                  <Skeleton
                    key={row}
                    className="h-24 w-full rounded-xl"
                    aria-hidden
                  />
                ))}
              </div>
            )}
            {query.isError && (
              <p role="alert" className="py-6 text-sm text-red-600">
                일정을 불러오지 못했어요.{' '}
                <button className="underline" onClick={() => query.refetch()}>
                  다시 시도
                </button>
              </p>
            )}
            {selectedLeaves.map((item) => (
              <div key={item.id} className="rounded-xl border bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold">
                    {item.name}
                  </p>
                  <span
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${LEAVE_COLORS[item.type]}`}
                  >
                    {LEAVE_LABELS[item.type]}
                  </span>
                  {item.showDday && (
                    <span className="text-xs font-medium text-indigo-600">
                      {vacationDdayLabel(item.date, today)}
                    </span>
                  )}
                </div>
                {item.type !== 'full' && (
                  <p className="mt-2 text-xs text-slate-600">
                    근무 예정 {item.start}–{item.end}
                  </p>
                )}
                {item.userId === me?.userId && (
                  <div className="mt-3 flex gap-3">
                    <button
                      className="min-h-11 min-w-11 text-xs text-indigo-600"
                      onClick={() => openEditor(item)}
                    >
                      수정
                    </button>
                    <button
                      className="min-h-11 min-w-11 text-xs text-slate-600"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(item.id)}
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
            ))}
            {query.isSuccess && selectedLeaves.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-600">
                  등록된 휴가·반차가 없어요.
                </p>
                <p className="mt-2 text-xs leading-6 text-slate-500">
                  위의 + 버튼으로 이 날짜에 일정을 등록해 보세요.
                </p>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
      {editor && me && (
        <LeaveEditor
          initial={editor.day}
          existing={editor.existing}
          normalStart={me.settings.normalStart}
          normalEnd={me.settings.normalEnd}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}

function LeaveEditor({
  initial,
  existing,
  normalStart,
  normalEnd,
  onClose,
}: {
  initial: string;
  existing?: CalendarLeave;
  normalStart: string;
  normalEnd: string;
  onClose: () => void;
}) {
  const [periodChanged, setPeriodChanged] = useState(false);
  const [from, setFrom] = useState(initial);
  const [to, setTo] = useState(initial);
  const [allDay, setAllDay] = useState(existing?.type === 'full');
  const [startTime, setStartTime] = useState(
    existing?.type === 'pm' ? (existing.end ?? normalStart) : normalStart
  );
  const [endTime, setEndTime] = useState(
    existing?.type === 'am'
      ? (existing.start ?? halfDaySchedule(normalStart, 'am').start)
      : existing?.type === 'pm'
        ? normalEnd
        : halfDaySchedule(normalStart, 'am').start
  );
  const [recurrence, setRecurrence] = useState<LeaveRecurrence>(
    existing?.recurrence ?? { frequency: 'none' }
  );
  const [reminderMinutes, setReminderMinutes] = useState<number[]>(
    existing?.reminderMinutes ?? []
  );
  const [showDday, setShowDday] = useState(existing?.showDday ?? false);
  const [submitted, setSubmitted] = useState(false);
  const submitLock = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  let days: LeaveInput[] = [];
  let validationError = '';

  try {
    days = vacationPeriodDays({
      from,
      to,
      allDay,
      startTime,
      endTime,
      normalStart,
      normalEnd,
      existingDay: existing,
      periodChanged,
    });
  } catch (error) {
    validationError = (error as Error).message;
  }

  const mutation = useAttendanceAction(
    async (items: LeaveInput[]) =>
      existing
        ? attendanceApi.updateLeave(existing.id, {
            ...items[0],
            showDday,
            reminderMinutes,
          })
        : attendanceApi.saveLeaves(items, {
            recurrence,
            showDday,
            reminderMinutes,
          }),
    existing ? '휴가를 수정했어요.' : '휴가를 저장했어요.'
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitLock.current || mutation.isPending) {
      return;
    }

    setSubmitted(true);

    if (validationError || !days.length) {
      return;
    }

    submitLock.current = true;

    try {
      await mutation.mutateAsync(days);
      onClose();
    } catch {
      // Keep the selected vacation period when saving fails.
    } finally {
      submitLock.current = false;
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitLock.current) {
          onClose();
        }
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (submitLock.current) {
            event.preventDefault();
          }
        }}
        className="inset-x-0 top-auto bottom-0 flex h-dvh max-h-dvh w-full min-w-0 max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 data-[state=closed]:slide-out-to-bottom-full data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-bottom-full data-[state=open]:zoom-in-100 motion-reduce:animate-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:data-[state=closed]:slide-out-to-bottom-2 sm:data-[state=open]:slide-in-from-bottom-2"
      >
        <DialogHeader className="shrink-0 px-3 pt-[env(safe-area-inset-top)] sm:px-4">
          <div className="grid min-h-16 grid-cols-[56px_minmax(0,1fr)_56px] items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11 rounded-full"
              aria-label="휴가 등록 창 닫기"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              <X className="size-5" aria-hidden />
            </Button>
            <DialogTitle
              ref={titleRef}
              tabIndex={-1}
              className="text-center text-base outline-none"
            >
              휴가 {existing ? '수정' : '등록'}
            </DialogTitle>
            <Button
              type="submit"
              form="leave-editor-form"
              variant="ghost"
              className="h-11 px-2 text-base font-semibold text-indigo-600"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? '저장 중' : '저장'}
            </Button>
          </div>
        </DialogHeader>
        <form
          id="leave-editor-form"
          onSubmit={submit}
          onInvalid={() => setSubmitted(true)}
          className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] sm:flex-initial sm:px-6"
        >
          <fieldset
            disabled={mutation.isPending}
            className="m-0 w-full min-w-0 border-0 p-0"
          >
            <VacationPeriodFields
              allDay={allDay}
              from={from}
              to={to}
              startTime={startTime}
              endTime={endTime}
              recurrence={recurrence}
              showDday={showDday}
              reminderMinutes={reminderMinutes}
              onReminderChange={setReminderMinutes}
              datesLocked={!!existing}
              onAllDayChange={(value) => {
                if (value !== allDay) {
                  setPeriodChanged(true);
                  setAllDay(value);
                }
              }}
              onFromChange={(value) => {
                setPeriodChanged(true);
                setFrom(value);

                if (value > to) {
                  setTo(value);
                }
              }}
              onToChange={(value) => {
                setPeriodChanged(true);
                setTo(value);
              }}
              onStartTimeChange={(value) => {
                setPeriodChanged(true);
                setStartTime(value);
              }}
              onEndTimeChange={(value) => {
                setPeriodChanged(true);
                setEndTime(value);
              }}
              onRecurrenceChange={setRecurrence}
              onDdayChange={setShowDday}
            />
            {submitted && validationError && (
              <p role="alert" className="mt-5 text-sm leading-6 text-red-600">
                {validationError}
              </p>
            )}
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
