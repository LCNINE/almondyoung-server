'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
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
import { ProfitSort } from '@/lib/api/domains/analytics';
import { useProfitStatistics } from '@/lib/services/analytics';
import { StatisticsShell } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { formatCount, formatKrw, formatKrwAxis, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

const SORT_OPTIONS: ReadonlyArray<{ value: ProfitSort; label: string }> = [
  { value: 'margin', label: '마진순' },
  { value: 'marginRate', label: '마진율순' },
  { value: 'revenue', label: '순매출순' },
  { value: 'quantity', label: '판매량순' },
];

const ORDER_OPTIONS = [
  { value: 'desc', label: '상위' },
  { value: 'asc', label: '하위' },
] as const;

const PAGE_SIZE = 50;

export default function ProfitStatisticsTemplate() {
  const range = useStatisticsRange();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sort = (searchParams.get('sort') as ProfitSort) ?? 'margin';
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const [page, setPage] = useState(1);

  // 조회 조건이 바뀌면 페이지가 범위를 벗어날 수 있다 — 1페이지로 되돌린다
  useEffect(() => {
    setPage(1);
  }, [range.from, range.to, range.channel]);

  const { data, isLoading, isError } = useProfitStatistics({
    from: range.from,
    to: range.to,
    channel: range.channel,
    sort,
    order,
    page,
    limit: PAGE_SIZE,
  });

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    setPage(1);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const totals = data?.totals;
  const prev = data?.previousTotals;
  const totalPages = data ? Math.max(1, Math.ceil(data.totalItems / PAGE_SIZE)) : 1;

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
              label="추정 마진"
              value={formatKrw(totals?.estimatedMargin)}
              previous={
                totals && prev ? { current: totals.estimatedMargin, previous: prev.estimatedMargin } : undefined
              }
              hint="원가가 입력된 상품 기준 · 순매출 − 추정 원가"
              isLoading={isLoading}
            />
            <KpiTile
              label="마진율"
              value={formatPercent(totals?.marginRate)}
              hint="추정 마진 ÷ 계산 가능 순매출"
              isLoading={isLoading}
            />
            <KpiTile
              label="추정 원가"
              value={formatKrw(totals?.estimatedCost)}
              previous={totals && prev ? { current: totals.estimatedCost, previous: prev.estimatedCost } : undefined}
              hint="게시 공급가 × 판매수량 (취소·환불 금액 비례 보정)"
              isLoading={isLoading}
            />
            <KpiTile
              label="원가 커버리지"
              value={formatPercent(totals?.costCoverageRate)}
              hint="순매출 중 원가가 입력된 상품의 비중"
              isLoading={isLoading}
            />
          </div>

          {totals && totals.uncomputedNetRevenue > 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              원가 미입력 상품 {formatCount(totals.uncomputedProductsCount)}개(순매출{' '}
              {formatKrw(totals.uncomputedNetRevenue)})는 마진 계산에서 제외됐습니다. 상품 등록의 공급가를 채우면
              커버리지가 올라갑니다.
            </p>
          ) : null}

          <ChartCard
            title="마진 추이"
            description="마진·원가는 원가가 입력된 상품 몫만 반영합니다. 취소·환불이 발생일에 귀속되므로 순매출·마진이 음수인 날이 있을 수 있습니다."
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

          <ChartCard
            title="상품별 마진"
            description="기간 내 판매된 전 상품입니다. 원가 미입력 상품은 마진을 계산하지 않고 '계산 불가'로 표시합니다 — 마진 정렬에서는 항상 뒤로 갑니다."
            isLoading={isLoading}
            isEmpty={!data || data.totalItems === 0}
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
                    <th className="py-1.5 text-right">순매출</th>
                    <th className="py-1.5 text-right">공급가</th>
                    <th className="py-1.5 text-right">추정 원가</th>
                    <th className="py-1.5 text-right">추정 마진</th>
                    <th className="py-1.5 text-right">마진율</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((row, index) => (
                    <tr key={row.masterId} className="border-b last:border-0">
                      <td className="py-1.5 text-gray-400">{(page - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="py-1.5">
                        <span className="font-medium text-gray-900">{row.name ?? row.masterId}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(row.quantitySold)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatKrw(row.netRevenue)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.supplyPrice == null ? <span className="text-gray-400">미입력</span> : formatKrw(row.supplyPrice)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.estimatedCost == null ? <span className="text-gray-400">-</span> : formatKrw(row.estimatedCost)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {row.estimatedMargin == null ? (
                          <span className="font-normal text-gray-400">계산 불가</span>
                        ) : (
                          <span className={row.estimatedMargin >= 0 ? undefined : 'text-red-600'}>
                            {formatKrw(row.estimatedMargin)}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatPercent(row.marginRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
              <span>
                전체 {formatCount(data?.totalItems)}개 상품 · {page}/{totalPages} 페이지
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            </div>
          </ChartCard>
        </div>
      )}
    </StatisticsShell>
  );
}
