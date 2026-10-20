'use client';

import { useImperativeHandle, useRef, type Ref } from 'react';
import { CylinderWheelColumn } from './cylinder-wheel-column';

const UNITS = [
  { value: 1, label: '분' },
  { value: 60, label: '시간' },
  { value: 1440, label: '일' },
  { value: 10080, label: '주' },
];

export function VacationReminderWheel({
  ref,
  amount,
  unit,
  onAmountChange,
  onUnitChange,
}: {
  ref?: Ref<{ getMinutes: () => number }>;
  amount: number;
  unit: number;
  onAmountChange: (value: number) => void;
  onUnitChange: (value: number) => void;
}) {
  const numberRef = useRef<{ getValue: () => number }>(null);
  const unitRef = useRef<{ getValue: () => number }>(null);

  useImperativeHandle(ref, () => ({
    getMinutes: () => {
      const selectedUnit = unitRef.current?.getValue() ?? unit;
      const selectedAmount = numberRef.current?.getValue() ?? amount;
      const boundedAmount = Math.min(
        selectedAmount,
        Math.floor(525600 / selectedUnit)
      );

      return boundedAmount * selectedUnit;
    },
  }));

  const maximum = Math.min(999, Math.floor(525600 / unit));
  const numbers = Array.from({ length: maximum }, (_, index) => ({
    value: index + 1,
    label: String(index + 1),
  }));

  return (
    <div className="relative mx-auto flex w-full max-w-xs min-w-0 gap-0">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[88px] h-11 rounded-xl border-y border-indigo-100 bg-indigo-50/60"
      />
      <CylinderWheelColumn
        ref={numberRef}
        label="알림 숫자"
        options={numbers}
        value={amount}
        onChange={onAmountChange}
      />
      <CylinderWheelColumn
        ref={unitRef}
        label="알림 단위"
        options={UNITS}
        value={unit}
        onChange={(next) => {
          const currentAmount = numberRef.current?.getValue() ?? amount;

          onAmountChange(Math.min(currentAmount, Math.floor(525600 / next)));
          onUnitChange(next);
        }}
      />
    </div>
  );
}
