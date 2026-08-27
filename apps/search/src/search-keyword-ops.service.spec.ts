import { BadRequestException } from '@nestjs/common';
import { SearchKeywordOpsService } from './search-keyword-ops.service';
import { KeywordActivity, SearchKeywordRepository, ZeroHitKeywordAggRow } from './search-keyword.repository';
import { KeywordIssueRepository } from './keyword-issue.repository';
import { ProductIndexService } from './product-index.service';
import { SearchKeywordIssue } from './db/schema';

function buildRepository(overrides: Partial<SearchKeywordRepository> = {}): SearchKeywordRepository {
  return {
    record: jest.fn(),
    getTrendingKeywords: jest.fn(),
    getSuggestions: jest.fn(),
    getRelatedKeywords: jest.fn(),
    getKeywordStatistics: jest.fn(),
    getKeywordCounts: jest.fn().mockResolvedValue(new Map()),
    getZeroHitKeywords: jest.fn().mockResolvedValue([]),
    getKeywordActivity: jest.fn().mockResolvedValue(new Map()),
    getKeywordDetail: jest.fn(),
    ...overrides,
  };
}

function buildIssueRepository(rows: SearchKeywordIssue[] = []): KeywordIssueRepository {
  return {
    findByNorms: jest.fn().mockResolvedValue(new Map(rows.map((row) => [row.keywordNorm, row]))),
    upsert: jest.fn(),
  } as unknown as KeywordIssueRepository;
}

type EvidenceStub = { exactCount: number; exactNames: string[]; similarNames: string[] };

function buildProductIndex(evidence: Record<string, Partial<EvidenceStub>> = {}): ProductIndexService {
  return {
    getKeywordMatchEvidence: jest.fn().mockImplementation((keywords: string[]) =>
      Promise.resolve(
        new Map(
          keywords.map((keyword) => [
            keyword,
            { exactCount: 0, exactNames: [], similarNames: [], ...evidence[keyword] },
          ]),
        ),
      ),
    ),
  } as unknown as ProductIndexService;
}

const zeroRow = (norm: string, zeroCount: number, lastSearchedAt: string): ZeroHitKeywordAggRow => ({
  keyword: norm,
  keywordNorm: norm,
  zeroCount,
  lastSearchedAt,
});

describe('SearchKeywordOpsService.getZeroHitKeywords', () => {
  beforeEach(() => {
    // KST 2026-08-27 (UTC 2026-08-27T03:00Z)
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T03:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('방치 일수를 마지막 결과일(없으면 최초 0건일) 기준으로 계산하고 최장 방치 순으로 정렬한다', async () => {
    const activity = new Map<string, KeywordActivity>([
      // 10일 전 마지막 결과 → 방치 10일
      ['a', { lastPositiveAt: '2026-08-17T01:00:00Z', firstZeroAt: '2026-08-18T01:00:00Z', lastZeroAt: '2026-08-26T01:00:00Z' }],
      // 결과가 있었던 적 없음 — 최초 0건 3일 전 → 방치 3일
      ['b', { lastPositiveAt: null, firstZeroAt: '2026-08-24T01:00:00Z', lastZeroAt: '2026-08-26T01:00:00Z' }],
      // 0건 이후 결과가 다시 나옴 → 자동 해소
      ['c', { lastPositiveAt: '2026-08-26T05:00:00Z', firstZeroAt: '2026-08-01T01:00:00Z', lastZeroAt: '2026-08-20T01:00:00Z' }],
    ]);
    const repository = buildRepository({
      getZeroHitKeywords: jest.fn().mockResolvedValue([
        zeroRow('b', 9, '2026-08-26T01:00:00Z'),
        zeroRow('a', 5, '2026-08-26T01:00:00Z'),
        zeroRow('c', 2, '2026-08-20T01:00:00Z'),
      ]),
      getKeywordActivity: jest.fn().mockResolvedValue(activity),
    });
    const service = new SearchKeywordOpsService(repository, buildIssueRepository(), buildProductIndex());

    const result = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);

    expect(result.items.map((item) => item.keywordNorm)).toEqual(['a', 'b', 'c']);
    expect(result.items[0].neglectDays).toBe(10);
    expect(result.items[1].neglectDays).toBe(3);
    expect(result.items[2].resolvedByIndex).toBe(true);
    expect(result.items[2].neglectDays).toBe(0);
    // 경보 요약은 자동 해소를 제외한다
    expect(result.summary).toEqual({ zeroKeywordCount: 2, neglectedOver7Days: 1, maxNeglectDays: 10 });
    expect(result.totalItems).toBe(3);
  });

  it('페이지 밖 행은 분류·이슈 조회를 하지 않는다', async () => {
    const rows = [zeroRow('a', 5, '2026-08-26T01:00:00Z'), zeroRow('b', 4, '2026-08-26T01:00:00Z')];
    const repository = buildRepository({
      getZeroHitKeywords: jest.fn().mockResolvedValue(rows),
      getKeywordActivity: jest.fn().mockResolvedValue(
        new Map<string, KeywordActivity>([
          ['a', { lastPositiveAt: null, firstZeroAt: '2026-08-20T01:00:00Z', lastZeroAt: '2026-08-26T01:00:00Z' }],
          ['b', { lastPositiveAt: null, firstZeroAt: '2026-08-25T01:00:00Z', lastZeroAt: '2026-08-26T01:00:00Z' }],
        ]),
      ),
    });
    const issueRepository = buildIssueRepository();
    const productIndex = buildProductIndex();
    const service = new SearchKeywordOpsService(repository, issueRepository, productIndex);

    const result = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 2, 1);

    expect(result.items.map((item) => item.keywordNorm)).toEqual(['b']);
    expect(result.totalItems).toBe(2);
    expect(issueRepository.findByNorms).toHaveBeenCalledWith(['b']);
    expect(productIndex.getKeywordMatchEvidence).toHaveBeenCalledWith(['b']);
  });

  it('색인 대조는 판정 없이 근거만 싣는다 — 정확 일치 수·이름과 유사 상품명', async () => {
    const repository = buildRepository({
      getZeroHitKeywords: jest.fn().mockResolvedValue([
        zeroRow('퍼마색소', 5, '2026-08-26T01:00:00Z'),
        zeroRow('로리킹', 3, '2026-08-26T01:00:00Z'),
      ]),
    });
    const service = new SearchKeywordOpsService(
      repository,
      buildIssueRepository(),
      buildProductIndex({
        퍼마색소: { exactCount: 53, exactNames: ['퍼마 색소 30ml'] },
        // 오타 키워드 — 정확 일치는 없지만 자모 유사로 실제 상품명이 잡힌다
        로리킹: { similarNames: ['롤리킹 롤러'] },
      }),
    );

    const result = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);
    const byNorm = new Map(result.items.map((item) => [item.keywordNorm, item]));
    expect(byNorm.get('퍼마색소')).toMatchObject({
      matchedProductsCount: 53,
      matchedProductNames: ['퍼마 색소 30ml'],
      similarProductNames: [],
    });
    expect(byNorm.get('로리킹')).toMatchObject({
      matchedProductsCount: 0,
      similarProductNames: ['롤리킹 롤러'],
    });

    const failingIndex = {
      getKeywordMatchEvidence: jest.fn().mockRejectedValue(new Error('opensearch down')),
    } as unknown as ProductIndexService;
    const degraded = await new SearchKeywordOpsService(repository, buildIssueRepository(), failingIndex).getZeroHitKeywords(
      '2026-08-01',
      '2026-08-27',
      1,
      20,
    );
    // 색인 조회가 죽어도 목록은 나온다 — 근거만 비어 있다
    expect(degraded.items).toHaveLength(2);
    expect(degraded.items.every((item) => item.matchedProductsCount === 0 && item.similarProductNames.length === 0)).toBe(true);
  });

  it('영타 검색어는 교정어의 일치 상품명을 유사 근거로 합친다', async () => {
    const repository = buildRepository({
      getZeroHitKeywords: jest.fn().mockResolvedValue([zeroRow('vjak', 4, '2026-08-26T01:00:00Z')]),
    });
    const service = new SearchKeywordOpsService(
      repository,
      buildIssueRepository(),
      buildProductIndex({ 퍼마: { exactCount: 12, exactNames: ['퍼마 블렌드'] } }),
    );

    const result = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);
    expect(result.items[0]).toMatchObject({
      correctedQuery: '퍼마',
      matchedProductsCount: 0,
      similarProductNames: ['퍼마 블렌드'],
    });
  });
});

describe('SearchKeywordOpsService.getKeywordDetail', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T03:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('검색 이력이 없는 키워드는 0 값으로 정상 응답한다', async () => {
    const repository = buildRepository({
      getKeywordDetail: jest.fn().mockResolvedValue({
        count: 0,
        zeroCount: 0,
        series: [],
        latestKeyword: null,
        lastSearchedAt: null,
      }),
    });
    const service = new SearchKeywordOpsService(repository, buildIssueRepository(), buildProductIndex());

    const result = await service.getKeywordDetail('  없는 키워드 ', '2026-08-01', '2026-08-27');

    expect(result).toMatchObject({
      keyword: '없는 키워드',
      keywordNorm: '없는 키워드',
      count: 0,
      previousCount: 0,
      neglectDays: null,
      issue: null,
    });
    expect(repository.getKeywordDetail).toHaveBeenCalledWith(
      expect.objectContaining({ keywordNorm: '없는 키워드' }),
    );
  });

  it('입력 키워드를 정규화해 조회하고 방치 중이면 지연 일수를 계산한다', async () => {
    const repository = buildRepository({
      getKeywordDetail: jest.fn().mockResolvedValue({
        count: 7,
        zeroCount: 7,
        series: [{ bucket: '2026-08-26', count: 7, zeroCount: 7 }],
        latestKeyword: '경이로운',
        lastSearchedAt: '2026-08-26T01:00:00Z',
      }),
      getKeywordActivity: jest.fn().mockResolvedValue(
        new Map<string, KeywordActivity>([
          ['경이로운', { lastPositiveAt: null, firstZeroAt: '2026-08-17T01:00:00Z', lastZeroAt: '2026-08-26T01:00:00Z' }],
        ]),
      ),
      getKeywordCounts: jest.fn().mockResolvedValue(new Map([['경이로운', 2]])),
    });
    const service = new SearchKeywordOpsService(repository, buildIssueRepository(), buildProductIndex());

    const result = await service.getKeywordDetail('경이로운  ', '2026-08-01', '2026-08-27');

    expect(result.neglectDays).toBe(10);
    expect(result.previousCount).toBe(2);
    expect(repository.getKeywordActivity).toHaveBeenCalledWith({ keywordNorms: ['경이로운'] });
  });

  it('빈 키워드는 400', async () => {
    const service = new SearchKeywordOpsService(buildRepository(), buildIssueRepository(), buildProductIndex());
    await expect(service.getKeywordDetail('   ', '2026-08-01', '2026-08-27')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SearchKeywordOpsService.upsertIssue', () => {
  it('경로 파라미터를 정규화하고 표시 키워드를 정리해 저장한다', async () => {
    const issueRepository = buildIssueRepository();
    (issueRepository.upsert as jest.Mock).mockResolvedValue({
      keywordNorm: '경이로운',
      keyword: '경이로운',
      status: 'md',
      assigneeId: 'admin-1',
      assigneeName: '김엠디',
      memo: '브랜드 이름 — 소싱 후보',
      createdAt: new Date('2026-08-27T00:00:00Z'),
      updatedAt: new Date('2026-08-27T00:00:00Z'),
    } satisfies SearchKeywordIssue);
    const service = new SearchKeywordOpsService(buildRepository(), issueRepository, buildProductIndex());

    const result = await service.upsertIssue('경이로운 ', {
      keyword: ' 경이로운 ',
      status: 'md',
      assigneeId: 'admin-1',
      assigneeName: '김엠디',
      memo: '브랜드 이름 — 소싱 후보',
    });

    expect(issueRepository.upsert).toHaveBeenCalledWith({
      keywordNorm: '경이로운',
      keyword: '경이로운',
      status: 'md',
      assigneeId: 'admin-1',
      assigneeName: '김엠디',
      memo: '브랜드 이름 — 소싱 후보',
    });
    expect(result.status).toBe('md');
    expect(result.updatedAt).toBe('2026-08-27T00:00:00.000Z');
  });

  it('빈 keywordNorm 은 400', async () => {
    const service = new SearchKeywordOpsService(buildRepository(), buildIssueRepository(), buildProductIndex());
    await expect(service.upsertIssue('  ', { keyword: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
