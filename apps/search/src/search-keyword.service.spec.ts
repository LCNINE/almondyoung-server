import { SearchKeywordService, previousRange } from './search-keyword.service';
import { SearchKeywordRepository } from './search-keyword.repository';

describe('previousRange', () => {
  it('직전 동일 길이 기간을 만든다', () => {
    expect(previousRange('2026-08-01', '2026-08-07')).toEqual({ from: '2026-07-25', to: '2026-07-31' });
  });
});

describe('SearchKeywordService.getKeywordStatistics', () => {
  const baseRow = { zeroCount: 0, lastSearchedAt: '2026-08-02T00:00:00.000Z' };

  function build(topRows: Array<{ keywordNorm: string; count: number }>, previousCounts: Map<string, number>) {
    const repository: SearchKeywordRepository = {
      record: jest.fn(),
      getTrendingKeywords: jest.fn(),
      getSuggestions: jest.fn(),
      getRelatedKeywords: jest.fn(),
      getKeywordStatistics: jest.fn().mockResolvedValue({
        totalSearches: 100,
        zeroResultSearches: 10,
        series: [{ bucket: '2026-08-01', count: 100, zeroCount: 10 }],
        top: topRows.map((row) => ({ ...baseRow, keyword: row.keywordNorm, ...row })),
        zeroTop: [],
      }),
      getKeywordCounts: jest.fn().mockResolvedValue(previousCounts),
    };
    return { service: new SearchKeywordService(repository), repository };
  }

  it('KST 자정 경계를 ISO instant 로 변환해 리포지토리에 넘긴다', async () => {
    const { service, repository } = build([], new Map());
    await service.getKeywordStatistics('2026-08-01', '2026-08-02', 20);

    expect(repository.getKeywordStatistics).toHaveBeenCalledWith({
      fromIso: '2026-07-31T15:00:00.000Z',
      toExclusiveIso: '2026-08-02T15:00:00.000Z',
      size: 20,
    });
    // 직전 동일 길이(2일) 기간: 7/30~7/31
    expect(repository.getKeywordCounts).toHaveBeenCalledWith({
      fromIso: '2026-07-29T15:00:00.000Z',
      toExclusiveIso: '2026-07-31T15:00:00.000Z',
      keywordNorms: [],
    });
  });

  it('급상승은 3회 이상 + 증가분만, 신규(직전 0회)가 성장률 최상위로 온다', async () => {
    const { service } = build(
      [
        { keywordNorm: 'a', count: 30 }, // 이전 15 → ×2
        { keywordNorm: 'b', count: 9 }, // 이전 0 → 신규 (무한 성장)
        { keywordNorm: 'c', count: 2 }, // 3회 미만 — 제외
        { keywordNorm: 'd', count: 10 }, // 이전 10 → 증가 없음, 제외
        { keywordNorm: 'e', count: 20 }, // 이전 4 → ×5
      ],
      new Map([
        ['a', 15],
        ['d', 10],
        ['e', 4],
      ]),
    );
    const result = await service.getKeywordStatistics('2026-08-01', '2026-08-07', 20);

    expect(result.rising.map((row) => row.keywordNorm)).toEqual(['b', 'e', 'a']);
    expect(result.rising[0]).toMatchObject({ keywordNorm: 'b', count: 9, previousCount: 0 });
  });

  it('top 은 limit 으로 자르고 previousCount 를 붙인다', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ keywordNorm: `k${i}`, count: 10 - i }));
    const { service } = build(rows, new Map([['k0', 7]]));
    const result = await service.getKeywordStatistics('2026-08-01', '2026-08-07', 3);

    expect(result.top).toHaveLength(3);
    expect(result.top[0]).toMatchObject({ keywordNorm: 'k0', count: 10, previousCount: 7 });
    expect(result.top[1]).toMatchObject({ keywordNorm: 'k1', previousCount: 0 });
    expect(result.range).toEqual({ from: '2026-08-01', to: '2026-08-07' });
    expect(result.previousRange).toEqual({ from: '2026-07-25', to: '2026-07-31' });
  });
});
