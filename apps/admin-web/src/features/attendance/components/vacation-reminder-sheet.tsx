'use client';

import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { VacationReminderWheel } from './vacation-reminder-wheel';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';

export function reminderLabel(minutes: number): string {
  if (minutes === 0) {
    return '시작 시각';
  }

  if (minutes % 10080 === 0) {
    return `시작 ${minutes / 10080}주 전`;
  }

  if (minutes % 1440 === 0) {
    return `시작 ${minutes / 1440}일 전`;
  }

  if (minutes % 60 === 0) {
    return `시작 ${minutes / 60}시간 전`;
  }

  return `시작 ${minutes}분 전`;
}

export function VacationReminderSheet({
  open,
  allDay,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  allDay: boolean;
  onOpenChange: (open: boolean) => void;
  value: number[];
  onChange: (value: number[]) => void;
}) {
  const wheelRef = useRef<{ getMinutes: () => number }>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [amount, setAmount] = useState(30);
  const [unit, setUnit] = useState(1);
  const customMinutes = amount * unit;
  const customValid = customMinutes > 0 && customMinutes <= 525600;
  const customValues = value.filter(
    (minutes) => minutes !== 10 && minutes !== 60
  );

  function changeOpen(next: boolean) {
    onOpenChange(next);

    if (!next) {
      setCustomOpen(false);
    }
  }

  function toggle(minutes: number) {
    const next = value.includes(minutes)
      ? value.filter((current) => current !== minutes)
      : [...value, minutes];

    onChange(next.sort((left, right) => left - right));
  }

  return (
    <Drawer
      open={open}
      onOpenChange={changeOpen}
      repositionInputs={false}
      autoFocus
    >
      <DrawerContent className="mx-auto w-full max-w-md overflow-hidden rounded-t-3xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex shrink-0 items-center justify-between px-5 py-4">
          <DrawerTitle>
            {customOpen ? '알림 시간을 설정하세요' : '알림'}
          </DrawerTitle>
          <button
            type="button"
            aria-label="알림 설정 닫기"
            onClick={() => changeOpen(false)}
            className="flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-w-0 overflow-y-auto px-5 pb-6">
          {customOpen ? (
            <>
              <DrawerDescription className="sr-only">
                왼쪽 숫자와 오른쪽 분, 시간, 일, 주를 위아래로 돌려 선택하세요.
              </DrawerDescription>
              <VacationReminderWheel
                ref={wheelRef}
                amount={amount}
                unit={unit}
                onAmountChange={setAmount}
                onUnitChange={setUnit}
              />
              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCustomOpen(false)}
                  className="h-12 rounded-xl bg-slate-100 font-medium"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={
                    !customValid ||
                    (value.length >= 5 && !value.includes(customMinutes))
                  }
                  onClick={() => {
                    const selectedMinutes =
                      wheelRef.current?.getMinutes() ?? customMinutes;

                    if (!value.includes(selectedMinutes) && value.length < 5) {
                      onChange(
                        [...value, selectedMinutes].sort(
                          (left, right) => left - right
                        )
                      );
                    }

                    setCustomOpen(false);
                  }}
                  className="h-12 rounded-xl bg-indigo-600 font-medium text-white disabled:opacity-40"
                >
                  확인
                </button>
              </div>
            </>
          ) : (
            <>
              <DrawerDescription
                className="pb-5 text-sm text-slate-500"
                aria-live="polite"
              >
                {value.length === 0
                  ? '알림이 설정되어 있지 않습니다.'
                  : value.map(reminderLabel).join(' · ')}
              </DrawerDescription>
              <h3 className="border-t pt-5 pb-2 text-sm font-semibold text-slate-500">
                일정 알림
              </h3>
              {allDay && (
                <p className="pb-2 text-xs leading-5 text-slate-500">
                  종일 휴가는 시작일 오전 9시를 기준으로 알려드려요.
                </p>
              )}
              <div className="flex flex-col">
                {[10, 60, ...customValues].map((minutes) => (
                  <button
                    type="button"
                    key={minutes}
                    role="checkbox"
                    aria-checked={value.includes(minutes)}
                    disabled={!value.includes(minutes) && value.length >= 5}
                    onClick={() => toggle(minutes)}
                    className="flex min-h-14 items-center justify-between gap-3 text-left text-base focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                  >
                    {reminderLabel(minutes)}
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded border ${value.includes(minutes) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'}`}
                    >
                      {value.includes(minutes) && (
                        <Check className="size-4" aria-hidden />
                      )}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  aria-expanded={customOpen}
                  onClick={() => setCustomOpen(!customOpen)}
                  className="min-h-14 text-left text-base focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  임의
                </button>
              </div>
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="mt-3 min-h-11 w-full rounded-lg bg-slate-100 text-sm"
                >
                  알림 없음으로 변경
                </button>
              )}
              <button
                type="button"
                onClick={() => changeOpen(false)}
                className="mt-5 h-12 w-full rounded-xl bg-indigo-600 font-medium text-white"
              >
                완료
              </button>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
