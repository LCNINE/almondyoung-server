'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { attendanceApi } from '@/lib/api/domains/attendance';
import {
  LEAVE_LABELS,
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
  changeLeaveType,
  dateRange,
  validateDraft,
  type LeaveDraft,
} from '../lib/attendance-model';
import {
  buildCalendarWeeks,
  calendarDays,
  resolveRangeDrafts,
  shiftCalendarDate,
  calendarLeavesForScope,
  type CalendarScope,
} from '../lib/calendar-layout';
import { LeaveScheduleFields } from './leave-schedule-fields';

const LEAVE_COLORS: Record<LeaveType, string> = {
  full: 'bg-emerald-600 text-white',
  am: 'bg-amber-100 text-amber-900',
  pm: 'bg-sky-100 text-sky-900',
};

export function SharedCalendar({
  initialScope = 'shared',
  showHeading = true,
}: {
  initialScope?: CalendarScope;
  showHeading?: boolean;
}) {
  const { data: me } = useAttendance();
  const today = seoulDate(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [scope, setScope] = useState<CalendarScope>(initialScope);
  const [editor, setEditor] = useState<{
    day: string;
    existing?: CalendarLeave;
  } | null>(null);
  const visibleDays = calendarDays(month);
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'calendar', month],
    queryFn: () =>
      attendanceApi.calendar(
        shiftCalendarDate(visibleDays[0], -1),
        shiftCalendarDate(visibleDays[visibleDays.length - 1], 1)
      ),
  });
  const visibleLeaves = calendarLeavesForScope(
    query.data ?? [],
    me?.userId,
    scope
  );
  const weeks = buildCalendarWeeks(month, visibleLeaves);
  const remove = useAttendanceAction(
    attendanceApi.removeLeave,
    '일정을 삭제했어요.'
  );
  const selectedLeaves = visibleLeaves.filter((item) => item.date === selected);
  const expandedLeaves = visibleLeaves.filter(
    (item) => item.date === expandedDay
  );
  const expandedLabel = expandedDay
    ? new Intl.DateTimeFormat('ko-KR', {
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }).format(new Date(`${expandedDay}T12:00:00`))
    : '';
  const selectedLabel = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${selected}T12:00:00`));

  function moveMonth(delta: number) {
    const date = new Date(`${month}-15T12:00:00`);

    date.setMonth(date.getMonth() + delta);

    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    setMonth(next);

    setSelected(`${next}-01`);
  }

  return (
    <section className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
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
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            onClick={() =>
              setScope(scope === 'personal' ? 'shared' : 'personal')
            }
          >
            {scope === 'personal' ? '다른 직원 일정 보기' : '내 일정만 보기'}
          </Button>
          <Button
            className="min-h-11 sm:min-h-9"
            onClick={() => setEditor({ day: selected })}
            disabled={!me}
          >
            내 휴가 / 반차 등록
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
            <h2 className="text-lg font-bold tracking-tight">
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
                className="size-11 rounded-full sm:size-8"
                aria-label="지난달"
                onClick={() => moveMonth(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-11 rounded-full sm:size-8"
                aria-label="다음 달"
                onClick={() => moveMonth(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 pb-4 sm:px-6">
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
          <div className="grid grid-cols-7 border-t border-slate-200">
            {'일월화수목금토'.split('').map((day, index) => (
              <span
                key={day}
                className={`py-3 text-center text-xs font-medium ${index === 0 ? 'text-rose-500' : index === 6 ? 'text-sky-600' : 'text-slate-600'}`}
              >
                {day}
              </span>
            ))}
          </div>
          <div className="border-t border-slate-200">
            {weeks.map((week) => (
              <div
                key={week.days[0]}
                className="relative grid grid-cols-7 border-b border-slate-200 last:border-b-0"
              >
                {week.days.map((day, weekday) => {
                  const leaves = visibleLeaves.filter(
                    (item) => item.date === day
                  );
                  const extra = week.segments.filter(
                    (segment) =>
                      segment.lane >= 3 &&
                      segment.from <= day &&
                      segment.to >= day
                  ).length;
                  const inMonth = day.startsWith(month);

                  return (
                    <div key={day} className="relative min-w-0">
                      <button
                        type="button"
                        aria-label={`${day} 휴가·반차 ${leaves.length}명${leaves.length ? ': ' + leaves.map((item) => `${item.name} ${LEAVE_LABELS[item.type]}`).join(', ') : ''}`}
                        aria-pressed={selected === day}
                        onClick={() => setSelected(day)}
                        className={`relative flex min-h-36 w-full min-w-0 flex-col items-center pt-2 pb-1 transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-indigo-600 ${selected === day ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'}`}
                      >
                        <span
                          className={`flex size-6 items-center justify-center rounded-full text-xs ${day === today ? 'bg-slate-900 font-semibold text-white' : !inMonth ? 'text-slate-400' : weekday === 0 ? 'text-rose-600' : weekday === 6 ? 'text-sky-700' : 'text-slate-600'}`}
                        >
                          {Number(day.slice(-2))}
                        </span>
                      </button>
                      {extra > 0 && (
                        <button
                          type="button"
                          aria-label={`${day} 전체 일정 ${leaves.length}명 보기`}
                          aria-haspopup="dialog"
                          className="absolute inset-x-0 bottom-0 z-20 flex h-8 min-w-0 items-center justify-center rounded text-[10px] font-medium text-slate-600 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-indigo-600 sm:inset-x-0.5"
                          onClick={() => {
                            setSelected(day);
                            setExpandedDay(day);
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
                  className="pointer-events-none absolute inset-x-0 top-10 grid grid-cols-7 gap-y-1 px-0.5"
                >
                  {week.segments
                    .filter((segment) => segment.lane < 3)
                    .map((segment) => (
                      <span
                        key={segment.id}
                        style={{
                          gridColumn: `${segment.column} / span ${segment.span}`,
                          gridRow: segment.lane + 1,
                        }}
                        className={`mx-0.5 h-5 truncate px-1.5 text-[10px] font-medium leading-5 sm:text-[11px] ${segment.continuesBefore ? 'rounded-r-sm' : segment.continuesAfter ? 'rounded-l-sm' : 'rounded-sm'} ${LEAVE_COLORS[segment.type]}`}
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
          {query.isPending && (
            <p className="p-4 text-sm text-slate-600">
              일정을 불러오고 있어요.
            </p>
          )}
        </div>
        <aside className="space-y-4 bg-slate-50/60 p-5 sm:p-6 lg:border-l">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">{selectedLabel}</h3>
              <p className="mt-1 text-xs text-slate-600">
                휴가·반차 {selectedLeaves.length}명
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-11 shrink-0 rounded-full text-indigo-600 sm:size-8"
              aria-label="선택한 날짜에 내 휴가·반차 등록"
              disabled={!me}
              onClick={() => setEditor({ day: selected })}
            >
              <Plus className="size-4" />
            </Button>
          </div>
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
                    onClick={() =>
                      setEditor({ day: item.date, existing: item })
                    }
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
            <p className="py-8 text-sm text-slate-600">
              등록된 휴가·반차가 없어요.
            </p>
          )}
        </aside>
      </div>
      <Dialog
        open={expandedDay !== null}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedDay(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[85dvh] w-[calc(100%-2rem)] flex-col overflow-hidden p-4 sm:p-6 [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center">
          <DialogHeader className="pr-10">
            <DialogTitle>{expandedLabel} 전체 일정</DialogTitle>
            <DialogDescription>
              휴가·반차 {expandedLeaves.length}명
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain">
            {expandedLeaves.map((item) => (
              <div key={item.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold">
                    {item.name}
                  </p>
                  <span
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${LEAVE_COLORS[item.type]}`}
                  >
                    {LEAVE_LABELS[item.type]}
                  </span>
                </div>
                {item.type !== 'full' && (
                  <p className="mt-2 text-xs text-slate-600">
                    근무 예정 {item.start}–{item.end}
                  </p>
                )}
              </div>
            ))}
            {expandedLeaves.length === 0 && (
              <p className="py-6 text-sm text-slate-600">
                등록된 휴가·반차가 없어요.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {editor && me && (
        <LeaveEditor
          initial={editor.day}
          existing={editor.existing}
          normalStart={me.settings.normalStart}
          normalEnd={me.settings.normalEnd}
          name={me.name}
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
  name,
  onClose,
}: {
  initial: string;
  existing?: CalendarLeave;
  normalStart: string;
  normalEnd: string;
  name: string;
  onClose: () => void;
}) {
  const { data: me } = useAttendance();
  const [from, setFrom] = useState(initial);
  const [to, setTo] = useState(initial);
  const [common, setCommon] = useState<LeaveDraft>(
    existing
      ? {
          date: initial,
          type: existing.type,
          start: existing.start ?? '',
          end: existing.end ?? '',
          manualEnd: true,
        }
      : { date: initial, type: 'full' }
  );
  const [drafts, setDrafts] = useState<Record<string, LeaveDraft>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const submitLock = useRef(false);

  const recommendations = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'recommendations'],
    queryFn: attendanceApi.recommendations,
  });
  const allDates = dateRange(from, to);
  const dates = allDates.filter((day) => !excluded.includes(day));
  const days = resolveRangeDrafts(dates, common, drafts);
  const saved = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'calendar-range', from, to],
    queryFn: () => attendanceApi.calendar(from, to),
    enabled: !existing && allDates.length > 0,
  });
  const savedByDate = new Map(
    saved.data
      ?.filter((item) => item.userId === me?.userId)
      .map((item) => [item.date, item])
  );
  const newDays = existing
    ? days
    : days.filter((day) => !savedByDate.has(day.date));
  const keptCount = days.length - newDays.length;
  const total = newDays.reduce(
    (sum, day) => sum + (day.type === 'full' ? 1 : 0.5),
    0
  );
  const mutation = useAttendanceAction(
    async (items: LeaveDraft[]) => {
      const clean = items.map(({ date, type, start, end }) => ({
        date,
        type,
        start,
        end,
      }));

      return existing
        ? attendanceApi.updateLeave(existing.id, clean[0])
        : attendanceApi.saveLeaves(clean);
    },
    existing ? '일정을 수정했어요.' : '휴가 일정을 저장했어요.'
  );

  function changeCommon(day: LeaveDraft) {
    setCommon(day);
    setDrafts({});
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitLock.current || mutation.isPending) {
      return;
    }

    setSubmitted(true);

    if (!days.length || (!existing && !saved.isSuccess)) {
      return;
    }

    if (!newDays.length) {
      onClose();

      return;
    }

    const invalid = newDays.find((day) => validateDraft(day));

    if (invalid) {
      const isException = !!drafts[invalid.date];

      if (isException) {
        setAdjusting(true);
        setEditingDate(invalid.date);
      }

      requestAnimationFrame(() =>
        document
          .getElementById(
            isException ? `leave-end-${invalid.date}` : 'leave-end-common'
          )
          ?.focus()
      );

      return;
    }

    submitLock.current = true;

    try {
      await mutation.mutateAsync(newDays);
      onClose();
    } catch {
      // The shared mutation hook shows the error; keep the form for a retry.
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
        className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center"
      >
        <DialogHeader className="shrink-0 border-b px-4 py-5 pr-12 sm:pr-14 sm:pl-6">
          <DialogTitle>휴가 / 반차 {existing ? '수정' : '등록'}</DialogTitle>
        </DialogHeader>
        <form
          id="leave-editor-form"
          onSubmit={submit}
          onInvalid={() => setSubmitted(true)}
          className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
        >
          <fieldset disabled={mutation.isPending} className="min-w-0 space-y-6">
            <p className="text-sm font-semibold">
              {name}{' '}
              <span className="ml-1 text-xs font-normal text-slate-500">
                내 일정
              </span>
            </p>
            <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
              <label className="block min-w-0 space-y-2 text-xs font-medium">
                시작일
                <Input
                  type="date"
                  className="h-11 sm:h-9"
                  required
                  disabled={!!existing}
                  value={from}
                  onChange={(event) => {
                    const next = event.target.value;

                    setFrom(next);

                    if (next > to) {
                      setTo(next);
                    }
                  }}
                />
              </label>
              <label className="block min-w-0 space-y-2 text-xs font-medium">
                종료일
                <Input
                  type="date"
                  className="h-11 sm:h-9"
                  min={from}
                  required
                  disabled={!!existing}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
            </div>
            <LeaveScheduleFields
              day={common}
              id="common"
              normalStart={normalStart}
              normalEnd={normalEnd}
              onChange={changeCommon}
              submitted={submitted}
              required={newDays.length > 0}
              recommendation={
                recommendations.data?.[common.type as 'am' | 'pm']
              }
            />
            <div
              className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-950"
              aria-live="polite"
            >
              <p className="font-semibold">
                {days.length}개 날짜 선택 · {LEAVE_LABELS[common.type]}
              </p>
              {keptCount > 0 && (
                <p className="mt-1.5 text-xs leading-5 text-indigo-800">
                  기존 {keptCount}개 날짜는 그대로 두고, 새로운 {newDays.length}
                  개 날짜를 추가해요.
                </p>
              )}
            </div>
            {!existing && allDates.length > 0 && (
              <details
                open={adjusting}
                onToggle={(event) => setAdjusting(event.currentTarget.open)}
                className="group rounded-xl border"
              >
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  날짜별 조정
                  <span className="flex items-center gap-2 text-xs font-normal text-slate-500">
                    제외 · 개별 변경
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="divide-y border-t px-4">
                  {allDates.map((date) => {
                    const day = days.find((item) => item.date === date);
                    const stored = savedByDate.get(date);
                    const editing = day && editingDate === date && !stored;

                    return (
                      <div key={date} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div
                            className={day ? '' : 'text-slate-400 line-through'}
                          >
                            <span className="font-medium">
                              {date.slice(5).replace('-', '/')}
                            </span>
                            <span className="ml-2 text-slate-600">
                              {stored
                                ? `${LEAVE_LABELS[stored.type]} · 등록됨`
                                : day
                                  ? LEAVE_LABELS[day.type]
                                  : '제외됨'}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            {day && !stored && (
                              <button
                                type="button"
                                className="min-h-11 min-w-11 text-indigo-600"
                                onClick={() =>
                                  setEditingDate(editing ? null : date)
                                }
                              >
                                {editing ? '접기' : '변경'}
                              </button>
                            )}
                            {!stored && (
                              <button
                                type="button"
                                className="flex min-h-11 min-w-11 items-center justify-center text-slate-600"
                                aria-label={`${date} ${day ? '제외' : '다시 추가'}`}
                                onClick={() =>
                                  setExcluded((current) =>
                                    day
                                      ? [...current, date]
                                      : current.filter((item) => item !== date)
                                  )
                                }
                              >
                                {day ? <X className="size-4" /> : '다시 추가'}
                              </button>
                            )}
                          </div>
                        </div>
                        {editing && (
                          <div className="mt-4">
                            <LeaveScheduleFields
                              day={day}
                              id={date}
                              normalStart={normalStart}
                              normalEnd={normalEnd}
                              submitted={submitted}
                              onChange={(next) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [date]: next,
                                }))
                              }
                              recommendation={
                                recommendations.data?.[day.type as 'am' | 'pm']
                              }
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
            {!allDates.length && (
              <p role="alert" className="text-xs text-red-600">
                시작일과 종료일을 확인해 주세요. 한 번에 최대 366일까지 등록할
                수 있어요.
              </p>
            )}
            {!existing && saved.isPending && allDates.length > 0 && (
              <p className="text-xs text-slate-500">
                기존 일정을 확인하고 있어요.
              </p>
            )}
            {!existing && saved.isError && (
              <p role="alert" className="text-xs text-red-600">
                기존 일정을 확인하지 못했어요.{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => saved.refetch()}
                >
                  다시 시도
                </button>
              </p>
            )}
          </fieldset>
        </form>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-4 sm:px-6">
          <span className="text-xs text-slate-600">
            {existing ? '수정할 휴가' : '추가할 휴가'}{' '}
            <b className="text-slate-900">{total}일</b>
          </span>
          <Button
            type="submit"
            form="leave-editor-form"
            className="min-h-11 sm:min-h-9"
            disabled={
              !days.length ||
              mutation.isPending ||
              (!existing && !saved.isSuccess)
            }
          >
            {mutation.isPending
              ? '저장 중…'
              : existing
                ? '수정하기'
                : !newDays.length
                  ? '확인'
                  : '등록하기'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
