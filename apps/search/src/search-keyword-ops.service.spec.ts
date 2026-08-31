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
    expect(result.summary).toMatchObject({
      zeroKeywordCount: 2,
      neglectedOver7Days: 1,
      openNeglectedOver7Days: 1,
      maxNeglectDays: 10,
    });
    expect(result.summary.resolvedByIndexCount).toBe(1);
    expect(result.summary.neglectBuckets).toEqual({ under7: 1, from7to13: 1, from14to29: 0, over30: 0 });
    expect(result.totalItems).toBe(3);
  });

  it('색인 대조는 페이지 안의 행만 한다 — 이슈는 상태 집계 때문에 전량 읽는다', async () => {
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
    // 색인 대조는 키워드마다 OpenSearch 를 때리므로 페이지 안으로 제한된 채여야 한다
    expect(productIndex.getKeywordMatchEvidence).toHaveBeenCalledWith(['b']);
    // 상태별 집계·필터의 모수가 전체라서 이슈는 전량 조회한다 (한 번의 inArray)
    expect(issueRepository.findByNorms).toHaveBeenCalledWith(['a', 'b']);
    expect(issueRepository.findByNorms).toHaveBeenCalledTimes(1);
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

  describe('상태 필터와 상태별 집계', () => {
    const issue = (keywordNorm: string, status: SearchKeywordIssue['status'], assigneeId: string | null = null) =>
      ({
        keywordNorm,
        keyword: keywordNorm,
        status,
        assigneeId,
        assigneeName: assigneeId ? '담당자' : null,
        memo: null,
        updatedAt: new Date('2026-08-26T00:00:00Z'),
      }) as SearchKeywordIssue;

    /** a=신규(미지정) · b=MD팀(담당 있음) · c=해소 · d=자동 해소 */
    function buildService(issues: SearchKeywordIssue[]) {
      const repository = buildRepository({
        getZeroHitKeywords: jest.fn().mockResolvedValue([
          zeroRow('a', 9, '2026-08-26T01:00:00Z'),
          zeroRow('b', 8, '2026-08-26T01:00:00Z'),
          zeroRow('c', 7, '2026-08-26T01:00:00Z'),
          zeroRow('d', 6, '2026-08-26T01:00:00Z'),
        ]),
        getKeywordActivity: jest.fn().mockResolvedValue(
          new Map<string, KeywordActivity>([
            ['a', { lastPositiveAt: null, firstZeroAt: '2026-08-05T01:00:00Z', lastZeroAt: '2026-08-26T01:00:00Z' }],
            ['b', { lastPositiveAt: null, firstZeroAt: '2026-08-20T01:00:00Z', lastZeroAt: '2026-08-26T01:00:00Z' }],
            ['c', { lastPositiveAt: null, firstZeroAt: '2026-08-25T01:00:00Z', lastZeroAt: '2026-08-26T01:00:00Z' }],
            // 0건 이후 결과가 다시 나옴 → 자동 해소
            ['d', { lastPositiveAt: '2026-08-26T05:00:00Z', firstZeroAt: '2026-08-01T01:00:00Z', lastZeroAt: '2026-08-20T01:00:00Z' }],
          ]),
        ),
      });
      return new SearchKeywordOpsService(repository, buildIssueRepository(issues), buildProductIndex());
    }

    it('이슈 행이 없는 키워드는 신규로 세고, 담당자 미지정 수를 따로 센다', async () => {
      const service = buildService([issue('b', 'md', 'user-1'), issue('c', 'resolved')]);

      const result = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);

      // 자동 해소된 d 는 상태 집계 모수에서 빠진다
      expect(result.summary.byStatus).toEqual({ new: 1, dev: 0, md: 1, in_progress: 0, resolved: 1, ignored: 0 });
      expect(result.summary.unassignedCount).toBe(2);
      expect(result.summary.resolvedByIndexCount).toBe(1);
      expect(result.summary.byAssignee).toEqual([{ assigneeId: 'user-1', assigneeName: '담당자', count: 1 }]);
    });

    // "오늘의 할 일" 칩이 이 값을 쓴다 — 사람이 닫은 건 표에 안 뜨는데 칩에만 남으면 안 된다.
    it('사람이 해소·무시로 닫은 검색어는 열린 방치 수에서 빠진다', async () => {
      // a 는 22일 방치(신규), c 는 2일 방치라 7일 문턱을 넘지 않는다.
      // a 를 해소로 닫으면 열린 방치는 0 이 되지만 전체 방치 수는 그대로다.
      const service = buildService([issue('a', 'resolved')]);

      const result = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);

      expect(result.summary.neglectedOver7Days).toBe(2);
      expect(result.summary.openNeglectedOver7Days).toBe(1);
    });

    it("status='open' 은 해소·무시와 자동 해소를 뺀 목록만 준다", async () => {
      const service = buildService([issue('b', 'md', 'user-1'), issue('c', 'resolved')]);

      const result = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20, 'open');

      expect(result.items.map((item) => item.keywordNorm)).toEqual(['a', 'b']);
      expect(result.totalItems).toBe(2);
    });

    it('상태 필터를 걸어도 요약은 기간 전체 기준을 유지한다', async () => {
      const service = buildService([issue('b', 'md', 'user-1'), issue('c', 'resolved')]);

      const filtered = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20, 'md');
      const unfiltered = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);

      expect(filtered.items.map((item) => item.keywordNorm)).toEqual(['b']);
      expect(filtered.totalItems).toBe(1);
      // 종합 대시보드 경보 피드가 이 요약을 그대로 쓴다 — 화면 필터에 흔들리면 안 된다
      expect(filtered.summary).toEqual(unfiltered.summary);
    });

    it('방치 일수를 구간별로 나눠 센다', async () => {
      const service = buildService([]);

      const result = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);

      // a=22일 · b=7일 · c=2일 (d 는 자동 해소라 제외)
      expect(result.summary.neglectBuckets).toEqual({ under7: 1, from7to13: 1, from14to29: 1, over30: 0 });
    });
  });

  describe('같은 기간의 집계 재사용', () => {
    /** 집계 호출 횟수를 세는 저장소 — 페이지를 넘길 때마다 다시 집계하던 비용을 고정한다. */
    function buildCountingService(issues: SearchKeywordIssue[] = []) {
      const getZeroHitKeywords = jest
        .fn()
        .mockResolvedValue([zeroRow('a', 9, '2026-08-26T01:00:00Z'), zeroRow('b', 8, '2026-08-26T01:00:00Z')]);
      const getKeywordActivity = jest.fn().mockResolvedValue(new Map<string, KeywordActivity>());
      const issueRepository = buildIssueRepository(issues);
      const service = new SearchKeywordOpsService(
        buildRepository({ getZeroHitKeywords, getKeywordActivity }),
        issueRepository,
        buildProductIndex(),
      );
      return { service, getZeroHitKeywords, getKeywordActivity, issueRepository };
    }

    it('같은 기간이면 페이지를 넘겨도 집계를 다시 하지 않는다', async () => {
      const { service, getZeroHitKeywords, getKeywordActivity } = buildCountingService();

      await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 1);
      await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 2, 1);
      await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 1, 'open');

      expect(getZeroHitKeywords).toHaveBeenCalledTimes(1);
      expect(getKeywordActivity).toHaveBeenCalledTimes(1);
    });

    it('기간이 다르면 따로 집계한다', async () => {
      const { service, getZeroHitKeywords } = buildCountingService();

      await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);
      await service.getZeroHitKeywords('2026-08-02', '2026-08-27', 1, 20);

      expect(getZeroHitKeywords).toHaveBeenCalledTimes(2);
    });

    // 담당자·메모·처리 상태는 운영자가 방금 저장한 값이다. 집계와 같이 캐시하면
    // 저장했는데 화면이 안 바뀌는, 느린 것보다 나쁜 버그가 된다.
    it('운영 상태는 재사용하지 않고 매번 다시 읽는다', async () => {
      const { service, issueRepository } = buildCountingService();

      await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);
      const stored = {
        keywordNorm: 'a',
        keyword: 'a',
        status: 'md',
        assigneeId: 'user-1',
        assigneeName: '담당자',
        memo: '소싱 검토',
        updatedAt: new Date('2026-08-27T00:00:00Z'),
      } as SearchKeywordIssue;
      (issueRepository.findByNorms as jest.Mock).mockResolvedValue(new Map([['a', stored]]));

      const after = await service.getZeroHitKeywords('2026-08-01', '2026-08-27', 1, 20);

      expect(after.items[0].issue).toMatchObject({ status: 'md', assigneeId: 'user-1', memo: '소싱 검토' });
      expect(after.summary.byStatus.md).toBe(1);
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
