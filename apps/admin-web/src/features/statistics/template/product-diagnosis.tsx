'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useProductDiagnosis, useItemBehavior } from '@/lib/services/analytics';
import { usePimMedusaMappings } from '@/lib/services/channel/queries';
import { useStockValuationProducts } from '@/lib/services/inventory';
import { useProductRatingSummary, useReviewStatistics } from '@/lib/services/review';
import { StatisticsShell } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { estimateDepletion, inclusiveRangeDays } from '../depletion';
import { changeRate, formatCount, formatKrw, formatPercent, useStatisticsRange } from '../shared';

/**
 * 표본이 이만큼 안 되면 비율을 비교하지 않는다. **임의로 정한 값이다** — 화면에도 그렇게 쓴다.
 * 몇 건 안 되는 분모에서 나온 비율을 전사 평균 옆에 놓으면 없는 신호를 있는 것처럼 읽게 된다.
 */
const MIN_REVIEWS_FOR_COMPARISON = 3;
const MIN_VIEWS_FOR_COMPARISON = 30;

/** 비교 기준이 아직 없는 축이 쓰는 문구 — 억지로 만들지 않는다. */
const NO_BENCHMARK = '비교 기준 없음';

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11px] leading-relaxed text-gray-400">{children}</p>;
}

function AxisMessage({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-400">{children}</p>;
}

function Metric({
  label,
  value,
  benchmark,
  hint,
}: {
  label: string;
  value: string;
  /** 비교 기준 — 없으면 "비교 기준 없음"을 그대로 쓴다 */
  benchmark?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{value}</p>
      {benchmark && <p className="mt-0.5 text-[11px] text-gray-500">{benchmark}</p>}
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

export default function ProductDiagnosisTemplate({ masterId }: { masterId: string }) {
  const range = useStatisticsRange();
  const rangeDays = inclusiveRangeDays(range.from, range.to);

  const diagnosis = useProductDiagnosis({ masterId, from: range.from, to: range.to, channel: range.channel });
  const stock = useStockValuationProducts({ masterIds: [masterId], limit: 1 });
  const rating = useProductRatingSummary(masterId);
  const reviewStats = useReviewStatistics({ from: range.from, to: range.to, limit: 1 });
  const mappings = usePimMedusaMappings([masterId]);

  const medusaProductId = mappings.data?.find((row) => row.pimMasterId === masterId)?.medusaProductId ?? '';
  const behavior = useItemBehavior(
    { from: range.from, to: range.to, itemId: medusaProductId },
    { enabled: Boolean(medusaProductId) },
  );

  const sales = diagnosis.data?.sales;
  const margin = diagnosis.data?.margin;
  const benchmark = diagnosis.data?.benchmark;
  const stockRow = stock.data?.data?.[0];
  const productName = diagnosis.data?.name ?? masterId;

  const depletion = estimateDepletion(stockRow?.onHandQuantity, sales?.quantitySold, rangeDays);
  const netRevenueRate = sales ? changeRate(sales.netRevenue, sales.previousNetRevenue) : null;

  return (
    <StatisticsShell>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/statistics/products?from=${range.from}&to=${range.to}${range.channel ? `&channel=${range.channel}` : ''}`}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          상품 목록으로
        </Link>
      </div>

      <div className="mb-4 rounded-[10px] border border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-500">상품 진단</p>
        <h2 className="mt-0.5 text-lg font-semibold text-gray-900">{productName}</h2>
        <p className="mt-1 text-[11px] text-gray-400">
          masterId {masterId} · 조회 기간 {range.from} ~ {range.to}
          {range.channel ? ` · 채널 ${range.channel}` : ''}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          이 화면은 <strong>판정하지 않는다</strong> — 숫자와 「무엇과 비교한 것인지」만 보여준다. 해석은 관리자 몫이다.
          축 하나가 실패해도 나머지는 그대로 보인다.
        </p>
      </div>

      <div className="space-y-4">
        <ChartCard
          title="매출·수량"
          description="직전 동일 길이 기간과 비교합니다. 전사 평균과는 비교하지 않습니다 — 상품 랭킹과 전사 매출은 집계표가 달라 분모가 같지 않습니다."
          isLoading={diagnosis.isLoading}
        >
          {diagnosis.isError ? (
            <AxisMessage>매출·마진을 불러오지 못했습니다.</AxisMessage>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiTile
                  label="순매출"
                  value={formatKrw(sales?.netRevenue)}
                  previous={
                    sales ? { current: sales.netRevenue, previous: sales.previousNetRevenue } : undefined
                  }
                  hint={netRevenueRate == null ? '직전 기간 판매 없음' : undefined}
                />
                <KpiTile label="판매량" value={formatCount(sales?.quantitySold)} />
                <KpiTile label="주문수" value={formatCount(sales?.ordersCount)} />
                <KpiTile
                  label="총매출"
                  value={formatKrw(sales?.grossRevenue)}
                  hint={`취소 ${formatKrw(sales?.cancelledAmount)} · 환불 ${formatKrw(sales?.refundedAmount)}`}
                />
              </div>
              {sales && sales.quantitySold === 0 && (
                <Note>이 기간에 판매가 없습니다. 아래 소진일수도 계산되지 않습니다.</Note>
              )}
            </>
          )}
        </ChartCard>

        <ChartCard
          title="마진"
          description="공급가 × 판매수량을 순매출 비율로 보정한 추정치입니다."
          isLoading={diagnosis.isLoading}
        >
          {diagnosis.isError ? (
            <AxisMessage>마진을 불러오지 못했습니다.</AxisMessage>
          ) : margin?.supplyPrice == null ? (
            <>
              <AxisMessage>계산 불가 — 이 상품의 공급가가 입력되어 있지 않습니다.</AxisMessage>
              <Note>상품 등록 화면에서 공급가를 입력하면 계산됩니다.</Note>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="공급가" value={formatKrw(margin.supplyPrice)} />
                <Metric label="추정 원가" value={formatKrw(margin.estimatedCost)} />
                <Metric label="추정 마진" value={formatKrw(margin.estimatedMargin)} />
                <Metric
                  label="마진율"
                  value={formatPercent(margin.marginRate)}
                  benchmark={`전사 ${formatPercent(benchmark?.marginRate)} (원가 입력된 상품 기준)`}
                  hint={margin.marginRate == null ? '순매출이 0 이하라 계산 불가' : undefined}
                />
              </div>
              <Note>
                이 상품의 마진율 분모는 <strong>이 상품의 순매출</strong>이고, 전사 마진율 분모는{' '}
                <strong>원가가 입력된 상품들의 순매출</strong>입니다. 분모가 다르므로 대략의 위치로만 보세요.
                {benchmark ? ` 전사 ${formatCount(benchmark.productsCount)}개 상품 중 ${formatCount(benchmark.uncomputedProductsCount)}개는 원가 미입력이라 전사 마진율에서 빠져 있습니다.` : ''}
              </Note>
            </>
          )}
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="재고"
            description="조회 기간과 무관한 현재 시점 값입니다."
            isLoading={stock.isLoading}
          >
            {stock.isError ? (
              <AxisMessage>재고를 불러오지 못했습니다.</AxisMessage>
            ) : !stockRow ? (
              <AxisMessage>재고 원장에 이 상품의 재고가 없습니다.</AxisMessage>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="현재 재고수량" value={formatCount(stockRow.onHandQuantity)} benchmark={NO_BENCHMARK} />
                  <Metric
                    label="묶인 돈"
                    value={formatKrw(stockRow.onHandValue)}
                    benchmark={NO_BENCHMARK}
                    hint={stockRow.hasUncostedSku ? '원가 없는 SKU 가 있어 과소 계상' : undefined}
                  />
                </div>
                <Note>
                  SKU {formatCount(stockRow.skuCount)}개 기준입니다.
                  {stockRow.unattributedSkuCount > 0
                    ? ` 여러 상품이 공유해 금액 귀속이 불가한 SKU ${formatCount(stockRow.unattributedSkuCount)}개(수량 ${formatCount(stockRow.unattributedQuantity)})는 위 수치에 포함되지 않았습니다.`
                    : ''}{' '}
                  재고 API 에 중앙값·상품당 평균이 없어 비교 기준을 만들지 않았습니다 — 만들려면 전 상품을 긁어야 합니다.
                </Note>
              </>
            )}
          </ChartCard>

          <ChartCard title="재고 소진일수 (근사치)" isLoading={diagnosis.isLoading || stock.isLoading}>
            {depletion.status === 'ok' ? (
              <>
                <Metric
                  label="현재 재고가 소진되기까지"
                  value={`약 ${Math.round(depletion.days).toLocaleString('ko-KR')}일`}
                  benchmark={NO_BENCHMARK}
                  hint={`일평균 ${depletion.dailyVelocity.toFixed(2)}개 판매 기준`}
                />
                <Note>
                  현재 재고수량 ÷ (기간 판매수량 ÷ 기간 {rangeDays}일) 로 계산한 <strong>근사치</strong>입니다. 앞으로의
                  판매 속도가 조회 기간과 같다고 가정하며 시즌성·프로모션·품절 기간은 반영되지 않습니다.
                  {range.channel
                    ? ' 채널 필터가 걸려 있어 판매수량은 해당 채널분이지만 재고는 전체입니다 — 실제보다 길게 나옵니다.'
                    : ''}
                </Note>
              </>
            ) : (
              <AxisMessage>
                {depletion.status === 'no-sales'
                  ? '기간 판매가 없어 소진 예측 불가'
                  : depletion.status === 'no-stock'
                    ? '재고가 없습니다 (품절)'
                    : '재고 또는 기간을 읽지 못해 계산 불가'}
              </AxisMessage>
            )}
          </ChartCard>
        </div>

        <ChartCard
          title="행동 (GA4) — 조회 → 담기 → 구매"
          description="GA4 는 클라이언트 수집이라 광고 차단·동의 거부분이 빠집니다. 자사 주문 데이터와 수치가 맞지 않는 것이 정상이며, 두 축을 더하거나 비율로 엮지 마세요."
          isLoading={mappings.isLoading || behavior.isLoading}
        >
          {mappings.isError ? (
            <AxisMessage>Medusa 상품 매핑을 불러오지 못했습니다.</AxisMessage>
          ) : !medusaProductId ? (
            <AxisMessage>
              이 상품의 Medusa 상품 매핑이 없어 GA4 와 이을 수 없습니다. (GA4 는 상품을 Medusa 상품 id 로 기록합니다)
            </AxisMessage>
          ) : behavior.isError ? (
            <AxisMessage>GA4 조회에 실패했습니다.</AxisMessage>
          ) : behavior.data?.enabled === false ? (
            <AxisMessage>GA4 연동 대기 중입니다.</AxisMessage>
          ) : !behavior.data?.item ? (
            <AxisMessage>이 기간에 GA4 에 기록된 이 상품의 조회·담기·구매가 없습니다.</AxisMessage>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Metric label="조회" value={formatCount(behavior.data.item.viewed)} />
                <Metric label="담기" value={formatCount(behavior.data.item.addedToCart)} />
                <Metric label="구매" value={formatCount(behavior.data.item.purchased)} />
                <Metric
                  label="담기율 (담기÷조회)"
                  value={
                    behavior.data.item.viewed >= MIN_VIEWS_FOR_COMPARISON
                      ? formatPercent(behavior.data.item.cartRate)
                      : '표본 부족'
                  }
                  benchmark={`전 상품 ${formatPercent(behavior.data.totals?.cartRate)}`}
                />
                <Metric
                  label="구매 전환율 (구매÷담기)"
                  value={
                    behavior.data.item.addedToCart >= MIN_VIEWS_FOR_COMPARISON
                      ? formatPercent(behavior.data.item.purchaseRate)
                      : '표본 부족'
                  }
                  benchmark={`전 상품 ${formatPercent(behavior.data.totals?.purchaseRate)}`}
                />
              </div>
              <Note>
                비교 기준은 같은 기간 <strong>전 상품 아이템 지표</strong>의 합입니다 — 상품 행과 분모 성격이 같습니다.
                조회 또는 담기가 {MIN_VIEWS_FOR_COMPARISON}회 미만이면 비율을 비교하지 않고 「표본 부족」으로 둡니다
                (임계값은 임의로 정한 값입니다). 이 화면의 「구매 전환율」은 담기 대비이며, 행동 분석 탭 표의 「구매율」은
                조회 대비라 서로 다른 값입니다.
              </Note>
            </>
          )}
        </ChartCard>

        <ChartCard title="리뷰" isLoading={rating.isLoading}>
          {rating.isError ? (
            <AxisMessage>리뷰 평점을 불러오지 못했습니다.</AxisMessage>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <Metric
                  label="평균 평점 (전 기간 누적)"
                  value={
                    (rating.data?.totalCount ?? 0) >= MIN_REVIEWS_FOR_COMPARISON
                      ? (rating.data?.averageRating ?? 0).toFixed(2)
                      : '표본 부족'
                  }
                  benchmark={`기간 내 전체 평균 ${reviewStats.data?.totals.averageRating?.toFixed(2) ?? '-'}`}
                />
                <Metric label="리뷰 수 (전 기간 누적)" value={formatCount(rating.data?.totalCount ?? 0)} />
                <div className="rounded-md border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">평점 분포</p>
                  <ul className="mt-1 space-y-0.5">
                    {[5, 4, 3, 2, 1].map((score) => (
                      <li key={score} className="flex items-center justify-between text-xs tabular-nums text-gray-700">
                        <span>{score}★</span>
                        <span>{formatCount(rating.data?.ratingDistribution?.[score] ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <Note>
                상품 평점은 <strong>전 기간 누적</strong>이고 비교 기준은 <strong>조회 기간 내 전사 평균</strong>이라
                기간 정의가 다릅니다. 리뷰가 {MIN_REVIEWS_FOR_COMPARISON}건 미만이면 평점을 비교하지 않습니다
                (임계값은 임의로 정한 값입니다).
              </Note>
            </>
          )}
        </ChartCard>

        <ChartCard
          title="옵션별 판매"
          description="옵션 단위는 취소·환불 귀속 정보가 없어 총매출만 제공됩니다 (순매출 아님)."
          isLoading={diagnosis.isLoading}
          isEmpty={!diagnosis.data || diagnosis.data.variants.length === 0}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-1.5 text-left">옵션</th>
                  <th className="py-1.5 text-right">판매량</th>
                  <th className="py-1.5 text-right">총매출</th>
                </tr>
              </thead>
              <tbody>
                {(diagnosis.data?.variants ?? []).map((row) => (
                  <tr key={row.variantId} className="border-b last:border-0">
                    <td className="py-1.5">{row.variantName ?? (row.isDefault ? '기본 품목' : row.variantId)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCount(row.quantitySold)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatKrw(row.grossRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <ChartCard title="아직 답하지 못하는 것">
          <ul className="space-y-1.5 text-xs text-gray-500">
            <li>
              <strong className="text-gray-700">담고 안 샀다 (카트)</strong> — 준비 중입니다. 카트에 담긴 뒤 사라진
              상품을 세려면 카트 쪽 수집이 먼저 서야 합니다.
            </li>
            <li>
              <strong className="text-gray-700">검색으로 얼마나 들어오나</strong> — 수집 예정입니다. 지금 검색 로그에는
              검색어와 결과 건수만 남고 어떤 상품을 눌렀는지가 기록되지 않습니다.
            </li>
            <li>
              <strong className="text-gray-700">옵션별 신호</strong> — 이 화면은 상품(마스터) 단위입니다. 옵션마다 다른
              신호는 답하지 않습니다.
            </li>
          </ul>
        </ChartCard>
      </div>
    </StatisticsShell>
  );
}
