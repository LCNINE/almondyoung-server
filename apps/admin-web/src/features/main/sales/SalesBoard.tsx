'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalyticsOverview, useSalesStatistics } from '@/lib/services/analytics';
import { useDailyPayments } from '@/lib/services/wallet';
import { asOfLabel, kstDaysAgo, kstToday, stalenessNote } from '@/features/statistics/as-of';
import { formatCount, formatKrw, formatKrwAxis, SERIES_COLORS } from '@/features/statistics/shared';
import { cn } from '@/lib/utils/ui';
import { ChevronRight } from 'lucide-react';
import { buildSalesInsights } from './sales-insight';
import { buildSalesTable, formatDayLabel, mergeDailySales, SalesCell } from './sales-table';

/** 차트에 그리는 창. 카페24와 같은 최근 7일 — 그보다 길면 막대가 뭉개진다. */
const CHART_DAYS = 7;
/** 표의 "최근 30일" 행을 만들려면 30일치가 필요하다. */
const TABLE_DAYS = 30;

const SERIES = {
  order: { key: 'orderAmount', name: '주문', color: SERIES_COLORS[0] },
  paid: { key: 'paidAmount', name: '결제', color: SERIES_COLORS[1] },
  refund: { key: 'refundAmount', name: '환불', color: SERIES_COLORS[2] },
} as const;

const TONE_CLASS: Record<string, string> = {
  good: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  bad: 'text-red-700 bg-red-50 border-red-200',
  neutral: 'text-gray-600 bg-gray-50 border-gray-200',
};

export function SalesBoard() {
  const today = kstToday();
  const range = { from: kstDaysAgo(TABLE_DAYS - 1), to: today };

  const sales = useSalesStatistics({ from: range.from, to: range.to, granularity: 'day' });
  const payments = useDailyPayments(range.from, range.to);
  const overview = useAnalyticsOverview();

  const daily = useMemo(
    () => mergeDailySales(sales.data?.series ?? [], payments.data?.series ?? [], range.from, range.to),
    [sales.data, payments.data, range.from, range.to],
  );
  const rows = useMemo(() => buildSalesTable(daily, today), [daily, today]);
  const insights = useMemo(() => buildSalesInsights(daily, today), [daily, today]);
  const chartData = useMemo(
    () => daily.slice(-CHART_DAYS).map((point) => ({ ...point, label: formatDayLabel(point.date) })),
    [daily],
  );

  const isLoading = sales.isLoading || payments.isLoading;
  // 한쪽이 죽어도 나머지는 보여준다 — 어느 축이 비어 있는지는 문구로 밝힌다.
  const failed = [sales.isError ? '주문' : null, payments.isError ? '결제·환불' : null].filter(Boolean);
  const asOf = asOfLabel(overview.data?.dataAsOf);
  const stale = stalenessNote(overview.data?.dataAsOf);

  if (sales.isError && payments.isError) {
    return <p className="py-6 text-center text-xs text-red-500">매출을 불러오지 못했습니다.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-xs text-gray-500">
          최근 {CHART_DAYS}일 · 금액은 원, 아래 표는 건수까지
          <span className="ml-1 text-gray-400">
            (주문=주문 들어온 날 · 결제=돈 들어온 날 · 환불=환불 나간 날 — 세 축의 합은 서로 맞지 않습니다)
          </span>
        </div>
        <Link
          href="/statistics/overview"
          className="flex shrink-0 items-center gap-0.5 text-xs text-blue-600 hover:underline"
        >
          기간 바꿔 분석 <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {failed.length > 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {failed.join('·')} 축을 불러오지 못해 나머지만 표시합니다.
        </p>
      ) : null}

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : insights.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {insights.map((insight) => (
            <span
              key={insight.key}
              className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium', TONE_CLASS[insight.tone])}
            >
              {insight.text}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-[10px] border border-gray-200 p-3">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-gray-400">단위 · 원</span>
            {asOf ? <span className="text-[11px] text-gray-400">{asOf}</span> : null}
          </div>
          {stale ? <p className="mb-1 text-[11px] text-amber-700">{stale}</p> : null}
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-16 text-center text-xs text-gray-400">조회 기간에 매출 기록이 없습니다</p>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#999" />
                <YAxis tick={{ fontSize: 11 }} stroke="#999" tickFormatter={formatKrwAxis} />
                <Tooltip formatter={(value: number) => formatKrw(value)} />
                <Legend />
                <Bar dataKey={SERIES.order.key} name={SERIES.order.name} fill={SERIES.order.color} radius={[4, 4, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey={SERIES.paid.key}
                  name={SERIES.paid.name}
                  stroke={SERIES.paid.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey={SERIES.refund.key}
                  name={SERIES.refund.name}
                  stroke={SERIES.refund.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="overflow-x-auto rounded-[10px] border border-gray-200">
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50 text-gray-500">
                  <th className="px-3 py-2 text-left font-medium">기간별 매출</th>
                  {[SERIES.order, SERIES.paid, SERIES.refund].map((series) => (
                    <th key={series.name} className="px-3 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: series.color }} aria-hidden />
                        {series.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-gray-400">
                      조회 기간에 매출 기록이 없습니다
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.key}
                      className={cn(
                        'border-b last:border-0',
                        row.kind !== 'day' && 'bg-gray-50/60',
                        row.isToday && 'bg-blue-50/60',
                      )}
                    >
                      <td className={cn('px-3 py-2 text-gray-700', (row.isToday || row.kind === 'total') && 'font-semibold')}>
                        {row.label}
                        {row.isToday ? (
                          <span className="ml-1.5 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            오늘
                          </span>
                        ) : null}
                      </td>
                      <AmountCell cell={row.order} emphasized={row.isToday || row.kind === 'total'} />
                      <AmountCell cell={row.paid} emphasized={row.isToday || row.kind === 'total'} />
                      <AmountCell cell={row.refund} emphasized={row.isToday || row.kind === 'total'} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/** 한 칸에 금액과 건수를 두 줄로 — 금액만으로는 객단가가 오른 건지 사람이 는 건지 모른다. */
function AmountCell({ cell, emphasized }: { cell: SalesCell; emphasized: boolean }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      <div className={cn('text-gray-900', emphasized && 'font-semibold')}>{formatKrw(cell.amount)}</div>
      <div className="text-[11px] text-gray-400">{formatCount(cell.count)}건</div>
    </td>
  );
}
