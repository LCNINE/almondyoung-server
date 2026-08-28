'use client';

import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import { ArrowRight } from 'lucide-react';
import { BusinessHealth, HealthTone } from '../business-health';

const TONE: Record<HealthTone, { chip: string; dot: string; label: string }> = {
  good: { chip: 'border-emerald-200 bg-emerald-50', dot: 'bg-emerald-500', label: '좋음' },
  watch: { chip: 'border-amber-200 bg-amber-50', dot: 'bg-amber-500', label: '주의' },
  bad: { chip: 'border-red-200 bg-red-50', dot: 'bg-red-500', label: '나쁨' },
  unknown: { chip: 'border-gray-200 bg-gray-50', dot: 'bg-gray-300', label: '판정 불가' },
};

const VERDICT_STYLE: Record<HealthTone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  watch: 'border-amber-200 bg-amber-50 text-amber-900',
  bad: 'border-red-200 bg-red-50 text-red-900',
  unknown: 'border-gray-200 bg-gray-50 text-gray-700',
};

/**
 * 경영 진단. "숫자를 늘어놓기"가 아니라 "그래서 어떤 상태인가"를 먼저 말한다 —
 * 판정 한 줄이 맨 위, 근거 다섯 축이 그 아래.
 */
export function BusinessHealthCard({
  health,
  isLoading,
  rangeLabel,
  needsFixedCost,
}: {
  health: BusinessHealth;
  isLoading?: boolean;
  rangeLabel: string;
  needsFixedCost: boolean;
}) {
  return (
    <section className="rounded-[10px] border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">경영 진단</h2>
        <span className="text-[11px] text-gray-400">{rangeLabel} · 원가·수수료·재고 금액은 근사치입니다</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className={cn('rounded-lg border px-4 py-3', VERDICT_STYLE[health.verdict.tone])}>
            <p className="text-lg font-bold">{health.verdict.headline}</p>
            <p className="mt-1 text-xs opacity-80">{health.verdict.detail}</p>
            {needsFixedCost ? (
              <Link
                href="/statistics/settings"
                className="mt-2 inline-flex items-center gap-1 rounded border border-current px-2 py-1 text-[11px] font-medium hover:opacity-80"
              >
                월 고정비 입력하기 <ArrowRight className="h-3 w-3" />
              </Link>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {health.axes.map((axis) => (
              <div key={axis.key} className={cn('rounded-lg border p-3', TONE[axis.tone].chip)}>
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', TONE[axis.tone].dot)} aria-hidden />
                  <span className="text-xs font-medium text-gray-700">{axis.label}</span>
                  <span className="sr-only">{TONE[axis.tone].label}</span>
                </div>
                <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{axis.value}</p>
                <p className="mt-1 text-[11px] leading-snug text-gray-500">{axis.detail}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
