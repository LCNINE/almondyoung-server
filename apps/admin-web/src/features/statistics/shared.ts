'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Granularity, StatisticsRangeQuery } from '@/lib/api/domains/analytics';
import { toLocalDateString } from '@/lib/utils/date';

/**
 * 시리즈 팔레트 — dataviz 검증 통과(light, 인접쌍 CVD ΔE≥8, 순서 고정).
 * 3·4번 색은 밝은 배경 대비가 3:1 미만이라 반드시 직접 라벨/표와 함께 쓴다.
 */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;

export function formatKrw(value: number | null | undefined): string {
  if (value == null) return '-';
  return `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return '-';
  return value.toLocaleString('ko-KR');
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

/** 전기간 대비 증감률. 기준이 0이면 비교 불가(null). */
export function changeRate(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

export function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: toLocalDateString(from), to: toLocalDateString(to) };
}

/** URL 쿼리에서 통계 조회 조건을 읽는다. 탭 전환 시 쿼리가 유지되어 조건이 따라간다. */
export function useStatisticsRange(): StatisticsRangeQuery {
  const searchParams = useSearchParams();
  return useMemo(() => {
    const fallback = defaultRange();
    const from = searchParams.get('from') ?? fallback.from;
    const to = searchParams.get('to') ?? fallback.to;
    const channel = searchParams.get('channel') ?? undefined;
    const granularity = (searchParams.get('granularity') as Granularity) ?? 'day';
    return { from, to, channel, granularity };
  }, [searchParams]);
}
