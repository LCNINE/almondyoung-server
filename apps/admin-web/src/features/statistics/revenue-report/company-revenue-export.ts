import type { MembershipRevenueDto } from '@/lib/types/dto/wallet';
import type * as XLSXTypes from 'xlsx';
import type { GrowthSummary } from '@/lib/api/domains/analytics';
import { OWN_MALL_CHANNEL } from '../growth/model';
import {
  annualCompanyRevenue,
  companyMonthlyRows,
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
  channel: RevenueChannel = 'all',
  membership?: MembershipRevenueDto | null
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
    membership: membership?.series ?? (membership === null ? null : undefined),
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
      ['회사 매출 소계 · 수집 자료 기준', total],
      ['일별 상품 집계 반영액', dailyAmount],
      ['멤버십 결제', membership?.capturedAmount ?? null],
      ['멤버십 환불', membership?.refundedAmount ?? null],
      ['멤버십 반영액', membership?.totalAmount ?? null],
      ['합산 제외 · 근거 미확인 수기 누적액', base?.preCoverageActual ?? null],
      ['일별 집계 시작일', summary.coverageStart],
      [
        '과거 수기 포함 집계 · 현재 목표에서 제외',
        base?.pacing.actualToDate ?? null,
      ],
      ['기존 실적 기준일', base?.pacing.asOf ?? null],
      ['목표 등록 시각', summary.goal?.createdAt ?? null],
      ['당시 등록 메모', summary.goal?.memo ?? null],
      [
        '수기액 설명',
        '이전 화면은 수기 보정액에 이후 집계 매출을 더했음. 당시 참고 누적액의 원본·포함 채널은 미확인. 현재는 수기액을 빼고 채널별 근거 자료를 반영하며 차이를 누락 매출로 단정하지 않음.',
      ],
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
          멤버십: revenue.totals ? row.membership : null,
          기타채널: revenue.totals ? row.other : null,
        }))
    ),
    '월별 채널 매출'
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      companyMonthlyRows(revenue, summary.coverageStart).map((row) => ({
        월: row.month,
        '현재 자사몰(메두사)': revenue.totals ? row.medusa : null,
        '이전 자사몰(카페24)': revenue.totals ? row.cafe24 : null,
        스마트스토어: revenue.totals ? row.naver : null,
        쿠팡: revenue.totals ? row.coupang : null,
        전화주문: revenue.totals ? row.phone : null,
        멤버십: revenue.totals ? row.membership : null,
        기타채널: revenue.totals ? row.other : null,
        전체합계: revenue.totals ? row.all : null,
        비고: '미등록·집계 전·미도래는 빈칸. 수집분 잠정 합계.',
      }))
    ),
    '월별 채널 상세'
  );
}
