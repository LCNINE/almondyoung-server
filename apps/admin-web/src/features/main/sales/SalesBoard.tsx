'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { HelpPopover } from '@/features/main/HelpPopover';
import { useAnalyticsOverview, useSalesStatistics } from '@/lib/services/analytics';
import { useDailyPayments } from '@/lib/services/wallet';
import { asOfLabel, kstDaysAgo, kstToday, stalenessNote } from '@/features/statistics/as-of';
import { formatCount } from '@/features/statistics/shared';
import { cn } from '@/lib/utils/ui';
import { ChevronRight } from 'lucide-react';
import { buildSalesInsights } from './sales-insight';
import { buildSalesTable, mergeDailySales, SalesCell } from './sales-table';

/** 차트에 그리는 창. 카페24와 같은 최근 7일 — 그보다 길면 막대가 뭉개진다. */
const CHART_DAYS = 7;
/** 표의 "최근 30일" 행을 만들려면 30일치가 필요하다. */
const TABLE_DAYS = 30;
const SKELETON_ROWS = 7;

const SERIES = {
  order: { key: 'orderAmount', chartKey: 'orderMan', name: '주문', color: '#4DAFFF', mark: 'bar' },
  paid: { key: 'paidAmount', chartKey: 'paidMan', name: '결제', color: '#E566CA', mark: 'line' },
  refund: { key: 'refundAmount', chartKey: 'refundMan', name: '환불', color: '#9065E6', mark: 'line' },
} as const;

type Series = (typeof SERIES)[keyof typeof SERIES];

const LEGEND_ORDER: Series[] = [SERIES.paid, SERIES.order, SERIES.refund];

const HIGHLIGHT_ROW_KEYS = new Set(['7-average', '30-total']);

const TONE_CLASS: Record<string, string> = {
  up: 'text-[#D71952]',
  down: 'text-[#1779BA]',
  alert: 'text-[#D71952]',
};

export function SalesBoard() {
  const today = kstToday();
  const range = { from: kstDaysAgo(TABLE_DAYS - 1), to: today };

  const sales = useSalesStatistics({ from: range.from, to: range.to, granularity: 'day' });
  const payments = useDailyPayments(range.from, range.to);
  const overview = useAnalyticsOverview();

  const daily = useMemo(
    () =>
      mergeDailySales(
        sales.isError ? [] : (sales.data?.series ?? []),
        payments.isError ? [] : (payments.data?.series ?? []),
        range.from,
        range.to,
      ),
    [sales.data, sales.isError, payments.data, payments.isError, range.from, range.to],
  );
  const rows = useMemo(() => buildSalesTable(daily, today), [daily, today]);
  const anyAxisFailed = sales.isError || payments.isError;
  const insights = useMemo(
    () => (anyAxisFailed ? [] : buildSalesInsights(daily, today)),
    [anyAxisFailed, daily, today],
  );
  const failedKeys = new Set<string>([
    ...(sales.isError ? [SERIES.order.key] : []),
    ...(payments.isError ? [SERIES.paid.key, SERIES.refund.key] : []),
  ]);
  const chartData = useMemo(
    () =>
      daily.slice(-CHART_DAYS).map((point) => ({
        ...point,
        label: point.date.slice(5),
        orderMan: point.orderAmount / 10_000,
        paidMan: point.paidAmount / 10_000,
        refundMan: point.refundAmount / 10_000,
      })),
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
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-2">
        {isLoading ? (
          <Skeleton className="h-5 w-60" />
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 divide-x divide-[#E0E0E0] [&>*:not(:first-child)]:pl-4">
            {insights.map((insight) => (
              <span key={insight.key} className="text-[13px] text-[#757575]">
                {insight.label} <b className={cn('font-bold', TONE_CLASS[insight.tone])}>{insight.value}</b>
              </span>
            ))}
          </div>
        )}
        <Link
          href="/statistics/overview"
          className="flex shrink-0 items-center gap-0.5 text-[13px] text-[#1779BA] hover:underline"
        >
          기간 바꿔 분석 <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {failed.length > 0 ? (
        <p className="text-xs text-[#D71952]">{failed.join('·')} 데이터를 불러오지 못했습니다.</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs text-[#757575]">
              단위/만원
              <HelpPopover
                label="매출 기준"
                items={[
                  '주문은 주문이 들어온 날, 결제는 돈이 들어온 날, 환불은 환불이 나간 날 기준으로 집계합니다.',
                  '기준 날짜가 서로 달라 세 금액의 합은 맞지 않습니다.',
                  '금액 아래 숫자는 건수입니다.',
                ]}
              />
            </span>
            {asOf ? <span className="text-xs text-[#757575]">{asOf}</span> : null}
          </div>
          {stale ? <p className="mb-1 text-[11px] text-amber-700">{stale}</p> : null}
          <div className="h-[288px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : chartData.length === 0 ? (
              <p className="py-16 text-center text-xs text-gray-400">조회 기간에 매출 기록이 없습니다</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={256}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="salesOrderBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SERIES.order.color} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={SERIES.order.color} stopOpacity={0.5} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#EBEBEB" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 13, fill: '#757575' }}
                      stroke="#707070"
                      tickLine={{ stroke: '#707070' }}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#757575' }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                      allowDecimals={false}
                      tickFormatter={(value: number) => value.toLocaleString('ko-KR')}
                    />
                    <Tooltip
                      cursor={{ stroke: '#707070', strokeDasharray: '3 3' }}
                      content={<SalesTooltip failedKeys={failedKeys} />}
                    />
                    <Bar
                      hide={failedKeys.has(SERIES.order.key)}
                      dataKey={SERIES.order.chartKey}
                      name={SERIES.order.name}
                      fill="url(#salesOrderBar)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                    {[SERIES.paid, SERIES.refund].map((series) => (
                      <Line
                        key={series.key}
                        hide={failedKeys.has(series.key)}
                        type="linear"
                        dataKey={series.chartKey}
                        name={series.name}
                        stroke={series.color}
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#fff', stroke: series.color, strokeWidth: 2 }}
                        activeDot={{ r: 5, fill: '#fff', stroke: series.color, strokeWidth: 2 }}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="mt-2 flex justify-center gap-4 text-sm text-[#2B2B2B]">
                  {LEGEND_ORDER.map((series) => (
                    <span key={series.key} className="inline-flex items-center gap-1.5">
                      <SeriesIcon series={series} />
                      {series.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#CCCCCC] bg-[#FAFAFA] text-sm text-[#1C1C1C]">
                <th className="px-2.5 py-1 text-left font-medium">기간별 매출</th>
                {[SERIES.order, SERIES.paid, SERIES.refund].map((series) => (
                  <th key={series.name} className="px-2.5 py-1 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <SeriesIcon series={series} />
                      {series.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <tr key={index} className="border-b border-[#EBEBEB]">
                    <td className="px-3 py-1.5">
                      <Skeleton className="h-5 w-20" />
                    </td>
                    {[0, 1, 2].map((cell) => (
                      <td key={cell} className="px-3 py-1.5">
                        <Skeleton className="ml-auto h-5 w-16" />
                        <Skeleton className="ml-auto mt-0.5 h-[17.5px] w-8" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-gray-400">
                    조회 기간에 매출 기록이 없습니다
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const highlighted = HIGHLIGHT_ROW_KEYS.has(row.key);
                  const emphasized = row.isToday || highlighted;
                  return (
                    <tr
                      key={row.key}
                      className={cn(
                        'border-b border-[#EBEBEB]',
                        row.isToday && 'bg-[#FAFDFE]',
                        highlighted && 'bg-[#F1F9FD]',
                      )}
                    >
                      <td
                        className={cn(
                          'whitespace-nowrap px-3 py-1.5 font-medium text-[#616161]',
                          row.isToday && 'border-l-[3px] border-l-[#1882C8]',
                          emphasized && 'font-bold text-[#1C1C1C]',
                        )}
                      >
                        {row.label}
                        {row.isToday ? (
                          <span className="ml-1.5 rounded bg-[#1882C8] px-1 py-0.5 text-xs font-medium text-white">
                            오늘
                          </span>
                        ) : null}
                      </td>
                      <AmountCell cell={row.order} emphasized={emphasized} failed={sales.isError} />
                      <AmountCell cell={row.paid} emphasized={emphasized} failed={payments.isError} />
                      <AmountCell cell={row.refund} emphasized={emphasized} failed={payments.isError} />
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** 한 칸에 금액과 건수를 두 줄로 — 금액만으로는 객단가가 오른 건지 사람이 는 건지 모른다. */
function AmountCell({ cell, emphasized, failed }: { cell: SalesCell; emphasized: boolean; failed: boolean }) {
  if (failed) {
    return <td className="px-3 py-1.5 text-right text-sm text-[#BDBDBD]">-</td>;
  }
  return (
    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
      <div className="text-sm">
        <span className={cn('text-[#2B2B2B]', emphasized && 'font-bold')}>
          {Math.round(cell.amount).toLocaleString('ko-KR')}
        </span>
        <span className="ml-0.5 text-[#757575]">원</span>
      </div>
      <span className="mt-0.5 inline-block rounded bg-[#F2F2F2] px-1 text-xs font-medium text-[#2B2B2B]">
        {formatCount(cell.count)}건
      </span>
    </td>
  );
}

function SeriesIcon({ series }: { series: Series }) {
  if (series.mark === 'bar') {
    return <span aria-hidden className="h-2.5 w-2.5 rounded-[1px]" style={{ backgroundColor: series.color }} />;
  }
  return (
    <svg aria-hidden width="18" height="10" viewBox="0 0 18 10">
      <line x1="0" y1="5" x2="18" y2="5" stroke={series.color} strokeWidth="2" />
      <circle cx="9" cy="5" r="3" fill="#fff" stroke={series.color} strokeWidth="2" />
    </svg>
  );
}

function SalesTooltip({
  active,
  payload,
  failedKeys,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, number | string> }>;
  failedKeys: Set<string>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const valueOf = (key: string) => Number(point[key] ?? 0);
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-sm text-[#2B2B2B] shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
      {[SERIES.order, SERIES.paid, SERIES.refund].map((series) => (
        <div key={series.key} className="flex items-center gap-6 py-0.5">
          <span className="inline-flex flex-1 items-center gap-1.5">
            <SeriesIcon series={series} />
            {series.name}
          </span>
          <span className="tabular-nums">
            {failedKeys.has(series.key) ? '-' : `${Math.round(valueOf(series.key)).toLocaleString('ko-KR')}원`}
          </span>
        </div>
      ))}
    </div>
  );
}
