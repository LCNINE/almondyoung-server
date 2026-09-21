'use client';

import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { HelpPopover } from '@/features/main/HelpPopover';
import { useRealtimeTraffic, useTrafficStatistics } from '@/lib/services/analytics';
import { formatKstDateTime, kstDaysAgo } from '@/features/statistics/as-of';
import { formatCount } from '@/features/statistics/shared';
import { ExternalLink } from 'lucide-react';
import { TOOLTIP_STYLE } from '@/features/main/chart-style';

const VISIT_DAYS = 7;
const TOTAL_COLOR = '#4DAFFF';
const DEVICE_SERIES = [
  { key: 'mobile', name: 'Mobile', color: '#E566CA' },
  { key: 'desktop', name: 'PC', color: '#9065E6' },
] as const;
const VISIT_COLOR = '#5BC4D8';

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

  const pageData = realtime.data?.pageTypes ?? [];
  const visitData = (traffic.data?.series ?? []).map((point) => ({
    label: point.date.slice(5),
    users: point.users,
  }));
  const observedAt = formatKstDateTime(realtime.data?.observedAt);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div>
        <PanelHeader
          title="실시간 접속자"
          help={[
            '최근 30분 동안 각 화면이 열린 횟수입니다. 한 사람이 같은 화면을 여러 번 열면 그만큼 셉니다.',
            '전체에는 태블릿도 포함됩니다.',
            '20초마다 갱신합니다.',
            ...(observedAt ? [`${observedAt} 기준입니다.`] : []),
          ]}
          href="/statistics/traffic"
        />
        <p className="mb-1 text-xs text-[#757575]">
          단위/회{realtime.isError ? '' : ` · 지금 ${formatCount(realtime.data?.activeUsers ?? 0)}명`}
        </p>
        {realtime.isError ? (
          <p className="py-16 text-center text-xs text-red-500">실시간 접속을 불러오지 못했습니다.</p>
        ) : realtime.isLoading ? (
          <Skeleton className="h-[284px] w-full" />
        ) : pageData.length === 0 ? (
          <p className="py-16 text-center text-xs text-red-500">화면별 조회수를 불러오지 못했습니다.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={256}>
              <ComposedChart data={pageData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#EBEBEB" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#757575' }} stroke="#707070" interval={0} />
                <YAxis
                  tick={{ fontSize: 12, fill: '#757575' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ stroke: '#707070', strokeDasharray: '3 3' }}
                  formatter={(value: number, name: string) => [`${formatCount(value)}회`, name]}
                />
                <Bar dataKey="total" name="전체" fill={TOTAL_COLOR} radius={[4, 4, 0, 0]} maxBarSize={20} />
                {DEVICE_SERIES.map((series) => (
                  <Line
                    key={series.key}
                    type="linear"
                    dataKey={series.key}
                    name={series.name}
                    stroke={series.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#fff', stroke: series.color, strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: '#fff', stroke: series.color, strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
            <ChartLegend>
              {DEVICE_SERIES.map((series) => (
                <span key={series.key} className="inline-flex items-center gap-1.5">
                  <LineIcon color={series.color} />
                  {series.name}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[1px]" style={{ backgroundColor: TOTAL_COLOR }} />
                전체
              </span>
            </ChartLegend>
          </>
        )}
      </div>

      <div>
        <PanelHeader
          title="일별 방문자 수"
          help={[
            '어제까지 최근 7일 동안 하루에 방문한 사람 수입니다.',
            '같은 사람이 하루에 여러 번 들어와도 한 명으로 셉니다.',
          ]}
          href="/statistics/traffic"
        />
        <p className="mb-1 text-xs text-[#757575]">단위/명</p>
        {traffic.isError ? (
          <p className="py-16 text-center text-xs text-red-500">방문자 수를 불러오지 못했습니다.</p>
        ) : traffic.isLoading ? (
          <Skeleton className="h-[284px] w-full" />
        ) : visitData.length === 0 ? (
          <p className="py-16 text-center text-xs text-gray-400">조회 기간에 방문 기록이 없습니다</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={visitData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="visitBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VISIT_COLOR} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={VISIT_COLOR} stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#EBEBEB" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#757575' }} stroke="#707070" />
                <YAxis
                  tick={{ fontSize: 12, fill: '#757575' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: '#F5F5F5' }}
                  formatter={(value: number) => [`${formatCount(value)}명`, '방문자 수']}
                />
                <Bar dataKey="users" name="방문자 수" fill="url(#visitBar)" radius={[8, 8, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
            <ChartLegend>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[1px]" style={{ backgroundColor: VISIT_COLOR }} />
                방문자 수
              </span>
            </ChartLegend>
          </>
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

function ChartLegend({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex justify-center gap-4 text-sm text-[#2B2B2B]">{children}</div>;
}

function LineIcon({ color }: { color: string }) {
  return (
    <svg aria-hidden width="18" height="10" viewBox="0 0 18 10">
      <line x1="0" y1="5" x2="18" y2="5" stroke={color} strokeWidth="2" />
      <circle cx="9" cy="5" r="3" fill="#fff" stroke={color} strokeWidth="2" />
    </svg>
  );
}
