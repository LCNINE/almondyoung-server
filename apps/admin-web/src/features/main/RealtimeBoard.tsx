'use client';

import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { useRealtimeTraffic } from '@/lib/services/analytics';
import { formatKstDateTime } from '@/features/statistics/as-of';
import { formatCount, SERIES_COLORS } from '@/features/statistics/shared';
import { HorizontalBarList } from '@/features/statistics/components/widgets';
import { ChevronRight } from 'lucide-react';

/**
 * 실시간 접속. 탭이 열려 있을 때만 폴링한다 — 메인이 선택된 탭만 그리므로
 * 이 컴포넌트가 마운트돼 있다는 것이 곧 "보고 있다"는 뜻이다.
 */
export function RealtimeBoard() {
  const { data, isLoading, isError } = useRealtimeTraffic({ limit: 8 });

  if (isError) {
    return <p className="py-6 text-center text-xs text-red-500">실시간 접속을 불러오지 못했습니다.</p>;
  }
  if (isLoading) return <Skeleton className="h-56 w-full" />;

  if (data && !data.enabled) {
    return (
      <div className="py-10 text-center">
        <p className="text-xs text-gray-500">실시간 접속은 GA4 연동이 필요합니다.</p>
        <p className="mt-1 text-[11px] text-gray-400">
          GA4 속성이 배선되면 최근 30분 접속자가 여기 나타납니다. 연동 전에는 숫자를 지어내지 않습니다.
        </p>
      </div>
    );
  }

  const chartData = (data?.byMinute ?? []).map((bucket) => ({
    label: bucket.minutesAgo === 0 ? '지금' : `${bucket.minutesAgo}분 전`,
    activeUsers: bucket.activeUsers,
  }));
  const observedAt = formatKstDateTime(data?.observedAt);
  const peak = Math.max(...(data?.byMinute ?? []).map((bucket) => bucket.activeUsers), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-xs text-gray-500">
          최근 30분 · 20초마다 갱신
          <span className="ml-1 text-gray-400">(세션이 아니라 사람 수)</span>
        </div>
        <Link
          href="/statistics/traffic"
          className="flex shrink-0 items-center gap-0.5 text-xs text-blue-600 hover:underline"
        >
          유입 분석 <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-[10px] border border-gray-200 p-4">
          <p className="text-xs text-gray-500">지금 보고 있는 사람</p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-gray-900">{formatCount(data?.activeUsers ?? 0)}</p>
          <p className="mt-1 text-[11px] text-gray-400">
            30분 내 최고 {formatCount(peak)}명
            {observedAt ? ` · ${observedAt} 기준` : ''}
          </p>
          <div className="mt-3 h-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" hide />
                <YAxis hide />
                <Tooltip formatter={(value: number) => `${formatCount(value)}명`} />
                <Area
                  type="monotone"
                  dataKey="activeUsers"
                  stroke={SERIES_COLORS[0]}
                  strokeWidth={2}
                  fill={SERIES_COLORS[0]}
                  fillOpacity={0.12}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[10px] border border-gray-200 p-4">
          <p className="mb-3 text-xs font-medium text-gray-700">지금 보고 있는 화면</p>
          {(data?.pages ?? []).length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-400">지금 접속 중인 사람이 없습니다</p>
          ) : (
            <HorizontalBarList
              items={(data?.pages ?? []).map((page) => ({ label: page.label, value: page.activeUsers }))}
              formatValue={(value) => `${formatCount(value)}명`}
            />
          )}
        </div>

        <div className="rounded-[10px] border border-gray-200 p-4">
          <p className="mb-3 text-xs font-medium text-gray-700">기기</p>
          {(data?.devices ?? []).length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-400">지금 접속 중인 사람이 없습니다</p>
          ) : (
            <HorizontalBarList
              items={(data?.devices ?? []).map((device) => ({ label: device.label, value: device.activeUsers }))}
              formatValue={(value) => `${formatCount(value)}명`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
