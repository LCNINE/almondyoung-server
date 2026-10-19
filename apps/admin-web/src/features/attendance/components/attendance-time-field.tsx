'use client';

import { useId, useRef, useState } from 'react';
import { Clock3, X } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { joinClockPeriod, splitClockPeriod } from '../lib/clock-period';
import { CylinderWheelColumn } from './cylinder-wheel-column';

const PERIODS = [
  { value: 0, label: '오전' },
  { value: 1, label: '오후' },
];

const HOURS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: String(index + 1),
}));

const MINUTES = Array.from({ length: 60 }, (_, value) => ({
  value,
  label: String(value).padStart(2, '0'),
}));

export function AttendanceTimeField({
  id,
  label,
  displayLabel,
  value,
  onChange,
  disabled = false,
  required = false,
  compact = false,
  clearable = false,
}: {
  id?: string;
  label: string;
  displayLabel?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  compact?: boolean;
  clearable?: boolean;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(0);
  const periodRef = useRef<{ getValue: () => number }>(null);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const hourRef = useRef<{ getValue: () => number }>(null);
  const minuteRef = useRef<{ getValue: () => number }>(null);

  function startEditing() {
    const clock = splitClockPeriod(value);

    setPeriod(clock.period);
    setHour(clock.hour);
    setMinute(clock.minute);
    setOpen(true);
  }

  function confirm() {
    const hours = hourRef.current?.getValue() ?? hour;
    const minutes = minuteRef.current?.getValue() ?? minute;

    onChange(
      joinClockPeriod(periodRef.current?.getValue() ?? period, hours, minutes)
    );
    setOpen(false);
  }

  return (
    <>
      <button
        id={fieldId}
        type="button"
        aria-label={label}
        aria-describedby={`${fieldId}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={startEditing}
        className={
          compact
            ? 'relative flex h-11 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50'
            : 'group relative flex h-16 w-full min-w-0 items-end rounded-xl border border-input bg-white px-4 pt-7 pr-12 pb-2.5 text-left text-base shadow-xs outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50'
        }
      >
        {!compact && (
          <span
            className={`pointer-events-none absolute left-4 text-slate-500 transition-all group-focus-visible:top-2 group-focus-visible:translate-y-0 group-focus-visible:text-xs group-focus-visible:text-indigo-600 motion-reduce:transition-none ${value ? 'top-2 text-xs' : 'top-1/2 -translate-y-1/2 text-base'}`}
          >
            {displayLabel ?? label}
            {required && <span aria-hidden> *</span>}
          </span>
        )}
        <span id={`${fieldId}-value`} className="min-w-0 tabular-nums">
          {value || (compact ? '시간 선택' : '\u00a0')}
        </span>
        {!compact && (
          <Clock3
            className="absolute top-1/2 right-4 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
        )}
      </button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        repositionInputs={false}
        autoFocus
      >
        <DrawerContent className="mx-auto w-full max-w-md overflow-hidden rounded-t-3xl pb-[env(safe-area-inset-bottom)]">
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
            <DrawerTitle className="min-w-0 text-base">
              {label} 설정
            </DrawerTitle>
            <button
              type="button"
              aria-label={`${label} 설정 닫기`}
              onClick={() => setOpen(false)}
              className="flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="min-w-0 overflow-y-auto px-5 pb-5">
            <DrawerDescription className="text-center text-xs text-slate-500">
              오전·오후와 시, 분을 위아래로 돌려 선택하세요.
            </DrawerDescription>
            <div
              aria-hidden
              className="mx-auto mt-4 grid w-full max-w-xs grid-cols-3 text-center text-xs text-slate-400"
            >
              <span>오전·오후</span>
              <span>시</span>
              <span>분</span>
            </div>
            <div className="relative mx-auto flex w-full max-w-xs min-w-0">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-[88px] h-11 rounded-xl border-y border-indigo-100 bg-indigo-50/60"
              />
              <CylinderWheelColumn
                ref={periodRef}
                label={`${label} 오전·오후`}
                options={PERIODS}
                value={period}
                onChange={setPeriod}
              />
              <CylinderWheelColumn
                loop
                ref={hourRef}
                label={`${label} 시`}
                options={HOURS}
                value={hour}
                onChange={setHour}
              />
              <CylinderWheelColumn
                loop
                ref={minuteRef}
                label={`${label} 분`}
                options={MINUTES}
                value={minute}
                onChange={setMinute}
              />
            </div>
            {clearable && value && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="mb-3 min-h-11 w-full rounded-xl bg-slate-50 text-sm text-slate-600"
              >
                시간 지우기
              </button>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-12 rounded-xl bg-slate-100 font-medium"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirm}
                className="h-12 rounded-xl bg-indigo-600 font-medium text-white"
              >
                확인
              </button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
