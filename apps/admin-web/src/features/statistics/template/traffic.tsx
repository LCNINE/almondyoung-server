'use client';

import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrafficChannelGroup } from '@/lib/api/domains/analytics';
import { useTrafficStatistics } from '@/lib/services/analytics';
import { cn } from '@/lib/utils/ui';
import { PaginationBar } from '../components/pagination';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList, KpiTile } from '../components/widgets';
import { formatCount, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

const CHANNEL_GROUP_OPTIONS: Array<{ value: TrafficChannelGroup; label: string }> = [
  { value: 'organic', label: '자연검색' },
  { value: 'all', label: '전체 유입' },
];

// GA4 는 서버 offset 페이지네이션 대신 큰 limit 1회 조회 + 화면 페이지네이션이다 —
// 페이지마다 별도 GA4 호출·캐시 항목이 생기는 것을 피한다 (5분 캐시 1건으로 전체 커버).
const FETCH_LIMIT = 1000;
const PAGE_SIZE = 50;
const COUNTRY_PAGE_SIZE = 20;

export default function TrafficStatisticsTemplate() {
  const range = useStatisticsRange();
  const [channelGroup, setChannelGroup] = useState<TrafficChannelGroup>('organic');
  const [landingPage, setLandingPage] = useState(1);
  const [countryPage, setCountryPage] = useState(1);

  // 조회 조건이 바뀌면 페이지가 범위를 벗어날 수 있다 — 1페이지로 되돌린다
  useEffect(() => {
    setLandingPage(1);
    setCountryPage(1);
  }, [range.from, range.to, channelGroup]);

  const { data, isLoading, isError } = useTrafficStatistics({
    from: range.from,
    to: range.to,
    channelGroup,
    limit: FETCH_LIMIT,
  });

  const totalSessions = data?.totals?.sessions ?? 0;
  const landingRows = (data?.landingPages ?? []).slice((landingPage - 1) * PAGE_SIZE, landingPage * PAGE_SIZE);
  const countryRows = (data?.countries ?? []).slice(
    (countryPage - 1) * COUNTRY_PAGE_SIZE,
    countryPage * COUNTRY_PAGE_SIZE,
  );

  return (
    <StatisticsShell filterOptions={{ channel: false, granularity: false }}>
      <div className="mb-4 flex items-center gap-1">
        {CHANNEL_GROUP_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setChannelGroup(option.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              channelGroup === option.value
                ? 'border-orange-500 bg-orange-50 text-orange-600'
                : 'border-gray-200 text-gray-500 hover:text-gray-800',
            )}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-2 text-xs text-gray-400">GA4 기준 · 자연검색 = 검색엔진 무료 유입</span>
      </div>

      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          GA4 조회에 실패했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : data && !data.enabled ? (
        <p className="py-10 text-center text-sm text-gray-400">
          GA4 연동 대기 중입니다 — 서버에 GA4 설정이 배포되면 자동으로 표시됩니다.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <KpiTile label="세션" value={formatCount(data?.totals?.sessions)} isLoading={isLoading} />
            <KpiTile label="방문자" value={formatCount(data?.totals?.totalUsers)} isLoading={isLoading} />
            <KpiTile label="페이지뷰" value={formatCount(data?.totals?.pageViews)} isLoading={isLoading} />
            <KpiTile
              label="참여율"
              value={formatPercent(data?.totals?.engagementRate)}
              hint="참여 세션 ÷ 전체 세션"
              isLoading={isLoading}
            />
          </div>

          <ChartCard
            title="일별 세션 추이"
            description="GA4 속성 시간대 기준 · 세션이 없는 날은 0으로 표시됩니다."
            isLoading={isLoading}
            isEmpty={!data || data.series.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#999" />
                <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                <Tooltip formatter={(value: number) => formatCount(value)} />
                <Line
                  type="monotone"
                  dataKey="sessions"
                  name="세션"
                  stroke={SERIES_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="랜딩페이지별 세션"
            description="유입이 처음 도착한 페이지 — 상품 페이지가 여기 없으면 검색 유입이 홈에만 몰려 있다는 뜻입니다."
            isLoading={isLoading}
            isEmpty={!data || data.landingPages.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">랜딩페이지</th>
                    <th className="py-1.5 text-right">세션</th>
                    <th className="py-1.5 text-right">비중</th>
                    <th className="py-1.5 text-right">참여율</th>
                  </tr>
                </thead>
                <tbody>
                  {landingRows.map((rowItem, index) => (
                    <tr key={rowItem.path} className="border-b last:border-0">
                      <td className="py-1.5 text-gray-400">{(landingPage - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="py-1.5">
                        <span className="font-medium text-gray-900 break-all">{rowItem.path}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(rowItem.sessions)}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">
                        {totalSessions > 0 ? formatPercent(rowItem.sessions / totalSessions) : '-'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatPercent(rowItem.engagementRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar
              totalItems={data?.landingPages.length}
              page={landingPage}
              pageSize={PAGE_SIZE}
              onPageChange={setLandingPage}
              unitLabel="개 페이지"
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="기기별 세션"
              isLoading={isLoading}
              isEmpty={!data || data.devices.length === 0}
            >
              <HorizontalBarList
                items={(data?.devices ?? []).map((rowItem) => ({ label: rowItem.label, value: rowItem.sessions }))}
                formatValue={formatCount}
              />
            </ChartCard>

            <ChartCard
              title="국가별 세션"
              isLoading={isLoading}
              isEmpty={!data || data.countries.length === 0}
            >
              <HorizontalBarList
                items={countryRows.map((rowItem) => ({ label: rowItem.label, value: rowItem.sessions }))}
                formatValue={formatCount}
              />
              <PaginationBar
                totalItems={data?.countries.length}
                page={countryPage}
                pageSize={COUNTRY_PAGE_SIZE}
                onPageChange={setCountryPage}
                unitLabel="개 국가"
              />
            </ChartCard>
          </div>
        </div>
      )}
    </StatisticsShell>
  );
}
