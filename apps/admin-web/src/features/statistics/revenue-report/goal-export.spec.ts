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
  expect(rows).toContainEqual([
    '과거 수기 포함 집계(원) · 현재 회사 목표와 별도',
    340,
  ]);
  expect(rows).toContainEqual(['검산 차이', 0]);
  expect(rows).toContainEqual(['목표 등록 메모', '과거 자료 확인 필요']);
  expect(
    XLSX.utils.sheet_to_json(decoded.Sheets['일별 실적 근거'])
  ).toHaveLength(2);
});

import { appendCompanyRevenueEvidence } from './company-revenue-export';

it('exports the same company total and monthly channel amounts without the legacy opening balance', () => {
  const source = fixture('own_mall');
  const summary = {
    ...source,
    channels: ['medusa'],
    ytdDaily: source.ytdDaily.map((day) => ({
      ...day,
      allChannels: day.ownMall,
    })),
  };
  const book = XLSX.utils.book_new();
  appendCompanyRevenueEvidence(
    XLSX,
    book,
    summary,
    new Map([['2026-01-02', 10]]),
    [
      {
        channel: 'naver',
        account: 'sample',
        month: '2026-01',
        basis: 'purchase_confirmed',
        amount: 100,
        source: 'fixture',
      },
    ]
  );
  const decoded = XLSX.read(
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
    { type: 'buffer' }
  );
  const totals = XLSX.utils.sheet_to_json<unknown[]>(
    decoded.Sheets['통합 목표'],
    { header: 1 }
  );
  expect(totals).toContainEqual(['회사 전체 매출 · 잠정', 390]);
  expect(totals).toContainEqual(['합산 제외 · 근거 미확인 수기 누적액', 50]);
  expect(XLSX.utils.sheet_to_json(decoded.Sheets['월별 채널 매출'])).toEqual([
    {
      월: '2026-01',
      전체: 390,
      자사몰: 290,
      스마트스토어: 100,
      쿠팡: 0,
      전화주문: 0,
      기타채널: 0,
    },
  ]);
});
