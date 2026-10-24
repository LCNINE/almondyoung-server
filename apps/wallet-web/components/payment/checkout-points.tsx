'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  availablePoints: number;
  maxPoints: number;
  points: number;
  onChange: (points: number) => void;
}

export function CheckoutPoints({ availablePoints, maxPoints, points, onChange }: Props) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label="아몬드영 포인트">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center justify-between px-1 pb-3 text-left"
      >
        <h2 className="text-lg font-bold">포인트 사용</h2>
        <span className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-primary">{availablePoints.toLocaleString('ko-KR')}P</span>
          {open ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
        </span>
      </button>
      {open && (
        <div className="rounded-2xl border border-[#e9e9e9] bg-white p-5">
          <label htmlFor="checkout-points" className="text-sm font-medium">
            아몬드영 포인트
          </label>
          <div className="mt-3 flex gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-border px-3 focus-within:border-primary">
              <input
                id="checkout-points"
                inputMode="numeric"
                type="text"
                value={points || ''}
                placeholder="0"
                onChange={(event) => onChange(Math.min(maxPoints, Number(event.target.value.replace(/[^0-9]/g, ''))))}
                className="h-12 w-full min-w-0 bg-transparent text-right font-semibold outline-none"
              />
              <span className="ml-2 text-sm text-muted-foreground">P</span>
            </div>
            <button
              type="button"
              onClick={() => onChange(points === maxPoints ? 0 : maxPoints)}
              disabled={maxPoints === 0}
              className="rounded-xl bg-muted px-4 text-sm font-semibold disabled:opacity-50"
            >
              {points > 0 && points === maxPoints ? '사용 취소' : '전액 사용'}
            </button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            1P = 1원 · 최대 {maxPoints.toLocaleString('ko-KR')}P 사용 가능
          </p>
        </div>
      )}
    </section>
  );
}
