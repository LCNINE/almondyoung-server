import type { GrowthSummary } from '@/lib/api/domains/analytics';
import * as XLSX from 'xlsx';
import { appendGoalEvidence, goalExportRows } from './goal-export';

function fixture(scope: 'own_mall' | 'all_channels'): GrowthSummary {
  return {
    today: '2026-01-03',
    year: 2026,
    coverageStart: '2026-01-01',
    goal: {
      scope,
      annualTarget: 12000,
      monthlyTargets: Array(12).fill(1000),
      preCoverageActual: 50,
    },
    ytdDaily: [
      { date: '2026-01-01', ownMall: 100, allChannels: 130 },
      { date: '2026-01-02', ownMall: 200, allChannels: 250 },
      { date: '2026-01-03', ownMall: 999, allChannels: 999 },
    ],
  } as GrowthSummary;
}

describe('화면 목표 실적 엑셀 대사', () => {
  it.each([
    ['own_mall', 340],
    ['all_channels', 420],
  ] as const)(
    '%s 범위, 환불, 과거 입력값, 어제 마감을 동일하게 반영한다',
    (scope, expected) => {
      const result = goalExportRows(
        fixture(scope),
        new Map([['2026-01-02', 10]])
      );
      expect(result.pacing.actualToDate).toBe(expected);
      expect(result.rows).toHaveLength(2);
      expect(
        result.rows.reduce((sum, r) => sum + r.목표반영액, 0) +
          result.preCoverageActual
      ).toBe(expected);
    }
  );

  it('환불 조회 실패를 실제 0원과 구분한다', () => {
    const result = goalExportRows(fixture('own_mall'), null);
    expect(result.rows[0].별도결제환불).toBeNull();
    expect(result.pacing.refundDeducted).toBe(false);
  });
});

it('엑셀 파일에 화면 합계와 관리자 입력 메모를 보존한다', () => {
  const summary = fixture('own_mall');
  summary.goal!.memo = '과거 자료 확인 필요';
  const book = XLSX.utils.book_new();
  appendGoalEvidence(XLSX, book, summary, new Map([['2026-01-02', 10]]));
  const file = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const decoded = XLSX.read(file, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(
    decoded.Sheets['화면 실적 대사'],
    { header: 1 }
  );
  expect(rows).toContainEqual(['화면 목표 실적(원)', 340]);
  expect(rows).toContainEqual(['검산 차이', 0]);
  expect(rows).toContainEqual(['목표 등록 메모', '과거 자료 확인 필요']);
  expect(
    XLSX.utils.sheet_to_json(decoded.Sheets['일별 실적 근거'])
  ).toHaveLength(2);
});
