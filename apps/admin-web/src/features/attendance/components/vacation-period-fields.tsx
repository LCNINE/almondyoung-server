'use client';

import { useState } from 'react';
import {
  Bell,
  BellOff,
  CalendarDays,
  ChevronRight,
  Clock3,
  Repeat2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AttendanceTimeField } from './attendance-time-field';
import type { LeaveRecurrence } from '@packages/domain-types/attendance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  VacationReminderSheet,
  reminderLabel,
} from './vacation-reminder-sheet';

export type VacationRecurrence = LeaveRecurrence;

const REPEAT_LABELS = {
  none: '없음',
  weekly: '매주',
  monthly: '매월',
  yearly: '매년',
};

function dateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return '날짜 선택';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${value}T12:00:00`));
}

function DateButton({
  label,
  value,
  min,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative flex h-11 min-w-0 items-center justify-center rounded-lg bg-slate-100 px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-indigo-500">
      <span aria-hidden className="block min-w-0 truncate whitespace-nowrap">
        {dateLabel(value)}
      </span>
      <input
        aria-label={label}
        type="date"
        value={value}
        min={min}
        required
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // Native date inputs remain usable where showPicker is unavailable.
          }
        }}
        className="absolute inset-0 h-full w-full min-w-0 max-w-full cursor-pointer appearance-none opacity-0"
      />
    </label>
  );
}

export function VacationPeriodFields({
  allDay,
  from,
  to,
  startTime,
  endTime,
  recurrence,
  showDday,
  reminderMinutes,
  onReminderChange,
  datesLocked = false,
  onAllDayChange,
  onFromChange,
  onToChange,
  onStartTimeChange,
  onEndTimeChange,
  onRecurrenceChange,
  onDdayChange,
}: {
  allDay: boolean;
  from: string;
  to: string;
  startTime: string;
  endTime: string;
  recurrence: VacationRecurrence;
  showDday: boolean;
  reminderMinutes: number[];
  onReminderChange: (value: number[]) => void;
  datesLocked?: boolean;
  onAllDayChange: (value: boolean) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onRecurrenceChange: (value: VacationRecurrence) => void;
  onDdayChange: (value: boolean) => void;
}) {
  const [reminderOpen, setReminderOpen] = useState(false);
  const reminderText =
    reminderMinutes.length === 0
      ? '알림 없음'
      : reminderMinutes.map(reminderLabel).join(', ');

  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatDraft, setRepeatDraft] = useState(recurrence);

  return (
    <div className="min-w-0 text-slate-900">
      <div className="flex min-h-16 items-center justify-between gap-4">
        <label
          htmlFor="vacation-all-day"
          className="flex min-h-11 items-center gap-3 text-base"
        >
          <Clock3 className="size-5 text-indigo-600" aria-hidden />
          종일
        </label>
        <Switch
          id="vacation-all-day"
          checked={allDay}
          onCheckedChange={onAllDayChange}
        />
      </div>
      <div className="grid min-h-16 min-w-0 grid-cols-[28px_minmax(0,1fr)_80px] items-center gap-2 pl-8">
        <span className="text-sm">시작</span>
        <DateButton
          label="휴가 시작일"
          value={from}
          disabled={datesLocked}
          onChange={onFromChange}
        />
        <AttendanceTimeField
          compact
          label="휴가 시작 시각"
          value={startTime}
          onChange={(value) => {
            onAllDayChange(false);
            onStartTimeChange(value);
          }}
        />
      </div>
      <div className="grid min-h-16 min-w-0 grid-cols-[28px_minmax(0,1fr)_80px] items-center gap-2 pl-8">
        <span className="text-sm">종료</span>
        <DateButton
          label="휴가 종료일"
          value={to}
          min={from}
          disabled={datesLocked}
          onChange={onToChange}
        />
        <AttendanceTimeField
          compact
          label="휴가 종료 시각"
          value={endTime}
          onChange={(value) => {
            onAllDayChange(false);
            onEndTimeChange(value);
          }}
        />
      </div>
      {allDay && (
        <p className="mt-1 pl-8 text-xs leading-5 text-slate-400">
          시간을 선택하면 종일이 해제돼요.
        </p>
      )}
      <button
        type="button"
        aria-label={`휴가 알림 설정: ${reminderText}`}
        aria-haspopup="dialog"
        aria-expanded={reminderOpen}
        onClick={() => setReminderOpen(true)}
        className="mt-3 flex min-h-16 w-full min-w-0 items-center gap-3 border-t text-left text-base focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {reminderMinutes.length === 0 ? (
          <BellOff className="size-5 shrink-0 text-indigo-600" aria-hidden />
        ) : (
          <Bell className="size-5 shrink-0 text-indigo-600" aria-hidden />
        )}
        <span className="min-w-0 flex-1 break-words">{reminderText}</span>
        <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      <VacationReminderSheet
        open={reminderOpen}
        allDay={allDay}
        onOpenChange={setReminderOpen}
        value={reminderMinutes}
        onChange={onReminderChange}
      />
      <div className="flex flex-wrap gap-2 pt-3 pl-8">
        <button
          type="button"
          disabled={datesLocked}
          onClick={() => {
            setRepeatDraft(recurrence);
            setRepeatOpen(true);
          }}
          className="flex min-h-11 items-center gap-2 rounded-full bg-slate-50 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
          aria-label={`반복: ${REPEAT_LABELS[recurrence.frequency]}`}
        >
          <Repeat2 className="size-4 text-indigo-600" aria-hidden />
          {recurrence.frequency === 'none'
            ? '반복'
            : REPEAT_LABELS[recurrence.frequency]}
        </button>
        <button
          type="button"
          aria-pressed={showDday}
          onClick={() => onDdayChange(!showDday)}
          className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${showDday ? 'bg-indigo-50 font-medium text-indigo-700' : 'bg-slate-50'}`}
        >
          <CalendarDays className="size-4 text-indigo-600" aria-hidden />
          디데이
        </button>
      </div>
      <Dialog open={repeatOpen} onOpenChange={setRepeatOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>반복</DialogTitle>
            <DialogDescription>
              반복 방식과 마지막으로 반복할 시작일을 선택해 주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex flex-col gap-3 text-sm">
              반복 방식
              <select
                className="h-12 w-full min-w-0 rounded-lg border bg-white px-3 text-base"
                value={repeatDraft.frequency}
                onChange={(event) =>
                  setRepeatDraft((current) => ({
                    ...current,
                    frequency: event.target
                      .value as VacationRecurrence['frequency'],
                  }))
                }
              >
                {Object.entries(REPEAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {repeatDraft.frequency !== 'none' && (
              <div className="flex items-center justify-between gap-4 text-sm">
                <span>반복 종료</span>
                <DateButton
                  label="반복 종료일"
                  min={to}
                  value={repeatDraft.until ?? ''}
                  onChange={(until) =>
                    setRepeatDraft((current) => ({ ...current, until }))
                  }
                />
              </div>
            )}
            <Button
              type="button"
              className="h-12 w-full rounded-xl"
              disabled={
                repeatDraft.frequency !== 'none' &&
                (!repeatDraft.until || repeatDraft.until < to)
              }
              onClick={() => {
                onRecurrenceChange(
                  repeatDraft.frequency === 'none'
                    ? { frequency: 'none' }
                    : repeatDraft
                );
                setRepeatOpen(false);
              }}
            >
              확인
              <ChevronRight className="ml-1 size-4" aria-hidden />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
