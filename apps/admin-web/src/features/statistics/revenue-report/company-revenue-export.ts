import type * as XLSXTypes from 'xlsx';
import type { GrowthSummary } from '@/lib/api/domains/analytics';
import { OWN_MALL_CHANNEL } from '../growth/model';
import {
  annualCompanyRevenue,
  REVENUE_CHANNELS,
  type RevenueChannel,
} from './company-revenue';
import { goalExportRows } from './goal-export';
import { BASES, CHANNELS, type ExternalRevenueRow } from './model';

/** Use the same reviewed ledger for the headline download and the accountant's full workbook. */
export function appendCompanyRevenueEvidence(
  XLSX: typeof XLSXTypes,
  book: XLSXTypes.WorkBook,
  summary: GrowthSummary,
  refunds: Map<string, number> | null,
  external: ExternalRevenueRow[],
  channel: RevenueChannel = 'all'
) {
  const revenue = annualCompanyRevenue({
    today: summary.today,
    coverageStart: summary.coverageStart,
    hasIntegratedChannels: summary.channels.some(
      (item) => item !== OWN_MALL_CHANNEL
    ),
    daily: summary.ytdDaily,
    refunds,
    external,
  });
  const { imported, dailyAmount } = revenue;
  const base = summary.goal ? goalExportRows(summary, refunds) : null;
  const total = revenue.totals?.all ?? null;
  const selectedAmount = revenue.totals?.[channel] ?? null;
  const target = summary.goal?.annualTarget ?? 0;
  const ratio = total !== null && target > 0 ? total / target : null;
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['항목', '값'],
      ['연도', summary.year],
      ['조회일', summary.today],
      ['회사 전체 매출 · 잠정', total],
      ['일별 집계 반영액', dailyAmount],
      ['합산 제외 · 근거 미확인 수기 누적액', base?.preCoverageActual ?? null],
      ['일별 집계 시작일', summary.coverageStart],
      [
        '과거 수기 포함 집계 · 현재 목표에서 제외',
        base?.pacing.actualToDate ?? null,
      ],
      ['기존 실적 기준일', base?.pacing.asOf ?? null],
      ['업로드 채널 매출', imported.amount],
      ['그중 진행 중인 달', imported.currentMonthAmount],
      ['연간 목표', target],
      ['회사 목표 달성률 · 잠정', ratio],
      ['화면 선택 채널', REVENUE_CHANNELS[channel]],
      ['선택 채널 매출', selectedAmount],
      [
        '주의',
        '수기 누적액은 합산 제외. 일별 집계와 반영 가능한 업로드의 잠정 소계이며 회사 전체 확정 매출이 아님. 전환기·전화 주문 누락 및 서로 다른 매출·환불 기준은 추가 대조 필요.',
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
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      revenue.monthly
        .filter((row) => row.month <= revenue.currentMonth)
        .map((row) => ({
          월: row.month,
          전체: revenue.totals ? row.all : null,
          자사몰: revenue.totals ? row.own_mall : null,
          스마트스토어: revenue.totals ? row.naver : null,
          쿠팡: revenue.totals ? row.coupang : null,
          전화주문: revenue.totals ? row.phone : null,
          기타채널: revenue.totals ? row.other : null,
        }))
    ),
    '월별 채널 매출'
  );
}
