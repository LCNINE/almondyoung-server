'use client';

import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { HelpPopover } from '@/features/main/HelpPopover';
import { useRealtimeTraffic, useTrafficStatistics } from '@/lib/services/analytics';
import { formatKstDateTime, kstDaysAgo } from '@/features/statistics/as-of';
import { formatCount, SERIES_COLORS } from '@/features/statistics/shared';
import { ExternalLink } from 'lucide-react';

const VISIT_DAYS = 7;

/**
 * 실시간 접속. 탭이 열려 있을 때만 폴링한다 — 메인이 선택된 탭만 그리므로
 * 이 컴포넌트가 마운트돼 있다는 것이 곧 "보고 있다"는 뜻이다.
 */
export function RealtimeBoard() {
  const realtime = useRealtimeTraffic({ limit: 8 });
  const traffic = useTrafficStatistics({ from: kstDaysAgo(VISIT_DAYS), to: kstDaysAgo(1) });

  if (realtime.data && !realtime.data.enabled) {
    return (
      <div className="py-10 text-center">
        <p className="text-xs text-gray-500">실시간 접속은 GA4 연동이 필요합니다.</p>
        <p className="mt-1 text-[11px] text-gray-400">
          GA4 속성이 배선되면 최근 30분 접속자가 여기 나타납니다. 연동 전에는 숫자를 지어내지 않습니다.
        </p>
      </div>
    );
  }

  const pageData = (realtime.data?.pages ?? []).map((page) => ({ label: page.label, activeUsers: page.activeUsers }));
  const visitData = (traffic.data?.series ?? []).map((point) => ({
    label: point.date.slice(5),
    sessions: point.sessions,
  }));
  const observedAt = formatKstDateTime(realtime.data?.observedAt);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div>
        <PanelHeader
          title="실시간 접속자"
          help={[
            '최근 30분 동안 화면별로 보고 있는 사람 수입니다.',
            '20초마다 갱신합니다.',
            ...(observedAt ? [`${observedAt} 기준입니다.`] : []),
          ]}
          href="/statistics/traffic"
        />
        <p className="mb-1 text-xs text-[#757575]">
          단위/명{realtime.isError ? '' : ` · 지금 ${formatCount(realtime.data?.activeUsers ?? 0)}명`}
        </p>
        {realtime.isError ? (
          <p className="py-16 text-center text-xs text-red-500">실시간 접속을 불러오지 못했습니다.</p>
        ) : realtime.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : pageData.length === 0 ? (
          <p className="py-16 text-center text-xs text-gray-400">지금 접속 중인 사람이 없습니다</p>
        ) : (
          <ResponsiveContainer width="100%" height={256}>
            <LineChart data={pageData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#eee" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#999" interval={0} />
              <YAxis tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} width={32} />
              <Tooltip formatter={(value: number) => `${formatCount(value)}명`} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 13, color: '#616161' }} />
              <Line
                type="linear"
                dataKey="activeUsers"
                name="전체"
                stroke="#8B5CF6"
                strokeWidth={2}
                dot={{ r: 4, fill: '#fff', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div>
        <PanelHeader
          title="일별 방문 수"
          help={['어제까지 최근 7일의 방문(세션) 수입니다.', '한 사람이 여러 번 들어오면 여러 번 셉니다.']}
          href="/statistics/traffic"
        />
        <p className="mb-1 text-xs text-[#757575]">단위/회</p>
        {traffic.isError ? (
          <p className="py-16 text-center text-xs text-red-500">방문 수를 불러오지 못했습니다.</p>
        ) : traffic.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : visitData.length === 0 ? (
          <p className="py-16 text-center text-xs text-gray-400">조회 기간에 방문 기록이 없습니다</p>
        ) : (
          <ResponsiveContainer width="100%" height={256}>
            <BarChart data={visitData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#eee" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#999" />
              <YAxis tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} width={40} />
              <Tooltip formatter={(value: number) => `${formatCount(value)}회`} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 13, color: '#616161' }} />
              <Bar dataKey="sessions" name="방문 수" fill={SERIES_COLORS[0]} radius={[8, 8, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function PanelHeader({ title, help, href }: { title: string; help: string[]; href: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h3 className="text-[15px] font-bold text-[#1C1C1C]">{title}</h3>
      <HelpPopover label={title} items={help} />
      <Link href={href} className="flex items-center gap-0.5 text-[13px] text-[#1779BA] hover:underline">
        자세히 보기 <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}
