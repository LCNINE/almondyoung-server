'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api/client';
import { ANALYTICS_SERVICE_BASE_URL } from '@/const/api-const';
import { useGrowthSummary } from '@/lib/services/analytics';
import { useOrderRefunds } from '@/lib/services/wallet/queries';
import { refundMap, OWN_MALL_CHANNEL } from '../growth/model';
import { kstToday } from '../as-of';
import { formatKrw } from '../shared';
import { companyRevenueRows } from './company-revenue';
import { appendGoalEvidence, goalExportRows } from './goal-export';
import { BASES, CHANNELS, type RevenueReport } from './model';

/** Shared annual view: every statistics tab and the home goal read the same persisted uploads. */
export function CompanyRevenueCard() {
  const summaryQuery = useGrowthSummary();
  const summary = summaryQuery.data;
  const year = Number(kstToday().slice(0, 4));
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
    Boolean(summary?.goal)
  );
  const loading =
    summaryQuery.isPending ||
    report.isPending ||
    (Boolean(summary?.goal) && refundsQuery.isLoading);

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
  const imported = companyRevenueRows(
    report.data.external,
    summary.today,
    summary.channels.some((channel) => channel !== OWN_MALL_CHANNEL)
  );
  const total = base ? base.pacing.actualToDate + imported.amount : null;
  const target = summary.goal?.annualTarget ?? 0;
  const ratio = total !== null && target > 0 ? total / target : null;

  async function download() {
    if (!summary || !report.data) return;

    setExporting(true);
    setError('');
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['항목', '값'],
          ['연도', summary.year],
          ['조회일', summary.today],
          ['잠정 통합 매출', total],
          ['기존 목표 실적', base?.pacing.actualToDate ?? null],
          ['기존 실적 기준일', base?.pacing.asOf ?? null],
          ['업로드 채널 매출', imported.amount],
          ['그중 진행 중인 달', imported.currentMonthAmount],
          ['연간 목표', target],
          ['잠정 목표 달성률', ratio],
          [
            '주의',
            '서로 다른 매출 기준과 조회시점의 잠정 합계. 확정 신고 매출이 아니며 수기 누적·이관·채널 간 중복은 추가 확인 필요.',
          ],
          [
            '예측',
            '월별 업로드는 일별 매출·전환율·객단가·이익·달성확률 계산에 배분하지 않음.',
          ],
        ]),
        '통합 목표'
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(
          imported.rows.map((row) => ({
            채널: CHANNELS[row.channel] ?? row.channel,
            계정: row.account,
            월: row.month,
            기준: BASES[row.basis] ?? row.basis,
            금액: row.amount,
            반영: row.included ? '잠정 합산' : '제외',
            사유: row.reason,
            출처: row.source,
            원본확보: row.originalStatus,
            월별대조: row.monthlyStatus,
            중복확인: row.duplicateStatus,
            입금대조: row.settlementStatus,
            대조메모: row.reviewNote,
          }))
        ),
        '채널 반영 근거'
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
      className="mb-4 space-y-3 rounded-lg border border-orange-200 bg-orange-50/40 p-4"
      aria-label="통합 매출 목표"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          {summary.year}년 통합 매출 목표 · 잠정
        </h2>
        <div className="flex gap-3 text-sm text-orange-800">
          <button type="button" onClick={download} disabled={exporting}>
            {exporting ? '생성 중…' : '통합 근거 엑셀'}
          </button>
          <Link href="/statistics/sales#revenue-report">원본·자료 업로드</Link>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-gray-600">통합 매출</p>
          <p className="text-xl font-bold">
            {total === null ? '목표 설정 필요' : formatKrw(total)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-600">업로드 채널 매출 포함</p>
          <p className="text-xl font-bold">{formatKrw(imported.amount)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">연간 목표 대비</p>
          <p className="text-xl font-bold">
            {ratio === null ? '미설정' : `${(ratio * 100).toFixed(1)}%`}{' '}
            <span className="text-sm font-normal">/ {formatKrw(target)}</span>
          </p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-gray-600">
        기존 목표 실적 {base ? formatKrw(base.pacing.actualToDate) : '미설정'} (
        {base?.pacing.asOf ?? '기준일 없음'}까지) + 네이버·쿠팡 등록 자료{' '}
        {imported.includedCount}건. 진행 중인 달{' '}
        {formatKrw(imported.currentMonthAmount)} 포함이며 채널별 기준·조회일은
        원본을 따릅니다. 선택한 기간 필터와 무관한 올해 누적입니다. 수기
        누적·채널 간 중복과 정산은 미확인으로, 확정 매출이 아닙니다. 은행 입금은
        매출에 더하지 않습니다.
        {refundsQuery.isError
          ? ' 결제 환불 조회에 실패하여 기존 실적에서 추가 차감하지 못했습니다.'
          : ''}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer">
          채널별 반영 내역 · {imported.excludedCount}건 합산 보류
        </summary>
        <p className="my-2 text-xs text-gray-600">
          월 합계만 있는 자료는 아래 일별·상품·고객·이익 지표에 배분하지
          않습니다. 카페24·전화 주문은 기존 누적액과 중복 확인 후 반영해야
          합니다.
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
