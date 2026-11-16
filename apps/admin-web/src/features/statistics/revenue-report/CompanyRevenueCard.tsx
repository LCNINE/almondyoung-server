'use client';

import { useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, daysBetweenInclusive, daysInMonth } from '../growth/calendar';
import { planBetween } from '../growth/pacing';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api/client';
import { ANALYTICS_SERVICE_BASE_URL } from '@/const/api-const';
import { useGrowthSummary } from '@/lib/services/analytics';
import { useOrderRefunds } from '@/lib/services/wallet/queries';
import { refundMap, OWN_MALL_CHANNEL } from '../growth/model';
import { kstToday } from '../as-of';
import { formatKrw, formatKrwAxis } from '../shared';
import {
  annualCompanyRevenue,
  REVENUE_CHANNELS,
  type RevenueChannel,
} from './company-revenue';
import { appendGoalEvidence, goalExportRows } from './goal-export';
import { appendCompanyRevenueEvidence } from './company-revenue-export';
import { BASES, CHANNELS, type RevenueReport } from './model';

/** Shared annual view: every statistics tab and the home goal read the same persisted uploads. */
export function CompanyRevenueCard() {
  const [channel, setChannel] = useState<RevenueChannel>('all');
  const summaryQuery = useGrowthSummary();
  const summary = summaryQuery.data;
  const year = summary?.year ?? Number(kstToday().slice(0, 4));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const report = useQuery({
    queryKey: ['revenue-report', year],
    queryFn: async () =>
      (
        await client.get<RevenueReport>(
          `${ANALYTICS_SERVICE_BASE_URL}/statistics/revenue-report?year=${year}&includeHistory=false`
        )
      ).data,
    staleTime: 60_000,
  });
  const refundsQuery = useOrderRefunds(
    `${year ?? ''}-01-01`,
    summary?.today ?? '',
    Boolean(summary)
  );
  const loading =
    summaryQuery.isPending ||
    report.isPending ||
    (Boolean(summary) && refundsQuery.isLoading);

  if (summaryQuery.isError || report.isError) {
    return (
      <p role="alert" className="mb-4 rounded-lg border p-4 text-sm">
        통합 매출을 불러오지 못했습니다. 일부 금액만 합산하지 않습니다.
      </p>
    );
  }
  if (loading || !summary || !report.data) {
    return (
      <p className="mb-4 rounded-lg border p-4 text-sm">
        통합 매출을 불러오는 중입니다.
      </p>
    );
  }

  const refunds = refundsQuery.isError
    ? null
    : refundMap(refundsQuery.data?.series);
  const base = summary.goal ? goalExportRows(summary, refunds) : null;
  const revenue = annualCompanyRevenue({
    today: summary.today,
    coverageStart: summary.coverageStart,
    hasIntegratedChannels: summary.channels.some(
      (item) => item !== OWN_MALL_CHANNEL
    ),
    daily: summary.ytdDaily,
    refunds,
    external: report.data.external,
  });
  const { imported } = revenue;
  const total = revenue.totals?.all ?? null;
  const selectedAmount = revenue.totals?.[channel] ?? null;
  const target = summary.goal?.annualTarget ?? 0;
  const selectedRatio =
    selectedAmount !== null && target > 0 ? selectedAmount / target : null;
  const remaining = total === null ? null : Math.max(target - total, 0);
  const remainingDays = daysBetweenInclusive(
    summary.today,
    `${summary.year}-12-31`
  );
  const asOf = addDays(summary.today, -1);
  let cumulative = 0;
  const chart = revenue.monthly.map((row) => {
    cumulative += row[channel];
    const monthEnd = addDays(
      `${row.month}-01`,
      daysInMonth(summary.year, Number(row.month.slice(5))) - 1
    );
    const end = row.month === revenue.currentMonth ? asOf : monthEnd;

    return {
      month: row.month,
      actual:
        row.month <= revenue.currentMonth && selectedAmount !== null
          ? cumulative
          : null,
      plan:
        channel === 'all' && summary.goal
          ? planBetween(
              summary.year,
              summary.goal.monthlyTargets,
              `${summary.year}-01-01`,
              end
            )
          : null,
    };
  });

  async function download() {
    if (!summary || !report.data) return;

    setExporting(true);
    setError('');
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      appendCompanyRevenueEvidence(
        XLSX,
        book,
        summary,
        refunds,
        report.data.external,
        channel
      );
      if (summary.goal) appendGoalEvidence(XLSX, book, summary, refunds);
      XLSX.writeFile(book, `매출목표_${summary.year}_통합근거.xlsx`);
    } catch {
      setError('엑셀을 만들지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section
      className="mb-4 space-y-4 rounded-lg border border-gray-200 bg-white p-4"
      aria-label="회사 전체 매출 목표"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {summary.year}년 회사 전체 매출
        </h2>
        <div className="flex flex-wrap gap-3 text-sm text-orange-800">
          <button
            type="button"
            onClick={download}
            disabled={exporting || total === null}
          >
            {exporting ? '생성 중…' : '매출 근거 엑셀'}
          </button>
          <Link href="/statistics/sales#revenue-report">
            자료 업로드·다운로드
          </Link>
          <Link href="/statistics/settings#revenue-goal">목표 설정</Link>
        </div>
      </div>
      <div
        role="group"
        aria-label="매출 채널 선택"
        className="flex flex-wrap gap-1"
      >
        {(Object.keys(REVENUE_CHANNELS) as RevenueChannel[])
          .filter(
            (key) =>
              !['phone', 'other'].includes(key) ||
              revenue.monthly.some((row) => row[key] !== 0)
          )
          .map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={channel === key}
              onClick={() => setChannel(key)}
              className={`rounded-md px-3 py-1.5 text-sm ${channel === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {REVENUE_CHANNELS[key]}
            </button>
          ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500">
              {channel === 'all'
                ? '올해 전체 매출'
                : `올해 ${REVENUE_CHANNELS[channel]} 매출`}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {selectedAmount === null
                ? '환불 확인 필요'
                : formatKrw(selectedAmount)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {channel === 'own_mall'
                ? '이전 카페24 자사몰 매출 포함'
                : '등록된 매출 자료 기준 · 잠정'}
            </p>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-gray-500">
                {channel === 'all'
                  ? '연간 목표 달성률'
                  : '회사 연간 목표 기여율'}
              </span>
              <strong className="text-xl tabular-nums">
                {selectedRatio === null
                  ? '—'
                  : `${(selectedRatio * 100).toFixed(1)}%`}
              </strong>
            </div>
            <div
              className="mt-1 h-3 overflow-hidden rounded-full bg-gray-100"
              role="img"
              aria-label={`${channel === 'all' ? '목표 달성률' : '목표 기여율'} ${selectedRatio === null ? '확인 필요' : `${(selectedRatio * 100).toFixed(1)}%`}`}
            >
              <div
                className="h-full bg-blue-500"
                style={{
                  width: `${Math.max(0, Math.min(selectedRatio ?? 0, 1)) * 100}%`,
                }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              회사 연간 목표 {target > 0 ? formatKrw(target) : '미설정'}
            </p>
          </div>
          {target > 0 && remaining !== null ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">회사 목표까지</p>
                <p className="mt-1 font-bold">{formatKrw(remaining)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">하루에 필요한 매출</p>
                <p className="mt-1 font-bold">
                  {remainingDays > 0
                    ? formatKrw(Math.ceil(remaining / remainingDays))
                    : '—'}
                </p>
                <p className="text-[11px] text-gray-500">
                  전체 채널 · 남은 {remainingDays}일
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-xs text-gray-500">
            {REVENUE_CHANNELS[channel]} 누적 매출 · 월별
          </p>
          {selectedAmount === null ? (
            <p role="alert" className="py-12 text-sm">
              환불 자료 확인 후 매출과 달성률을 표시합니다.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart
                data={chart}
                margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="month"
                  tickFormatter={(value: string) =>
                    `${Number(value.slice(5))}월`
                  }
                  tick={{ fontSize: 11 }}
                />
                <YAxis tickFormatter={formatKrwAxis} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number) => formatKrw(value)}
                  labelFormatter={(value) =>
                    `${value}${value === revenue.currentMonth ? ' · 진행 중' : ''}`
                  }
                />
                <Area
                  type="linear"
                  dataKey="actual"
                  name="실적 누적"
                  stroke="#2878df"
                  fill="#2878df"
                  fillOpacity={0.12}
                  connectNulls={false}
                />
                <Line
                  type="linear"
                  dataKey="plan"
                  name="계획 누적"
                  stroke="#9ca3af"
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 flex gap-3 text-xs text-gray-500">
            <span className="text-blue-600">실적 누적</span>
            {channel === 'all' ? <span>계획 누적</span> : null}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            자사몰 {asOf}까지 + 채널별 업로드 자료. 이번 달은 등록된 금액까지만
            반영합니다.
          </p>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        연초부터의 누적 매출입니다. 미확인 자료는 합산에서 제외하며, 채널별 반영
        기간은 아래에서 확인할 수 있습니다.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer">
          합산 근거·확인할 자료 ({imported.excludedCount}건)
        </summary>
        <p className="my-2 text-xs leading-relaxed text-gray-600">
          자사몰은 현재 자사몰과 전환 전 카페24 자료를 합칩니다. 출처 미확인
          수기 누적액 {formatKrw(base?.preCoverageActual ?? 0)}은 제외했습니다.
          카페24 전환기·전화 주문은 중복 대조 후 반영합니다. 셀메이트에 옮겨
          입력한 주문과 은행 입금은 별도 매출로 더하지 않습니다. 채널별
          매출·환불 기준이 달라 잠정 금액이며, 기존 취소와 결제 환불의 중복 차감
          여부도 확인 중입니다. 월별 자료를 일별 실적으로 나누지 않으므로 회사
          전체 연말 예측·달성 확률·이익은 아직 계산하지 않습니다.
        </p>
        <p className="my-2 text-xs text-gray-600">
          월 합계만 있는 자료는 아래 일별·상품·고객·이익 지표에 배분하지
          않습니다. 카페24 전환기와 전화 주문은 자사몰·다른 채널과 중복 대조 후
          반영합니다. 제외한 수기액과 카페24 금액의 차이는 미확인 차이이며 누락
          매출로 간주하지 않습니다.
        </p>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>월</th>
                <th>채널·계정</th>
                <th>기준</th>
                <th>금액</th>
                <th>반영</th>
              </tr>
            </thead>
            <tbody>
              {imported.rows.map((row) => (
                <tr
                  key={JSON.stringify([
                    row.channel,
                    row.account,
                    row.month,
                    row.basis,
                  ])}
                  className="border-t"
                >
                  <td className="py-2">{row.month}</td>
                  <td>
                    {CHANNELS[row.channel] ?? row.channel} · {row.account}
                  </td>
                  <td>{BASES[row.basis] ?? row.basis}</td>
                  <td>{formatKrw(row.amount)}</td>
                  <td>{row.included ? '잠정 합산' : row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
