'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useReviewStatistics } from '@/lib/services/review';
import { useMastersByIds } from '@/lib/services/products/queries';
import { PaginationBar } from '../components/pagination';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList, KpiTile } from '../components/widgets';
import { formatCount, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

const PAGE_SIZE = 10;

function formatRating(value: number | null | undefined): string {
  return value == null ? '—' : value.toFixed(2);
}

export default function ReviewStatisticsTemplate() {
  const range = useStatisticsRange();
  const [lowRatedPage, setLowRatedPage] = useState(1);
  const [topProductsPage, setTopProductsPage] = useState(1);

  // 조회 조건이 바뀌면 페이지가 범위를 벗어날 수 있다 — 1페이지로 되돌린다
  useEffect(() => {
    setLowRatedPage(1);
    setTopProductsPage(1);
  }, [range.from, range.to]);

  const { data, isLoading, isError } = useReviewStatistics({
    from: range.from,
    to: range.to,
    limit: PAGE_SIZE,
    lowRatedPage,
    topProductsPage,
  });

  const productIds = useMemo(() => {
    if (!data) return [];
    return Array.from(
      new Set(
        [...data.lowRated, ...data.topProducts, ...data.bestReviews].map((row) => row.productId).filter(Boolean),
      ),
    );
  }, [data]);
  const { data: products } = useMastersByIds(productIds);
  const productNames = useMemo(() => {
    const m = new Map<string, string>();
    (products?.data ?? []).forEach((p) => m.set(p.masterId, p.name));
    return m;
  }, [products]);
  const productLabel = (productId: string) => productNames.get(productId) ?? `${productId.slice(0, 8)}…`;

  const totals = data?.totals;
  const photoRate = totals && totals.reviewCount > 0 ? totals.photoReviewCount / totals.reviewCount : null;
  const conversionRate = totals && totals.eligibleCount > 0 ? totals.consumedEligibleCount / totals.eligibleCount : null;
  const commentRate = totals && totals.reviewCount > 0 ? totals.adminCommentedCount / totals.reviewCount : null;

  return (
    <StatisticsShell filterOptions={{ channel: false, granularity: false }}>
      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <KpiTile
              label="리뷰 수"
              value={formatCount(totals?.reviewCount)}
              previous={
                totals ? { current: totals.reviewCount, previous: totals.previousReviewCount } : undefined
              }
              isLoading={isLoading}
            />
            <KpiTile
              label="평균 평점"
              value={formatRating(totals?.averageRating)}
              hint={totals?.previousAverageRating != null ? `전기간 ${formatRating(totals.previousAverageRating)}` : undefined}
              isLoading={isLoading}
            />
            <KpiTile
              label="포토리뷰 비율"
              value={formatPercent(photoRate)}
              hint={`포토 ${formatCount(totals?.photoReviewCount)}건`}
              isLoading={isLoading}
            />
            <KpiTile
              label="리뷰 전환율"
              value={formatPercent(conversionRate)}
              hint={`작성 자격 ${formatCount(totals?.eligibleCount)}건 중 ${formatCount(totals?.consumedEligibleCount)}건 작성`}
              isLoading={isLoading}
            />
            <KpiTile
              label="응대율"
              value={formatPercent(commentRate)}
              hint="어드민 댓글이 달린 리뷰 비율"
              isLoading={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="리뷰 수 추이"
              description="KST 일별 · 숨김/삭제 리뷰는 제외됩니다."
              isLoading={isLoading}
              isEmpty={!data || data.series.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                  <Tooltip formatter={(value: number) => formatCount(value)} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name="리뷰 수"
                    stroke={SERIES_COLORS[0]}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="평균 평점 추이"
              description="그날 작성된 리뷰의 평균 평점입니다."
              isLoading={isLoading}
              isEmpty={!data || data.series.length === 0}
            >
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#999" domain={[1, 5]} tickCount={5} />
                  <Tooltip formatter={(value: number) => formatRating(value)} />
                  <Line
                    type="monotone"
                    dataKey="averageRating"
                    name="평균 평점"
                    stroke={SERIES_COLORS[1]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="평점 분포"
              isLoading={isLoading}
              isEmpty={!data || data.ratingDistribution.every((bucket) => bucket.count === 0)}
            >
              <HorizontalBarList
                items={(data?.ratingDistribution ?? []).map((bucket) => ({
                  label: `★${bucket.rating}`,
                  value: bucket.count,
                }))}
                formatValue={formatCount}
              />
            </ChartCard>

            <ChartCard
              title="저평점 경보"
              description="기간 평균 평점이 3.5 미만인 상품 (리뷰 3건 이상) — 상세페이지·품질·배송 문제의 빠른 신호입니다."
              isLoading={isLoading}
              isEmpty={!data || data.lowRated.length === 0}
              emptyText="기간 내 저평점 경보 대상이 없습니다"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">상품</th>
                      <th className="py-1.5 text-right">평균 평점</th>
                      <th className="py-1.5 text-right">리뷰 수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.lowRated ?? []).map((row) => (
                      <tr key={row.productId} className="border-b last:border-0">
                        <td className="py-1.5">
                          <span className="font-medium text-gray-900">{productLabel(row.productId)}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-red-600">
                          {formatRating(row.averageRating)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.reviewCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                totalItems={data?.lowRatedTotalItems}
                page={lowRatedPage}
                pageSize={PAGE_SIZE}
                onPageChange={setLowRatedPage}
                unitLabel="개 상품"
              />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="리뷰 많은 상품"
              description="기간 내 작성된 리뷰 수 기준입니다."
              isLoading={isLoading}
              isEmpty={!data || data.topProducts.length === 0}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">#</th>
                      <th className="py-1.5 text-left">상품</th>
                      <th className="py-1.5 text-right">리뷰 수</th>
                      <th className="py-1.5 text-right">평균 평점</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.topProducts ?? []).map((row, index) => (
                      <tr key={row.productId} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-400">{(topProductsPage - 1) * PAGE_SIZE + index + 1}</td>
                        <td className="py-1.5">
                          <span className="font-medium text-gray-900">{productLabel(row.productId)}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.reviewCount)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatRating(row.averageRating)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                totalItems={data?.topProductsTotalItems}
                page={topProductsPage}
                pageSize={PAGE_SIZE}
                onPageChange={setTopProductsPage}
                unitLabel="개 상품"
              />
            </ChartCard>

            <ChartCard
              title="베스트 리뷰"
              description="기간 내 작성 리뷰 중 리액션(도움돼요 등)을 받은 순 — 전시 후보입니다."
              isLoading={isLoading}
              isEmpty={!data || data.bestReviews.length === 0}
              emptyText="기간 내 리액션을 받은 리뷰가 없습니다"
            >
              <ul className="space-y-3">
                {(data?.bestReviews ?? []).map((review) => (
                  <li key={review.reviewId} className="border-b pb-3 text-xs last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-amber-500">★ {review.rating}</span>
                      <span className="truncate font-medium text-gray-900">{productLabel(review.productId)}</span>
                      {review.hasPhoto && (
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                          포토
                        </span>
                      )}
                      <span className="ml-auto shrink-0 tabular-nums text-gray-500">
                        리액션 {formatCount(review.reactionCount)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-gray-600">{review.contentExcerpt}</p>
                  </li>
                ))}
              </ul>
            </ChartCard>
          </div>
        </div>
      )}
    </StatisticsShell>
  );
}
