'use client';

import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useProductStatistics } from '@/lib/services/analytics';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList } from '../components/widgets';
import { changeRate, formatCount, formatKrw, formatPercent, useStatisticsRange } from '../shared';

const SORT_OPTIONS = [
  { value: 'revenue', label: '순매출순' },
  { value: 'quantity', label: '판매량순' },
  { value: 'orders', label: '주문수순' },
] as const;

export default function ProductStatisticsTemplate() {
  const range = useStatisticsRange();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sort = (searchParams.get('sort') as 'revenue' | 'quantity' | 'orders') ?? 'revenue';

  const { data, isLoading, isError } = useProductStatistics({ ...range, sort, limit: 20 });

  const setSort = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', value);
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
            title="상품 랭킹"
            description="증감은 직전 동일 길이 기간의 순매출 대비입니다."
            isLoading={isLoading}
            isEmpty={!data || data.ranking.length === 0}
          >
            <div className="mb-3 flex gap-1">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSort(option.value)}
                  className={
                    sort === option.value
                      ? 'rounded-full bg-orange-500 px-3 py-1 text-xs font-medium text-white'
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
                        <td className="py-1.5 text-gray-400">{index + 1}</td>
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
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="카테고리별 매출 구성"
              description="대표(primary) 카테고리 기준 · 총매출"
              isLoading={isLoading}
              isEmpty={!data || data.categories.length === 0}
            >
              <HorizontalBarList
                items={(data?.categories ?? []).map((row) => ({ label: row.categoryId, value: row.grossRevenue }))}
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
                        <td className="py-1.5">{row.variantName ?? row.variantId}</td>
                        <td className="py-1.5 text-gray-500">{row.masterName ?? row.masterId}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.quantitySold)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatKrw(row.grossRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>
        </div>
      )}
    </StatisticsShell>
  );
}
