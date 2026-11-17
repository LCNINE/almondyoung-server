import type * as XLSXTypes from 'xlsx';
import type { GrowthSummary } from '@/lib/api/domains/analytics';
import { computePacing } from '../growth/pacing';
import { scopedDaily } from '../growth/model';

export function goalExportRows(
  summary: GrowthSummary,
  refunds: Map<string, number> | null
) {
  if (!summary.goal) throw new Error('연간 목표가 없습니다.');

  const daily = scopedDaily(summary.ytdDaily, summary.goal.scope ?? 'own_mall');
  const pacing = computePacing({
    ...summary,
    goal: summary.goal,
    ytdDaily: daily,
    orderRefundsByDay: refunds,
  });
  const rows = daily
    .filter((r) => r.date >= `${summary.year}-01-01` && r.date <= pacing.asOf)
    .map((r) => ({
      일자: r.date,
      집계순매출: r.allChannels,
      별도결제환불: refunds ? (refunds.get(r.date) ?? 0) : null,
      목표반영액: r.allChannels - (refunds?.get(r.date) ?? 0),
    }));

  return {
    rows,
    pacing,
    preCoverageActual: summary.goal.preCoverageActual ?? 0,
  };
}

export async function downloadGoalEvidence(
  summary: GrowthSummary,
  refunds: Map<string, number> | null
) {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  appendGoalEvidence(XLSX, book, summary, refunds);
  XLSX.writeFile(book, `아몬드영_${summary.year}_목표실적근거.xlsx`);
}

export function appendGoalEvidence(
  XLSX: typeof XLSXTypes,
  book: XLSXTypes.WorkBook,
  summary: GrowthSummary,
  refunds: Map<string, number> | null
) {
  const { rows, pacing, preCoverageActual } = goalExportRows(summary, refunds);
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['항목', '값'],
    ['기준일(KST)', pacing.asOf],
    [
      '목표 범위',
      summary.goal?.scope === 'all_channels'
        ? '기존 집계의 전 판매채널'
        : '자사몰',
    ],
    ['과거 수기 포함 집계(원) · 현재 회사 목표와 별도', pacing.actualToDate],
    ['집계 시작 전 실적(관리자 입력)', preCoverageActual],
    ['목표 등록 메모', summary.goal?.memo ?? '없음'],
    ['일별 목표 반영액 합계', rows.reduce((sum, r) => sum + r.목표반영액, 0)],
    [
      '검산 차이',
      pacing.actualToDate -
        preCoverageActual -
        rows.reduce((sum, r) => sum + r.목표반영액, 0),
    ],
    [
      '결제 환불 반영',
      refunds ? '반영' : '조회 실패 또는 미제공: 이 과거 대사에서는 미차감',
    ],
    ['집계 갱신 시각', summary.dataAsOf ?? '미확인'],
    ['집계 시작일', summary.coverageStart ?? '미확인'],
    [
      '주의',
      '이 시트는 과거 수기 포함 집계의 보관 근거입니다. 현재 회사 목표는 통합 목표 시트 기준이며, 주문 상품 원장은 판매 통계 > 매출에서 다운로드합니다.',
    ],
    [
      '과거 실적',
      '수동 입력된 과거 실적에는 주문별 원장이 없습니다. 카페24 원본과 별도 대사가 필요합니다.',
    ],
    [
      '환불 기준',
      '기존 화면은 순매출에서 결제 서비스 환불을 추가 차감하므로 취소와 중복 차감될 수 있습니다.',
    ],
    ['외부 채널', '임시 취합 자료는 포함하지 않습니다.'],
  ]);
  summarySheet['!cols'] = [{ wch: 38 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(book, summarySheet, '화면 실적 대사');
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(rows),
    '일별 실적 근거'
  );
}
