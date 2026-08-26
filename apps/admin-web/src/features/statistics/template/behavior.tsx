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
import { useBehaviorStatistics } from '@/lib/services/analytics';
import { StatisticsShell } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { formatCount, formatKrw, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

/** 세션부터 구매까지의 퍼널 — 막대 폭은 첫 단계 대비, 우측에 직전 단계 대비 전환율. */
function FunnelSteps({ steps }: { steps: Array<{ label: string; value: number }> }) {
  const first = steps[0]?.value ?? 0;
  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const prev = index > 0 ? steps[index - 1].value : null;
        const stepRate = prev != null && prev > 0 ? step.value / prev : null;
        return (
          <div key={step.label} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-xs text-gray-600">{step.label}</span>
            <div className="h-5 flex-1 rounded bg-gray-100">
              <div
                className="h-5 rounded"
                style={{
                  width: `${first > 0 ? Math.max((step.value / first) * 100, 1) : 0}%`,
                  backgroundColor: SERIES_COLORS[0],
                }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-gray-900">
              {formatCount(step.value)}
            </span>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-gray-400">
              {stepRate != null ? `직전 대비 ${formatPercent(stepRate)}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function BehaviorStatisticsTemplate() {
  const range = useStatisticsRange();
  const { data, isLoading, isError } = useBehaviorStatistics({ from: range.from, to: range.to, limit: 20 });

  const totals = data?.totals;
  const conversionRate = totals && totals.sessions > 0 ? totals.purchase / totals.sessions : null;
  const cartRate = totals && totals.viewItem > 0 ? totals.addToCart / totals.viewItem : null;

  const funnelSteps = totals
    ? [
        { label: '세션', value: totals.sessions },
        { label: '상품 조회', value: totals.viewItem },
        { label: '장바구니 담기', value: totals.addToCart },
        { label: '체크아웃 진입', value: totals.beginCheckout },
        { label: '결제창 이동', value: totals.addPaymentInfo },
        { label: '구매 완료', value: totals.purchase },
      ]
    : [];

  return (
    <StatisticsShell filterOptions={{ channel: false, granularity: false }}>
      <div className="mb-4">
        <span className="text-xs text-gray-400">
          GA4 이벤트 기준 · 상품조회→담기→체크아웃→결제이동→구매 퍼널로 이탈 구간을 찾습니다.
        </span>
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
            <KpiTile label="상품 조회" value={formatCount(totals?.viewItem)} isLoading={isLoading} />
            <KpiTile label="장바구니 담기" value={formatCount(totals?.addToCart)} isLoading={isLoading} />
            <KpiTile label="구매 완료" value={formatCount(totals?.purchase)} isLoading={isLoading} />
            <KpiTile
              label="구매 전환율"
              value={formatPercent(conversionRate)}
              hint="구매 ÷ 세션"
              isLoading={isLoading}
            />
          </div>

          <ChartCard
            title="구매 퍼널"
            description="각 단계의 이벤트 수와 직전 단계 대비 전환율 — 낙차가 큰 단계가 개선 지점입니다."
            isLoading={isLoading}
            isEmpty={!totals}
          >
            <FunnelSteps steps={funnelSteps} />
            {cartRate != null && (
              <p className="mt-3 text-xs text-gray-400">
                조회→담기 {formatPercent(cartRate)} · 세션→구매 {formatPercent(conversionRate)}
              </p>
            )}
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="일별 구매 전환율"
              description="구매 ÷ 세션 · 세션이 없는 날은 선이 끊깁니다."
              isLoading={isLoading}
              isEmpty={!data || data.series.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#999" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="#999"
                    tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
                  />
                  <Tooltip formatter={(value: number) => formatPercent(value)} />
                  <Line
                    type="monotone"
                    dataKey="conversionRate"
                    name="구매 전환율"
                    stroke={SERIES_COLORS[0]}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="일별 행동 추이"
              description="상품 조회·장바구니 담기·구매 이벤트 수"
              isLoading={isLoading}
              isEmpty={!data || data.series.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#999" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                  <Tooltip formatter={(value: number) => formatCount(value)} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="viewItem"
                    name="상품 조회"
                    stroke={SERIES_COLORS[0]}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="addToCart"
                    name="장바구니 담기"
                    stroke={SERIES_COLORS[1]}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="purchase"
                    name="구매"
                    stroke={SERIES_COLORS[2]}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <ChartCard
            title="상품별 행동 (조회 상위)"
            description="많이 보는데 안 사는 상품(조회→구매율 낮음)이 상세페이지·가격 개선 후보입니다."
            isLoading={isLoading}
            isEmpty={!data || data.items.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">상품</th>
                    <th className="py-1.5 text-right">조회</th>
                    <th className="py-1.5 text-right">담기</th>
                    <th className="py-1.5 text-right">구매</th>
                    <th className="py-1.5 text-right">조회→담기</th>
                    <th className="py-1.5 text-right">조회→구매</th>
                    <th className="py-1.5 text-right">매출</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((rowItem, index) => (
                    <tr key={rowItem.name} className="border-b last:border-0">
                      <td className="py-1.5 text-gray-400">{index + 1}</td>
                      <td className="py-1.5">
                        <span className="font-medium text-gray-900 break-all">{rowItem.name}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(rowItem.viewed)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(rowItem.addedToCart)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(rowItem.purchased)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatPercent(rowItem.cartRate)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatPercent(rowItem.purchaseRate)}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">{formatKrw(rowItem.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard
            title="기기별 퍼널"
            description="기기별 상품 조회→구매 — 특정 기기의 전환율이 유독 낮으면 그 화면의 UX 문제를 의심합니다."
            isLoading={isLoading}
            isEmpty={!data || data.devices.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">기기</th>
                    <th className="py-1.5 text-right">상품 조회</th>
                    <th className="py-1.5 text-right">장바구니 담기</th>
                    <th className="py-1.5 text-right">구매</th>
                    <th className="py-1.5 text-right">조회→구매</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.devices ?? []).map((rowItem) => (
                    <tr key={rowItem.device} className="border-b last:border-0">
                      <td className="py-1.5 font-medium text-gray-900">{rowItem.device}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(rowItem.viewItem)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(rowItem.addToCart)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(rowItem.purchase)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatPercent(rowItem.conversionRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      )}
    </StatisticsShell>
  );
}
