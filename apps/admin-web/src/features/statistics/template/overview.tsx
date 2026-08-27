'use client';

import { useMemo } from 'react';
import Link from 'next/link';
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
import { ArrowRight } from 'lucide-react';
import {
  useAnalyticsOverview,
  useProfitStatistics,
  useSalesStatistics,
  useUnsoldProducts,
} from '@/lib/services/analytics';
import { useZeroHitKeywords } from '@/lib/services/search';
import { useReviewStatistics } from '@/lib/services/review';
import { useFeeSummary } from '@/lib/services/wallet/queries';
import { toLocalDateString } from '@/lib/utils/date';
import { cn } from '@/lib/utils/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { StatisticsShell, TABS } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { changeRate, formatCount, formatKrw, formatKrwAxis, formatPercent, SERIES_COLORS } from '../shared';

/** 오늘 기준 n일 전 ~ 오늘 구간 (KST 로컬 달력) */
function lastDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: toLocalDateString(from), to: toLocalDateString(to) };
}

type ActionSeverity = 'critical' | 'warning' | 'info';

interface ActionCard {
  id: string;
  severity: ActionSeverity;
  /** 이 일을 누가 처리해야 하나 — 업무 방향 표시 */
  owner: string;
  title: string;
  description?: string;
  href: string;
  linkLabel: string;
}

const SEVERITY_STYLES: Record<ActionSeverity, { card: string; dot: string; label: string }> = {
  critical: { card: 'border-red-200 bg-red-50', dot: 'bg-red-500', label: '지금 확인' },
  warning: { card: 'border-amber-200 bg-amber-50', dot: 'bg-amber-500', label: '주의' },
  info: { card: 'border-gray-200 bg-white', dot: 'bg-gray-400', label: '참고' },
};

const SEVERITY_ORDER: Record<ActionSeverity, number> = { critical: 0, warning: 1, info: 2 };

export default function OverviewStatisticsTemplate() {
  // 이 탭은 필터 없이 고정 기준으로 본다 — 오늘·최근 7일(KPI), 최근 30일(추이·경보)
  const week = useMemo(() => lastDays(7), []);
  const month = useMemo(() => lastDays(30), []);

  const overview = useAnalyticsOverview();
  const weekSales = useSalesStatistics({ from: week.from, to: week.to, granularity: 'day' });
  // 마진 하위 정렬로 받아 역마진 상품을 첫 페이지에서 바로 감지한다
  const profit = useProfitStatistics({ from: month.from, to: month.to, sort: 'margin', order: 'asc', page: 1, limit: 5 });
  const zeroHit = useZeroHitKeywords({ from: month.from, to: month.to, page: 1, limit: 1 });
  const reviews = useReviewStatistics({ from: month.from, to: month.to, limit: 5 });
  const fees = useFeeSummary(month.from, month.to);
  const unsold = useUnsoldProducts({ from: month.from, to: month.to, page: 1, limit: 1 });

  const actionsLoading =
    profit.isLoading || zeroHit.isLoading || reviews.isLoading || fees.isLoading || unsold.isLoading;

  const failedSources = [
    profit.isError ? '이익' : null,
    zeroHit.isError ? '검색 키워드' : null,
    reviews.isError ? '리뷰' : null,
    fees.isError ? '수수료' : null,
    unsold.isError ? '무판매 상품' : null,
  ].filter((name): name is string => name != null);

  const actions = useMemo<ActionCard[]>(() => {
    const cards: ActionCard[] = [];

    const summary = zeroHit.data?.summary;
    if (summary && summary.zeroKeywordCount > 0) {
      cards.push({
        id: 'zero-hit',
        severity: summary.neglectedOver7Days > 0 ? 'critical' : 'warning',
        owner: '개발 · MD',
        title: `고객이 검색했는데 결과가 없는 검색어가 ${formatCount(summary.zeroKeywordCount)}개 있습니다`,
        description:
          summary.neglectedOver7Days > 0
            ? `그중 ${formatCount(summary.neglectedOver7Days)}개는 7일 이상 방치됐습니다 (최장 ${formatCount(summary.maxNeglectDays)}일). 검색엔진 문제면 개발이, 상품이 없는 거면 MD가 처리합니다.`
            : '아직 오래 방치된 건 없지만, 원인을 나눠 담당자를 지정해 두세요.',
        href: '/statistics/keywords',
        linkLabel: '검색 키워드 탭에서 처리',
      });
    }

    const negativeMarginItems = (profit.data?.items ?? []).filter(
      (row) => row.estimatedMargin != null && row.estimatedMargin < 0,
    );
    if (negativeMarginItems.length > 0) {
      const worst = negativeMarginItems[0];
      const countText =
        negativeMarginItems.length >= 5 ? '5개 이상' : `${formatCount(negativeMarginItems.length)}개`;
      cards.push({
        id: 'negative-margin',
        severity: 'critical',
        owner: 'MD',
        title: `팔수록 손해인 상품이 ${countText} 있습니다`,
        description: `가장 심한 상품: ${worst.name ?? worst.masterId} (최근 30일 마진 ${formatKrw(worst.estimatedMargin)}). 판매가·원가를 다시 확인하세요.`,
        href: '/statistics/profit?sort=margin&order=asc',
        linkLabel: '이익 탭에서 하위 마진 확인',
      });
    }

    const lowRatedCount = reviews.data?.lowRatedTotalItems ?? 0;
    if (lowRatedCount > 0) {
      cards.push({
        id: 'low-rated',
        severity: 'warning',
        owner: 'MD · CS',
        title: `평점이 낮은 상품이 ${formatCount(lowRatedCount)}개 있습니다`,
        description:
          '최근 30일 평균 평점 3.5 미만(리뷰 3건 이상)인 상품입니다. 품질·상세페이지·배송 문제의 빠른 신호입니다.',
        href: '/statistics/reviews',
        linkLabel: '리뷰 탭에서 확인',
      });
    }

    const profitTotals = profit.data?.totals;
    if (profitTotals && profitTotals.uncomputedProductsCount > 0) {
      cards.push({
        id: 'missing-cost',
        severity: 'info',
        owner: '운영',
        title: `원가(공급가)가 입력되지 않은 판매 상품이 ${formatCount(profitTotals.uncomputedProductsCount)}개 있습니다`,
        description: `순매출 ${formatKrw(profitTotals.uncomputedNetRevenue)}이 이익 계산에서 빠져 있습니다. 상품 등록에서 공급가를 채우면 이익 통계가 정확해집니다.`,
        href: '/statistics/profit',
        linkLabel: '이익 탭에서 확인',
      });
    }

    const feeTotals = fees.data?.totals;
    if (feeTotals && feeTotals.uncoveredAmount > 0) {
      cards.push({
        id: 'missing-fee-rate',
        severity: 'info',
        owner: '운영',
        title: '수수료율이 설정되지 않은 결제수단이 있습니다',
        description: `최근 30일 결제액 ${formatKrw(feeTotals.uncoveredAmount)}의 수수료를 계산하지 못했습니다. 이익 탭의 '수수료율 설정'에서 계약 요율을 입력하세요.`,
        href: '/statistics/profit',
        linkLabel: '수수료율 설정으로',
      });
    }

    const unsoldTotal = unsold.data?.total ?? 0;
    if (unsoldTotal > 0) {
      cards.push({
        id: 'unsold',
        severity: 'info',
        owner: 'MD',
        title: `최근 30일 동안 한 개도 안 팔린 상품이 ${formatCount(unsoldTotal)}개 있습니다`,
        description: '노출·가격·소싱을 다시 볼 후보입니다.',
        href: '/statistics/products',
        linkLabel: '상품 탭에서 확인',
      });
    }

    return cards.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [zeroHit.data, profit.data, reviews.data, fees.data, unsold.data]);

  // ─── 한 줄 진단 — 숫자를 읽어주는 문장 ───
  const weekKpis = weekSales.data?.kpis;
  const weekPrev = weekSales.data?.previousKpis;
  const weekRate = weekKpis && weekPrev ? changeRate(weekKpis.netRevenue, weekPrev.netRevenue) : null;
  const profitTotals = profit.data?.totals;

  const diagnosis: string[] = [];
  if (weekKpis && weekPrev) {
    if (weekRate != null) {
      diagnosis.push(
        `최근 7일 순매출은 ${formatKrw(weekKpis.netRevenue)} — 직전 7일(${formatKrw(weekPrev.netRevenue)})보다 ${formatPercent(Math.abs(weekRate))} ${weekRate >= 0 ? '늘었습니다' : '줄었습니다'}. 주문은 ${formatCount(weekKpis.ordersCount)}건입니다.`,
      );
    } else {
      diagnosis.push(
        `최근 7일 순매출은 ${formatKrw(weekKpis.netRevenue)}, 주문 ${formatCount(weekKpis.ordersCount)}건입니다 (직전 7일 매출이 0원이라 증감 비교는 못 합니다).`,
      );
    }
  }
  if (profitTotals) {
    diagnosis.push(
      `최근 30일 추정 마진은 ${formatKrw(profitTotals.estimatedMargin)}(마진율 ${formatPercent(profitTotals.marginRate)})입니다.${profitTotals.uncomputedProductsCount > 0 ? ' 원가 미입력 상품 몫은 빠진 값입니다.' : ''}`,
    );
  }
  if (!actionsLoading) {
    diagnosis.push(
      actions.length > 0
        ? `지금 처리할 일이 ${formatCount(actions.length)}건 있습니다 — 아래 '오늘의 액션'에서 바로 이동하세요.`
        : '지금 처리할 경보는 없습니다.',
    );
  }

  const ov = overview.data;

  return (
    <StatisticsShell hideFilter>
      <div className="space-y-4">
        <p className="text-xs text-gray-400">
          이 화면은 기간 필터 없이 오늘·최근 7일·최근 30일 고정 기준으로 보여줍니다. 기간을 바꿔 보려면 각
          탭으로 이동하세요.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="오늘 매출"
            value={formatKrw(ov?.today.netRevenue)}
            hint={ov ? `0시부터 지금까지 · 주문 ${formatCount(ov.today.ordersCount)}건` : undefined}
            isLoading={overview.isLoading}
          />
          <KpiTile
            label="어제 매출"
            value={formatKrw(ov?.yesterday.netRevenue)}
            hint={ov ? `주문 ${formatCount(ov.yesterday.ordersCount)}건` : undefined}
            isLoading={overview.isLoading}
          />
          <KpiTile
            label="최근 7일 순매출"
            value={formatKrw(weekKpis?.netRevenue)}
            previous={
              weekKpis && weekPrev ? { current: weekKpis.netRevenue, previous: weekPrev.netRevenue } : undefined
            }
            isLoading={weekSales.isLoading}
          />
          <KpiTile
            label="활성 멤버십 회원"
            value={ov?.activeMembers == null ? '-' : `${formatCount(ov.activeMembers)}명`}
            hint={ov?.activeMembersAsOf ? `${ov.activeMembersAsOf} 스냅샷 기준` : undefined}
            isLoading={overview.isLoading}
          />
        </div>

        <div className="rounded-[10px] border border-gray-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-gray-900">한 줄 진단</p>
          {weekSales.isError ? (
            <p className="text-sm text-red-500">매출 요약을 불러오지 못했습니다.</p>
          ) : diagnosis.length === 0 ? (
            <Skeleton className="h-5 w-2/3" />
          ) : (
            <ul className="space-y-1.5">
              {diagnosis.map((sentence) => (
                <li key={sentence} className="border-l-2 border-orange-300 pl-3 text-sm text-gray-700">
                  {sentence}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-[10px] border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-gray-900">오늘의 액션</p>
            <p className="text-xs text-gray-400">최근 30일 기준 · 심각한 것부터</p>
          </div>
          {failedSources.length > 0 && (
            <p className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
              {failedSources.join(', ')} 경보는 불러오지 못해 이 목록에 빠져 있습니다.
            </p>
          )}
          {actionsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : actions.length === 0 ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-4 text-center text-sm text-emerald-700">
              ✓ 지금 처리할 경보가 없습니다
            </p>
          ) : (
            <div className="space-y-2">
              {actions.map((action) => {
                const style = SEVERITY_STYLES[action.severity];
                return (
                  <div
                    key={action.id}
                    className={cn('rounded-md border px-3 py-2.5', style.card)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden />
                      <span className="text-xs font-medium text-gray-500">{style.label}</span>
                      <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600">
                        담당 {action.owner}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{action.title}</span>
                    </div>
                    {action.description && (
                      <p className="mt-1 pl-4 text-xs text-gray-600">{action.description}</p>
                    )}
                    <Link
                      href={action.href}
                      className="mt-1.5 inline-flex items-center gap-1 pl-4 text-xs font-medium text-orange-600 hover:text-orange-700"
                    >
                      {action.linkLabel}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <ChartCard
          title="최근 30일 매출·마진 추이"
          description="마진은 원가가 입력된 상품 몫만 반영한 추정치입니다. 취소·환불이 발생일에 귀속되어 음수인 날이 있을 수 있습니다."
          isLoading={profit.isLoading}
          isEmpty={!profit.data || profit.data.series.length === 0}
        >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={profit.data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
              <YAxis tick={{ fontSize: 11 }} stroke="#999" tickFormatter={formatKrwAxis} />
              <Tooltip formatter={(value: number) => formatKrw(value)} />
              <Legend />
              <Line
                type="monotone"
                dataKey="netRevenue"
                name="순매출"
                stroke={SERIES_COLORS[0]}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="estimatedMargin"
                name="추정 마진"
                stroke={SERIES_COLORS[1]}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="rounded-[10px] border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-gray-900">무엇이 궁금하면 어느 탭인가</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {TABS.filter((tab) => tab.href !== '/statistics/overview').map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className="group rounded-md border border-gray-200 px-3 py-2.5 transition-colors hover:border-orange-300 hover:bg-orange-50"
              >
                <p className="text-sm text-gray-700 group-hover:text-gray-900">{tab.question}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-orange-600">
                  {tab.label} 탭
                  <ArrowRight className="h-3 w-3" />
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </StatisticsShell>
  );
}
