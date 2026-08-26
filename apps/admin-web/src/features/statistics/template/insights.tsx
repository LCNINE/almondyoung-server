'use client';

import { useCustomerInsights } from '@/lib/services/analytics';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList, KpiTile } from '../components/widgets';
import { formatCount, formatPercent, useStatisticsRange } from '../shared';

/** 코호트 셀 배경 — 시리즈 1번 색(#2a78d6)의 투명도 스케일. 값 라벨을 늘 함께 찍는다. */
function cohortCellBackground(rate: number): string {
  const alpha = Math.min(rate, 1) * 0.45;
  return `rgba(42, 120, 214, ${alpha.toFixed(3)})`;
}

const SEGMENT_HINTS: Record<string, string> = {
  vip: '최근 90일 내 구매 · 4회 이상',
  loyal: '최근 90일 내 구매 · 2~3회',
  new: '30일 내 첫 구매',
  'one-time': '1회 구매 후 재방문 없음',
  'at-risk': '91~365일 무구매 · 재구매 이력 있음',
  dormant: '1년 이상 무구매',
};

export default function CustomerInsightsTemplate() {
  const range = useStatisticsRange();
  const { data, isLoading, isError } = useCustomerInsights({ from: range.from, to: range.to });

  return (
    <StatisticsShell filterOptions={{ channel: false, granularity: false }}>
      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <ChartCard
            title="RFM 고객 세그먼트"
            description="전 고객 기준(기간 필터 무관) — 마지막 구매 경과(R)와 누적 구매 횟수(F)로 나눕니다."
            isLoading={isLoading}
            isEmpty={!data || data.rfm.totalCustomers === 0}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {(data?.rfm.segments ?? []).map((segment) => (
                <KpiTile
                  key={segment.key}
                  label={segment.label}
                  value={formatCount(segment.customers)}
                  hint={SEGMENT_HINTS[segment.key]}
                />
              ))}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">마지막 구매 ＼ 구매 횟수</th>
                    {(data?.rfm.frequencyBuckets ?? []).map((bucket) => (
                      <th key={bucket} className="py-1.5 text-right">
                        {bucket}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.rfm.recencyBuckets ?? []).map((recency) => (
                    <tr key={recency} className="border-b last:border-0">
                      <td className="py-1.5 text-gray-600">{recency}</td>
                      {(data?.rfm.frequencyBuckets ?? []).map((frequency) => {
                        const cell = data?.rfm.cells.find(
                          (c) => c.recency === recency && c.frequency === frequency,
                        );
                        return (
                          <td key={frequency} className="py-1.5 text-right tabular-nums">
                            {cell ? formatCount(cell.customers) : <span className="text-gray-300">0</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard
            title="코호트 리텐션"
            description="종료일 기준 최근 12개월 — 각 달에 첫 구매한 고객이 이후 몇 달째에 다시 구매했는지의 비율입니다."
            isLoading={isLoading}
            isEmpty={!data || data.cohorts.rows.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">첫 구매 월</th>
                    <th className="py-1.5 text-right">고객 수</th>
                    {Array.from({ length: (data?.cohorts.maxOffset ?? 0) + 1 }, (_, offset) => (
                      <th key={offset} className="py-1.5 text-center">
                        +{offset}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.cohorts.rows ?? []).map((row) => (
                    <tr key={row.cohortMonth} className="border-b last:border-0">
                      <td className="py-1.5 font-medium text-gray-900">{row.cohortMonth}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(row.size)}</td>
                      {row.retention.map((rate, offset) => (
                        <td
                          key={offset}
                          className="py-1.5 text-center tabular-nums"
                          style={rate != null ? { backgroundColor: cohortCellBackground(rate) } : undefined}
                        >
                          {rate == null ? (
                            <span className="text-gray-300">–</span>
                          ) : (
                            <span className="text-gray-900">{Math.round(rate * 100)}%</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard
            title="재구매율 높은 상품"
            description={`전 기간 누적 · 구매자 ${data?.repurchase.minBuyers ?? 5}명 이상인 상품만 — 정기 구매 전환·번들 기획 후보입니다.`}
            isLoading={isLoading}
            isEmpty={!data || data.repurchase.items.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">상품</th>
                    <th className="py-1.5 text-right">구매자</th>
                    <th className="py-1.5 text-right">재구매자</th>
                    <th className="py-1.5 text-right">재구매율</th>
                    <th className="py-1.5 text-right">평균 재구매 주기</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.repurchase.items ?? []).map((item, index) => (
                    <tr key={item.masterId} className="border-b last:border-0">
                      <td className="py-1.5 text-gray-400">{index + 1}</td>
                      <td className="py-1.5">
                        <span className="font-medium text-gray-900">{item.name ?? item.masterId}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(item.buyers)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(item.repeatBuyers)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatPercent(item.repurchaseRate)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {item.avgCycleDays == null ? '-' : `${Math.round(item.avgCycleDays)}일`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="기간 내 등급 전환"
              description="실시간 수집 이전 이력은 없어 과거 구간은 실제보다 적게 잡힙니다."
              isLoading={isLoading}
              isEmpty={!data || data.tierFlow.transitions.length === 0}
              emptyText="조회 기간에 등급 전환이 없습니다"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">이전 등급</th>
                      <th className="py-1.5 text-left">새 등급</th>
                      <th className="py-1.5 text-right">인원</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.tierFlow.transitions ?? []).map((row) => (
                      <tr key={`${row.fromTier}-${row.toTier}`} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-600">{row.fromTier}</td>
                        <td className="py-1.5 font-medium text-gray-900">{row.toTier}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>

            <ChartCard
              title="현재 등급 분포"
              isLoading={isLoading}
              isEmpty={!data || data.tierFlow.currentDistribution.length === 0}
            >
              <HorizontalBarList
                items={(data?.tierFlow.currentDistribution ?? []).map((row) => ({
                  label: row.tierId,
                  value: row.count,
                }))}
                formatValue={formatCount}
              />
            </ChartCard>
          </div>
        </div>
      )}
    </StatisticsShell>
  );
}
