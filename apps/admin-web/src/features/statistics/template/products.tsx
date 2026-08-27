'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useProductStatistics, useUnsoldProducts } from '@/lib/services/analytics';
import { PaginationBar } from '../components/pagination';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList } from '../components/widgets';
import { changeRate, formatCount, formatKrw, formatPercent, useStatisticsRange } from '../shared';

const PAGE_SIZE = 50;

const SORT_OPTIONS = [
  { value: 'revenue', label: '순매출순' },
  { value: 'quantity', label: '판매량순' },
  { value: 'orders', label: '주문수순' },
] as const;

const ORDER_OPTIONS = [
  { value: 'desc', label: '상위' },
  { value: 'asc', label: '하위' },
] as const;

export default function ProductStatisticsTemplate() {
  const range = useStatisticsRange();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sort = (searchParams.get('sort') as 'revenue' | 'quantity' | 'orders') ?? 'revenue';
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';

  const [page, setPage] = useState(1);
  const [variantPage, setVariantPage] = useState(1);
  const [unsoldPage, setUnsoldPage] = useState(1);

  // 조회 조건이 바뀌면 페이지가 범위를 벗어날 수 있다 — 1페이지로 되돌린다
  useEffect(() => {
    setPage(1);
    setVariantPage(1);
    setUnsoldPage(1);
  }, [range.from, range.to, range.channel]);

  const { data, isLoading, isError } = useProductStatistics({
    ...range,
    sort,
    limit: PAGE_SIZE,
    order,
    page,
    variantPage,
  });
  const unsold = useUnsoldProducts({
    from: range.from,
    to: range.to,
    channel: range.channel,
    limit: PAGE_SIZE,
    page: unsoldPage,
  });

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    setPage(1);
    setVariantPage(1);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <StatisticsShell>
      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <ChartCard
            title={order === 'asc' ? '상품 랭킹 (하위)' : '상품 랭킹'}
            description={
              order === 'asc'
                ? '판매 실적이 가장 낮은 상품부터 표시합니다. 기간 내 판매가 아예 없는 상품은 아래 무판매 상품 카드에서 확인하세요.'
                : '증감은 직전 동일 길이 기간의 순매출 대비입니다.'
            }
            isLoading={isLoading}
            isEmpty={!data || data.ranking.length === 0}
          >
            <div className="mb-3 flex flex-wrap items-center gap-1">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setParam('sort', option.value)}
                  className={
                    sort === option.value
                      ? 'rounded-full bg-orange-500 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50'
                  }
                >
                  {option.label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-gray-200" />
              {ORDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setParam('order', option.value)}
                  className={
                    order === option.value
                      ? 'rounded-full bg-gray-800 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">상품</th>
                    <th className="py-1.5 text-right">판매량</th>
                    <th className="py-1.5 text-right">주문수</th>
                    <th className="py-1.5 text-right">총매출</th>
                    <th className="py-1.5 text-right">순매출</th>
                    <th className="py-1.5 text-right">전기간 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.ranking ?? []).map((row, index) => {
                    const rate = changeRate(row.netRevenue, row.previousNetRevenue);
                    return (
                      <tr key={row.masterId} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-400">{(page - 1) * PAGE_SIZE + index + 1}</td>
                        <td className="py-1.5">
                          <span className="font-medium text-gray-900">{row.name ?? row.masterId}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.quantitySold)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.ordersCount)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatKrw(row.grossRevenue)}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{formatKrw(row.netRevenue)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {rate == null ? (
                            <span className="text-gray-400">신규</span>
                          ) : (
                            <span className={rate >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                              {rate >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(rate))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationBar
              totalItems={data?.rankingTotalItems}
              page={page}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              unitLabel="개 상품"
            />
          </ChartCard>

          <ChartCard
            title="기간 내 무판매 상품"
            description="판매중(활성) 상품 중 조회 기간에 판매가 0건인 상품입니다. 마지막 판매일이 오래된 순."
            isLoading={unsold.isLoading}
            isEmpty={!unsold.data || unsold.data.items.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">상품</th>
                    <th className="py-1.5 text-right">마지막 판매일</th>
                  </tr>
                </thead>
                <tbody>
                  {(unsold.data?.items ?? []).map((row, index) => (
                    <tr key={row.masterId} className="border-b last:border-0">
                      <td className="py-1.5 text-gray-400">{(unsoldPage - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="py-1.5">
                        <span className="font-medium text-gray-900">{row.name ?? row.masterId}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.lastSoldDate ?? <span className="text-gray-400">판매 기록 없음</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar
              totalItems={unsold.data?.total}
              page={unsoldPage}
              pageSize={PAGE_SIZE}
              onPageChange={setUnsoldPage}
              unitLabel="개 상품"
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="카테고리별 매출 구성"
              description="대표(primary) 카테고리 기준 · 총매출"
              isLoading={isLoading}
              isEmpty={!data || data.categories.length === 0}
            >
              <HorizontalBarList
                items={(data?.categories ?? []).map((row) => ({ label: row.categoryName ?? row.categoryId, value: row.grossRevenue }))}
                formatValue={formatKrw}
              />
            </ChartCard>

            <ChartCard
              title="옵션별 판매"
              description="옵션 단위는 취소·환불 귀속 정보가 없어 총매출만 제공됩니다 (순매출 아님)."
              isLoading={isLoading}
              isEmpty={!data || data.variants.length === 0}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">옵션</th>
                      <th className="py-1.5 text-left">상품</th>
                      <th className="py-1.5 text-right">판매량</th>
                      <th className="py-1.5 text-right">총매출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.variants ?? []).map((row) => (
                      <tr key={row.variantId} className="border-b last:border-0">
                        <td className="py-1.5">{row.variantName ?? (row.isDefault ? '기본 품목' : row.variantId)}</td>
                        <td className="py-1.5 text-gray-500">{row.masterName ?? row.masterId}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.quantitySold)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatKrw(row.grossRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                totalItems={data?.variantTotalItems}
                page={variantPage}
                pageSize={PAGE_SIZE}
                onPageChange={setVariantPage}
                unitLabel="개 옵션"
              />
            </ChartCard>
          </div>
        </div>
      )}
    </StatisticsShell>
  );
}
