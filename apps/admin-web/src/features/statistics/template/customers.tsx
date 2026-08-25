'use client';

import { useMemo } from 'react';
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
import { useCustomerStatistics } from '@/lib/services/analytics';
import { useTiersWithPlans } from '@/lib/services/membership';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList, KpiTile } from '../components/widgets';
import { formatCount, formatKrw, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

export default function CustomerStatisticsTemplate() {
  const range = useStatisticsRange();
  const { data, isLoading, isError } = useCustomerStatistics(range);
  // analytics 는 tierId 만 안다 — 등급 이름은 membership 등급 목록으로 매핑하고, 실패하면 id 그대로 둔다.
  const { data: tiersWithPlans } = useTiersWithPlans();
  const tierLabel = useMemo(() => {
    const byId = new Map((tiersWithPlans ?? []).map(({ tier }) => [tier.id, tier.code]));
    return (tierId: string) => {
      if (tierId === 'GUEST') return '비회원';
      if (tierId === 'NON_MEMBER') return '일반 회원';
      if (tierId === 'UNKNOWN') return '등급 미상';
      return byId.get(tierId) ?? tierId;
    };
  }, [tiersWithPlans]);

  // 멤버십 추이는 (날짜, tier) 행으로 오므로 tier 를 시리즈 컬럼으로 피벗한다.
  const membershipSeries = useMemo(() => {
    const rows = data?.membershipTrend ?? [];
    const tiers = [...new Set(rows.map((row) => row.tierId))];
    const byDate = new Map<string, Record<string, number | string>>();
    for (const row of rows) {
      const entry = byDate.get(row.aggDate) ?? { aggDate: row.aggDate };
      entry[row.tierId] = row.membersCount;
      byDate.set(row.aggDate, entry);
    }
    return { tiers, rows: [...byDate.values()] };
  }, [data?.membershipTrend]);

  const lifetime = data?.lifetime;

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
              label="누적 구매 고객"
              value={formatCount(lifetime?.customersTotal)}
              hint="전 기간 누적 · 비회원 주문 제외"
              isLoading={isLoading}
            />
            <KpiTile
              label="재구매율"
              value={formatPercent(lifetime?.repurchaseRate)}
              hint="2회 이상 구매 고객 비율 (전 기간)"
              isLoading={isLoading}
            />
            <KpiTile
              label="고객당 누적 구매액"
              value={formatKrw(lifetime?.avgRevenuePerCustomer)}
              hint="총매출 기준"
              isLoading={isLoading}
            />
            <KpiTile
              label="누적 주문수"
              value={formatCount(lifetime?.ordersTotal)}
              hint="전 기간 누적"
              isLoading={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="신규 고객 추이"
              description="조회 기간에 첫 주문이 발생한 고객 수"
              isLoading={isLoading}
              isEmpty={!data || data.newCustomers.length === 0}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.newCustomers ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                  <Tooltip formatter={(value: number) => `${formatCount(value)}명`} />
                  <Bar dataKey="count" name="신규 고객" fill={SERIES_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="고객 생애 구매액 분포"
              description="전 기간 누적 · 총매출 기준"
              isLoading={isLoading}
              isEmpty={!data || data.lifetimeDistribution.every((bucket) => bucket.count === 0)}
            >
              <HorizontalBarList
                items={(data?.lifetimeDistribution ?? []).map((bucket) => ({
                  label: bucket.bucket,
                  value: bucket.count,
                }))}
                formatValue={(value) => `${formatCount(value)}명`}
              />
            </ChartCard>
          </div>

          <ChartCard
            title="멤버십 회원 수 추이"
            description="일별 스냅샷 (활성 기준). 스냅샷 크론 가동 이후 날짜만 존재합니다."
            isLoading={isLoading}
            isEmpty={!data || membershipSeries.rows.length === 0}
            emptyText="아직 기록된 스냅샷이 없습니다"
          >
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={membershipSeries.rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="aggDate" tick={{ fontSize: 11 }} stroke="#999" />
                <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                <Tooltip formatter={(value: number) => `${formatCount(value)}명`} />
                <Legend />
                {membershipSeries.tiers.slice(0, 4).map((tier, index) => (
                  <Line
                    key={tier}
                    type="monotone"
                    dataKey={tier}
                    name={tierLabel(tier)}
                    stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="등급별 매출·객단가"
              description="주문 발생 시각의 멤버십 등급으로 귀속 (총매출 기준). GUEST=비회원, NON_MEMBER=멤버십 미가입 회원."
              isLoading={isLoading}
              isEmpty={!data || data.tierRevenue.length === 0}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">등급</th>
                      <th className="py-1.5 text-right">총매출</th>
                      <th className="py-1.5 text-right">주문수</th>
                      <th className="py-1.5 text-right">고객수</th>
                      <th className="py-1.5 text-right">객단가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.tierRevenue ?? []).map((row) => (
                      <tr key={row.tierId} className="border-b last:border-0">
                        <td className="py-1.5 font-medium">
                          {tierLabel(row.tierId)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatKrw(row.grossRevenue)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.ordersCount)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.customersCount)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatKrw(row.avgOrderValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>

            <ChartCard
              title="멤버십 해지 사유"
              description="조회 기간의 해지·해지예약 이벤트 기준 (건수)"
              isLoading={isLoading}
              isEmpty={!data || data.cancellationReasons.length === 0}
              emptyText="조회 기간에 해지가 없습니다"
            >
              <HorizontalBarList
                items={(data?.cancellationReasons ?? []).map((row) => ({
                  label: row.reasonCode === 'UNKNOWN' ? '사유 미기재' : row.reasonCode,
                  value: row.count,
                }))}
                formatValue={(value) => `${formatCount(value)}건`}
              />
            </ChartCard>
          </div>
        </div>
      )}
    </StatisticsShell>
  );
}
