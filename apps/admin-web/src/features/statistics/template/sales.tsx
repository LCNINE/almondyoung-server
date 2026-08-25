'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useSalesStatistics } from '@/lib/services/analytics';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList, KpiTile } from '../components/widgets';
import { formatCount, formatKrw, formatKrwAxis, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

export default function SalesStatisticsTemplate() {
  const range = useStatisticsRange();
  const { data, isLoading, isError } = useSalesStatistics(range);

  const kpis = data?.kpis;
  const prev = data?.previousKpis;

  return (
    <StatisticsShell>
      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiTile
              label="순매출"
              value={formatKrw(kpis?.netRevenue)}
              previous={kpis && prev ? { current: kpis.netRevenue, previous: prev.netRevenue } : undefined}
              hint="총매출 − 취소 − 환불"
              isLoading={isLoading}
            />
            <KpiTile
              label="주문수"
              value={formatCount(kpis?.ordersCount)}
              previous={kpis && prev ? { current: kpis.ordersCount, previous: prev.ordersCount } : undefined}
              isLoading={isLoading}
            />
            <KpiTile
              label="객단가"
              value={formatKrw(kpis?.avgOrderValue)}
              hint="순매출 ÷ 주문수"
              isLoading={isLoading}
            />
            <KpiTile
              label="취소·환불률"
              value={formatPercent(kpis?.cancelRefundRate)}
              hint="금액 기준 · 100% 초과 가능"
              isLoading={isLoading}
            />
          </div>

          <ChartCard
            title="매출 추이"
            description="취소·환불은 발생일에 귀속됩니다 — 과거 주문이 취소된 날은 순매출이 음수로 내려갈 수 있습니다."
            isLoading={isLoading}
            isEmpty={!data || data.series.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
                <YAxis tick={{ fontSize: 11 }} stroke="#999" tickFormatter={formatKrwAxis} />
                <Tooltip formatter={(value: number) => formatKrw(value)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="grossRevenue"
                  name="총매출"
                  stroke={SERIES_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="netRevenue"
                  name="순매출"
                  stroke={SERIES_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="채널별 순매출" isLoading={isLoading} isEmpty={!data || data.channels.length === 0}>
              <HorizontalBarList
                items={(data?.channels ?? []).map((channel) => ({
                  label: channel.salesChannel,
                  value: channel.netRevenue,
                }))}
                formatValue={formatKrw}
              />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">채널</th>
                      <th className="py-1.5 text-right">총매출</th>
                      <th className="py-1.5 text-right">취소</th>
                      <th className="py-1.5 text-right">환불</th>
                      <th className="py-1.5 text-right">순매출</th>
                      <th className="py-1.5 text-right">주문수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.channels ?? []).map((channel) => (
                      <tr key={channel.salesChannel} className="border-b last:border-0">
                        <td className="py-1.5">{channel.salesChannel}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatKrw(channel.grossRevenue)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatKrw(channel.cancelledAmount)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatKrw(channel.refundedAmount)}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{formatKrw(channel.netRevenue)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(channel.ordersCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>

            <ChartCard
              title="취소 사유 분포"
              description="조회 기간에 발생한 취소 이벤트 기준 (건수)"
              isLoading={isLoading}
              isEmpty={!data || data.cancelReasons.length === 0}
              emptyText="조회 기간에 취소가 없습니다"
            >
              <HorizontalBarList
                items={(data?.cancelReasons ?? []).map((row) => ({ label: row.reason, value: row.count }))}
                formatValue={(value) => `${formatCount(value)}건`}
              />
            </ChartCard>
          </div>
        </div>
      )}
    </StatisticsShell>
  );
}
