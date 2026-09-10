'use client';

import { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import { changeRate, formatPercent, SERIES_COLORS } from '../shared';

export function KpiTile({
  label,
  value,
  previous,
  hint,
  isLoading,
}: {
  label: string;
  value: string;
  /** 전기간 대비 증감 표기용 — {current, previous} 원값 */
  previous?: { current: number; previous: number };
  hint?: string;
  isLoading?: boolean;
}) {
  const rate = previous ? changeRate(previous.current, previous.previous) : null;
  return (
    <Card className="bg-white border border-gray-200 shadow-sm">
      <CardContent className="p-5">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        {isLoading ? (
          <Skeleton className="h-8 w-24 mt-1" />
        ) : (
          <p className="text-2xl font-bold mt-1 text-gray-900 tabular-nums">{value}</p>
        )}
        {rate != null && (
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span
              className={cn(
                'font-medium tabular-nums whitespace-nowrap',
                rate >= 0 ? 'text-emerald-600' : 'text-red-600',
              )}
            >
              {rate >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(rate))}
            </span>
            <span className="whitespace-nowrap text-gray-400">전기간 대비</span>
          </div>
        )}
        {/* hint 는 «자기 줄»에 둔다. 증감 배지와 같은 flex 줄에 놓으면 셋이 서로를 쥐어짜
            「전기간 대 / 비」처럼 낱말 중간에서 끊긴다(리뷰·이익·매출 타일에서 실측). */}
        {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function ChartCard({
  title,
  description,
  children,
  isLoading,
  isEmpty,
  emptyText = '조회 기간에 데이터가 없습니다',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyText?: string;
}) {
  return (
    <Card className="bg-white border border-gray-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-gray-900 text-base">{title}</CardTitle>
        {description && <p className="text-xs text-gray-400">{description}</p>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : isEmpty ? (
          <p className="py-10 text-center text-sm text-gray-400">{emptyText}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** 가로 막대 목록 — 값이 큰 순으로 정렬된 입력을 그대로 그린다. 직접 라벨 포함(대비 WARN 대응). */
export function HorizontalBarList({
  items,
  formatValue,
}: {
  items: Array<{ label: string; value: number }>;
  formatValue: (value: number) => string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="w-40 shrink-0 truncate text-xs text-gray-600" title={item.label}>
            {item.label}
          </span>
          <div className="h-4 flex-1 rounded bg-gray-100">
            <div
              className="h-4 rounded"
              style={{
                width: `${Math.max((item.value / max) * 100, 0)}%`,
                backgroundColor: SERIES_COLORS[0],
              }}
            />
          </div>
          <span className="w-28 shrink-0 text-right text-xs tabular-nums text-gray-900">
            {formatValue(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
