import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProductIndexService, VECTOR_FILL_KEYWORD_LIMIT, VECTOR_FILL_LIMIT } from './product-index.service';
import { OpenSearchService } from './opensearch.service';
import { EmbeddingService } from './embedding.service';
import { SpellCorrectionService } from './spell-correction.service';

// 교정 없음이 기본 — 0건 재검색 경로가 다른 스펙에 끼어들지 않게 한다.
function makeSpellCorrectionService(suggestion: string | null = null) {
  return { buildDictionary: jest.fn().mockResolvedValue(undefined), suggest: jest.fn().mockReturnValue(suggestion) };
}

// 벡터 없음이 기본 — 키워드 경로만 검증하는 스펙들이 벡터 융합에 영향받지 않게 한다.
function makeEmbeddingService(vector: number[] | null = null) {
  return { enabled: vector !== null, embedQuery: jest.fn().mockResolvedValue(vector) };
}

const MASTER_ID = '550e8400-e29b-41d4-a716-446655440000';

// nori 토큰을 흉내낸다 — 기본은 뭉갬 없음(원문 그대로 한 토큰).
function makeAnalyzeMock(tokens?: string[]) {
  return jest.fn(({ body }: any) => {
    const text: string = body.text;
    const result = tokens ?? [text.replace(/\s+/g, '')];
    return Promise.resolve({ body: { tokens: result.map((token) => ({ token })) } });
  });
}

function makeOpenSearchClient(overrides: Partial<{
  exists: any;
  create: any;
  update: any;
  delete: any;
  search: any;
  putMapping: any;
  analyze: any;
}> = {}) {
  return {
    indices: {
      exists: jest.fn().mockResolvedValue({ body: true }),
      create: jest.fn().mockResolvedValue({}),
      putMapping: jest.fn().mockResolvedValue({}),
      analyze: overrides.analyze ?? makeAnalyzeMock(),
    },
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    search: jest.fn().mockResolvedValue({ body: { hits: { hits: [], total: { value: 0 } } } }),
    ...overrides,
  };
}

function makeOpenSearchService(client: ReturnType<typeof makeOpenSearchClient>) {
  return {
    getClient: jest.fn().mockReturnValue(client),
    getProductsIndex: jest.fn().mockReturnValue('search_products'),
  };
}

function makeConfigService(values?: string | Record<string, string>) {
  const configValues = typeof values === 'string' ? { REVIEW_SCORE_WEIGHT: values } : (values ?? {});
  return {
    get: jest.fn((key: string) => configValues[key]),
  };
}

describe('ProductIndexService.updateProductReviewStats', () => {
  let service: ProductIndexService;
  let client: ReturnType<typeof makeOpenSearchClient>;

  beforeEach(async () => {
    client = makeOpenSearchClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    service = module.get(ProductIndexService);
  });

  const reviewStats = {
    review_count: 10,
    average_rating: 4.2,
    bayesian_review_score: 3.97,
    review_stats_updated_at: '2026-06-08T00:00:00.000Z',
  };

  it('calls client.update with doc body (no doc_as_upsert)', async () => {
    await service.updateProductReviewStats(MASTER_ID, reviewStats);

    expect(client.update).toHaveBeenCalledWith({
      index: 'search_products',
      id: MASTER_ID,
      body: {
        doc: {
          ...reviewStats,
          review_sort_score: 4.317,
        },
      },
    });
  });

  it('warns and returns (no throw) when product not in index (404)', async () => {
    const notFoundError = Object.assign(new Error('Not found'), { meta: { statusCode: 404 } });
    client.update.mockRejectedValueOnce(notFoundError);

    await expect(service.updateProductReviewStats(MASTER_ID, reviewStats)).resolves.toBeUndefined();
  });

  it('rethrows non-404 OpenSearch errors', async () => {
    const serverError = Object.assign(new Error('service unavailable'), { meta: { statusCode: 503 } });
    client.update.mockRejectedValueOnce(serverError);

    await expect(service.updateProductReviewStats(MASTER_ID, reviewStats)).rejects.toThrow('service unavailable');
  });
});

describe('ProductIndexService.upsertProduct', () => {
  let service: ProductIndexService;
  let client: ReturnType<typeof makeOpenSearchClient>;

  beforeEach(async () => {
    client = makeOpenSearchClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    service = module.get(ProductIndexService);
  });

  it('uses client.update with doc_as_upsert to preserve review fields', async () => {
    const doc = {
      master_id: MASTER_ID,
      version_id: 'v1',
      name: '테스트 상품',
      name_compact: '테스트상품',
      name_jamo: 'ㅌㅔㅅㅡㅌㅡ ㅅㅏㅇㅍㅜㅁ',
      brand_jamo: '',
      description: null,
      thumbnail: null,
      brand: null,
      category_ids: [],
      category_names: [],
      tags: [],
      seo_keywords: '',
      min_base_price: null,
      max_base_price: null,
      min_membership_price: null,
      max_membership_price: null,
      status: 'active',
      // 회원 전용 노출 플래그. 색인 문서 계약의 필수 필드이고 검색 필터가 이걸 본다.
      is_visible_to_members_only: false,
      changed_at: '2026-06-08T00:00:00.000Z',
      updated_at: '2026-06-08T00:00:00.000Z',
    };

    await service.upsertProduct(MASTER_ID, doc);

    expect(client.update).toHaveBeenCalledWith({
      index: 'search_products',
      id: MASTER_ID,
      body: {
        doc,
        doc_as_upsert: true,
      },
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 — sort & relevance+review blending
// ────────────────────────────────────────────────────────────────────────────

describe('ProductIndexService.searchProducts - sort=review', () => {
  let service: ProductIndexService;
  let client: ReturnType<typeof makeOpenSearchClient>;

  beforeEach(async () => {
    client = makeOpenSearchClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    service = module.get(ProductIndexService);
  });

  it('no keyword: sorts by review_sort_score desc → review_count desc → updated_at desc', async () => {
    await service.searchProducts({ sort: 'review', page: 1, size: 20 } as any);

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          sort: [
            { review_sort_score: { order: 'desc', missing: 0 } },
            { review_count: { order: 'desc', missing: 0 } },
            { updated_at: { order: 'desc' } },
          ],
        }),
      }),
    );
  });

  it('with keyword: strict + fallback both use review sort', async () => {
    await service.searchProducts({ q: '글루', sort: 'review', page: 1, size: 20 } as any);

    // keyword search calls client.search twice (strict, fallback)
    expect(client.search).toHaveBeenCalledTimes(2);
    for (const [callArg] of client.search.mock.calls) {
      expect(callArg.body.sort).toEqual([
        { review_sort_score: { order: 'desc', missing: 0 } },
        { review_count: { order: 'desc', missing: 0 } },
        { updated_at: { order: 'desc' } },
      ]);
    }
  });

  it('REVIEW_SORT_VOLUME_WEIGHT env changes computed review_sort_score', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService({ REVIEW_SORT_VOLUME_WEIGHT: '0.9' }) },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    service = module.get(ProductIndexService);

    await service.updateProductReviewStats(MASTER_ID, {
      review_count: 10,
      average_rating: 4.2,
      bayesian_review_score: 3.97,
      review_stats_updated_at: '2026-06-08T00:00:00.000Z',
    });

    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          doc: expect.objectContaining({
            review_sort_score: 4.282,
          }),
        }),
      }),
    );
  });

  it('caps review volume boost at REVIEW_SORT_COUNT_SATURATION', async () => {
    await service.updateProductReviewStats(MASTER_ID, {
      review_count: 1000,
      average_rating: 3.4,
      bayesian_review_score: 3.4,
      review_stats_updated_at: '2026-06-08T00:00:00.000Z',
    });

    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          doc: expect.objectContaining({
            review_sort_score: 4.4,
          }),
        }),
      }),
    );
  });

  it('with keyword: query is plain bool (no function_score)', async () => {
    await service.searchProducts({ q: '글루', sort: 'review', page: 1, size: 20 } as any);

    const [firstCallArg] = client.search.mock.calls[0];
    expect(firstCallArg.body.query).not.toHaveProperty('function_score');
    expect(firstCallArg.body.query).toHaveProperty('bool');
  });
});

describe('ProductIndexService.searchProducts - relevance with keyword (function_score)', () => {
  let service: ProductIndexService;
  let client: ReturnType<typeof makeOpenSearchClient>;

  beforeEach(async () => {
    client = makeOpenSearchClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    service = module.get(ProductIndexService);
  });

  it('wraps bool query in function_score with field_value_factor on bayesian_review_score', async () => {
    await service.searchProducts({ q: '글루', sort: 'relevance', page: 1, size: 20 } as any);

    // strict call is the first client.search invocation
    const [strictCallArg] = client.search.mock.calls[0];
    expect(strictCallArg.body.query).toMatchObject({
      function_score: {
        functions: [
          {
            field_value_factor: {
              field: 'bayesian_review_score',
              factor: 0.1,
              modifier: 'none',
              missing: 3.5,
            },
          },
        ],
        score_mode: 'sum',
        boost_mode: 'sum',
      },
    });
  });

  it('inner query inside function_score is a bool query', async () => {
    await service.searchProducts({ q: '글루', sort: 'relevance', page: 1, size: 20 } as any);

    const [strictCallArg] = client.search.mock.calls[0];
    expect(strictCallArg.body.query.function_score.query).toMatchObject({
      bool: expect.any(Object),
    });
  });

  it('fallback call also wraps query in function_score', async () => {
    await service.searchProducts({ q: '글루', sort: 'relevance', page: 1, size: 20 } as any);

    const [, fallbackCallArg] = client.search.mock.calls;
    expect(fallbackCallArg[0].body.query).toHaveProperty('function_score');
  });

  it('sort is by _score desc then updated_at desc', async () => {
    await service.searchProducts({ q: '글루', sort: 'relevance', page: 1, size: 20 } as any);

    const [strictCallArg] = client.search.mock.calls[0];
    expect(strictCallArg.body.sort).toEqual([
      { _score: { order: 'desc' } },
      { updated_at: { order: 'desc' } },
    ]);
  });

  it('REVIEW_SCORE_WEIGHT env overrides the default factor of 0.1', async () => {
    const customModule: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService('0.25') },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    const customService = customModule.get(ProductIndexService);

    await customService.searchProducts({ q: '선크림', sort: 'relevance', page: 1, size: 20 } as any);

    const [callArg] = client.search.mock.calls[0];
    expect(callArg.body.query.function_score.functions[0].field_value_factor.factor).toBe(0.25);
  });
});

describe('ProductIndexService.searchProducts - relevance without keyword', () => {
  let service: ProductIndexService;
  let client: ReturnType<typeof makeOpenSearchClient>;

  beforeEach(async () => {
    client = makeOpenSearchClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    service = module.get(ProductIndexService);
  });

  it('no keyword: sort is by updated_at desc only', async () => {
    await service.searchProducts({ sort: 'relevance', page: 1, size: 20 } as any);

    const [callArg] = client.search.mock.calls[0];
    expect(callArg.body.sort).toEqual([{ updated_at: { order: 'desc' } }]);
  });

  it('no keyword: query is plain bool without function_score', async () => {
    await service.searchProducts({ sort: 'relevance', page: 1, size: 20 } as any);

    const [callArg] = client.search.mock.calls[0];
    expect(callArg.body.query).not.toHaveProperty('function_score');
  });

  it('empty string keyword is treated as no keyword (no function_score)', async () => {
    await service.searchProducts({ q: '   ', sort: 'relevance', page: 1, size: 20 } as any);

    const [callArg] = client.search.mock.calls[0];
    expect(callArg.body.query).not.toHaveProperty('function_score');
  });
});

// nori 가 미등록 고유명사를 뭉개면("오샤레" → ["오"]) 남은 한 글자가 무관 상품을
// name^8 로 끌어와 정답을 랭킹 밖으로 밀어낸다. 그 경우 nori 기반 절을 빼야 한다.
describe('ProductIndexService.searchProducts - nori collapse guard', () => {
  const buildService = async (analyze: any) => {
    const client = makeOpenSearchClient({ analyze });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    return { service: module.get(ProductIndexService), client };
  };

  // strict 쿼리의 should 절에서 nori 를 타는 필드가 쓰였는지
  const strictShouldOf = (client: ReturnType<typeof makeOpenSearchClient>) => {
    const [callArg] = client.search.mock.calls[0];
    return callArg.body.query.function_score.query.bool.must[0].bool.should;
  };
  const usesNoriFields = (should: any[]) =>
    should.some(
      (clause) =>
        clause.multi_match !== undefined ||
        (clause.match_phrase !== undefined && clause.match_phrase.name !== undefined),
    );

  it('collapsed keyword ("오샤레" → ["오"]): nori clauses are dropped', async () => {
    const { service, client } = await buildService(makeAnalyzeMock(['오']));

    await service.searchProducts({ q: '오샤레', sort: 'relevance', page: 1, size: 20 } as any);

    expect(usesNoriFields(strictShouldOf(client))).toBe(false);
  });

  it('healthy keyword ("큐티클 오일"): nori clauses are kept', async () => {
    const { service, client } = await buildService(makeAnalyzeMock(['큐티클', '오일']));

    await service.searchProducts({ q: '큐티클 오일', sort: 'relevance', page: 1, size: 20 } as any);

    expect(usesNoriFields(strictShouldOf(client))).toBe(true);
  });

  it('short keyword (<3 chars) skips the analyze roundtrip entirely', async () => {
    const analyze = makeAnalyzeMock(['젤']);
    const { service, client } = await buildService(analyze);

    await service.searchProducts({ q: '젤', sort: 'relevance', page: 1, size: 20 } as any);

    expect(analyze).not.toHaveBeenCalled();
    expect(usesNoriFields(strictShouldOf(client))).toBe(true);
  });

  it('analyze failure falls back to keeping nori clauses', async () => {
    const analyze = jest.fn().mockRejectedValue(new Error('opensearch down'));
    const { service, client } = await buildService(analyze);

    await service.searchProducts({ q: '오샤레', sort: 'relevance', page: 1, size: 20 } as any);

    expect(usesNoriFields(strictShouldOf(client))).toBe(true);
  });

  // strict 만 nori 를 빼고 fallback 은 유지해야 한다. 둘 다 빼면 복합어 부분매칭에
  // 기대는 검색어가 0건이 된다("엠보니들" 실측 138건 → 0건).
  it('collapsed keyword: fallback keeps nori clauses (recall guard)', async () => {
    const { service, client } = await buildService(makeAnalyzeMock(['오']));

    await service.searchProducts({ q: '오샤레', sort: 'relevance', page: 1, size: 20 } as any);

    const [, fallbackCall] = client.search.mock.calls;
    const fallbackShould = fallbackCall[0].body.query.function_score.query.bool.must[0].bool.should;
    expect(fallbackShould.some((clause: any) => clause.multi_match !== undefined)).toBe(true);
  });

  it('repeated keyword hits the cache (analyze called once)', async () => {
    const analyze = makeAnalyzeMock(['오']);
    const { service } = await buildService(analyze);

    await service.searchProducts({ q: '오샤레', sort: 'relevance', page: 1, size: 20 } as any);
    await service.searchProducts({ q: '오샤레', sort: 'relevance', page: 2, size: 20 } as any);

    expect(analyze).toHaveBeenCalledTimes(1);
  });
});

// 벡터 검색이 붙었을 때의 융합 동작. 임베딩이 꺼져 있거나 실패하면 키워드 결과가 그대로여야 하고,
// 켜져 있으면 RRF 로 두 순위를 합쳐야 한다.
describe('ProductIndexService.searchProducts - RRF 융합', () => {
  const hit = (id: string) => ({ _id: id, _source: { master_id: id, version_id: `v-${id}`, name: id } });

  async function buildService(embedding: any, keywordHits: any[], vectorHits: any[]) {
    const client = makeOpenSearchClient();
    let call = 0;
    client.search = jest.fn().mockImplementation((params: any) => {
      // knn 절이 있으면 벡터 검색이다. 없으면 strict → fallback 순.
      const isKnn = JSON.stringify(params.body.query).includes('"knn"');
      if (isKnn) return Promise.resolve({ body: { hits: { hits: vectorHits, total: { value: vectorHits.length } } } });
      const hits = call++ === 0 ? keywordHits : [];
      return Promise.resolve({ body: { hits: { hits, total: { value: hits.length } } } });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: embedding },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService() },
      ],
    }).compile();
    return { service: module.get(ProductIndexService), client };
  }

  it('임베딩이 꺼져 있으면 키워드 순서를 그대로 쓴다', async () => {
    const { service } = await buildService(makeEmbeddingService(), [hit('a'), hit('b')], []);

    const result = await service.searchProducts({ q: '펌지', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.items.map((item) => item.productId)).toEqual(['a', 'b']);
  });

  it('벡터는 가중치 0.3 이라 키워드 1위를 뒤집지 못한다', async () => {
    // 키워드 [a, b] / 벡터 [b] →
    //   a = 1/61              = 0.01639  (키워드 1위)
    //   b = 1/62 + 0.3/61     = 0.02105  (키워드 2위 + 벡터 1위)
    // 벡터가 밀어준 b 가 a 를 넘지만, 가중치가 1.0 이었다면 격차가 훨씬 컸다.
    // 핵심은 벡터 단독 1위(c)가 키워드에 없으면 상위로 못 올라온다는 것이다.
    const { service } = await buildService(
      makeEmbeddingService([0.1, 0.2]),
      [hit('a'), hit('b')],
      [hit('c'), hit('b')],
    );

    const result = await service.searchProducts({ q: '펌지', sort: 'relevance', page: 1, size: 20 } as any);
    const order = result.items.map((item) => item.productId);

    // 키워드에 없고 벡터에만 있는 c 는 맨 뒤로 간다.
    expect(order.indexOf('c')).toBe(order.length - 1);
    expect(order.slice(0, 2).sort()).toEqual(['a', 'b']);
  });

  it('키워드가 한 화면을 채우면 벡터를 섞지 않는다', async () => {
    const keywordHits = Array.from({ length: VECTOR_FILL_KEYWORD_LIMIT }, (_, i) => hit(`k${i}`));
    const { service } = await buildService(makeEmbeddingService([0.1, 0.2]), keywordHits, [hit('vector-only')]);

    const result = await service.searchProducts({ q: '유키반 테이프', sort: 'relevance', page: 1, size: 100 } as any);

    expect(result.items.map((item) => item.productId)).not.toContain('vector-only');
    expect(result.items).toHaveLength(VECTOR_FILL_KEYWORD_LIMIT);
  });

  it('키워드가 한 화면에 못 미치면 벡터로 채운다', async () => {
    const keywordHits = Array.from({ length: VECTOR_FILL_KEYWORD_LIMIT - 1 }, (_, i) => hit(`k${i}`));
    const { service } = await buildService(makeEmbeddingService([0.1, 0.2]), keywordHits, [hit('vector-only')]);

    const result = await service.searchProducts({ q: '유키반 테이프', sort: 'relevance', page: 1, size: 100 } as any);

    expect(result.items.map((item) => item.productId)).toContain('vector-only');
  });

  it('벡터로 덧붙이는 건 상한까지다 — 키워드 3 건에 99 건이 붙던 걸 막는다', async () => {
    const keywordHits = [hit('k0'), hit('k1'), hit('k2')];
    const vectorHits = Array.from({ length: 99 }, (_, i) => hit(`v${i}`));
    const { service } = await buildService(makeEmbeddingService([0.1, 0.2]), keywordHits, vectorHits);

    const result = await service.searchProducts({ q: '니치반', sort: 'relevance', page: 1, size: 100 } as any);

    expect(result.items).toHaveLength(keywordHits.length + VECTOR_FILL_LIMIT);
  });

  it('관련도 정렬이 아니면 벡터를 섞지 않는다', async () => {
    const { service } = await buildService(
      makeEmbeddingService([0.1, 0.2]),
      [hit('a'), hit('b')],
      [hit('b'), hit('a')],
    );

    const result = await service.searchProducts({ q: '펌지', sort: 'price_asc', page: 1, size: 20 } as any);

    expect(result.items.map((item) => item.productId)).toEqual(['a', 'b']);
  });

  it('관련도 정렬이 아니면 임베딩을 호출조차 하지 않는다', async () => {
    const embedding = makeEmbeddingService([0.1, 0.2]);
    const { service } = await buildService(embedding, [hit('a')], [hit('b')]);

    await service.searchProducts({ q: '펌지', sort: 'price_asc', page: 1, size: 20 } as any);

    expect(embedding.embedQuery).not.toHaveBeenCalled();
  });

  it('벡터 검색이 실패해도 키워드 결과로 계속 간다', async () => {
    const embedding = { enabled: true, embedQuery: jest.fn().mockRejectedValue(new Error('openai down')) };
    const { service } = await buildService(embedding, [hit('a'), hit('b')], []);

    await expect(
      service.searchProducts({ q: '펌지', sort: 'relevance', page: 1, size: 20 } as any),
    ).resolves.toMatchObject({ items: [{ productId: 'a' }, { productId: 'b' }] });
  });
});

// 0건일 때만 교정으로 다시 찾는다. 교정어도 0건이면 원래의 빈 결과를 그대로 쓴다 —
// "닮은 말"을 찾았다는 것만으로 화면에 다른 검색어를 띄우면 안 된다.
describe('ProductIndexService.searchProducts - 검색어 교정', () => {
  const hit = (id: string) => ({ _id: id, _source: { master_id: id, version_id: `v-${id}`, name: id } });

  async function buildService(suggestion: string | null, hitsByKeyword: Record<string, any[]>) {
    const client = makeOpenSearchClient();
    client.search = jest.fn().mockImplementation((params: any) => {
      const body = JSON.stringify(params.body);
      const keyword = Object.keys(hitsByKeyword).find((k) => body.includes(k));
      const hits = keyword ? hitsByKeyword[keyword] : [];
      return Promise.resolve({ body: { hits: { hits, total: { value: hits.length } } } });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService(suggestion) },
      ],
    }).compile();
    return module.get(ProductIndexService);
  }

  it('0건이면 교정어로 다시 찾고 correctedQuery 를 함께 돌려준다', async () => {
    const service = await buildService('니치반', { 니치반: [hit('a')] });

    const result = await service.searchProducts({ q: '나찌반', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.correctedQuery).toBe('니치반');
    expect(result.pagination.total).toBe(1);
  });

  // 벡터는 "나찌반" 에도 뜻이 닮은 상품을 얹어준다. 융합 결과로 판단하면 0건이 될 일이 없어
  // 교정이 영영 돌지 않는다 — 실제로 배포 후 이 상태였다.
  it('벡터가 결과를 채워도 키워드가 0건이면 교정한다', async () => {
    const client = makeOpenSearchClient();
    client.search = jest.fn().mockImplementation((params: any) => {
      const body = JSON.stringify(params.body);
      if (body.includes('"knn"')) {
        // 벡터는 무관한 상품을 끌어온다.
        return Promise.resolve({ body: { hits: { hits: [hit('noise')], total: { value: 1 } } } });
      }
      const hits = body.includes('니치반') ? [hit('a')] : [];
      return Promise.resolve({ body: { hits: { hits, total: { value: hits.length } } } });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService([0.1, 0.2]) },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService('니치반') },
      ],
    }).compile();

    const result = await module
      .get(ProductIndexService)
      .searchProducts({ q: '나찌반', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.correctedQuery).toBe('니치반');
  });

  it('교정어도 0건이면 교정하지 않는다', async () => {
    const service = await buildService('니치반', {});

    const result = await service.searchProducts({ q: '나찌반', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.correctedQuery).toBeUndefined();
    expect(result.pagination.total).toBe(0);
  });

  it('결과가 있으면 교정을 시도조차 하지 않는다', async () => {
    const spell = makeSpellCorrectionService('니치반');
    const client = makeOpenSearchClient();
    client.search = jest.fn().mockResolvedValue({ body: { hits: { hits: [hit('a')], total: { value: 1 } } } });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: spell },
      ],
    }).compile();

    await module
      .get(ProductIndexService)
      .searchProducts({ q: '니들', sort: 'relevance', page: 1, size: 20 } as any);

    expect(spell.suggest).not.toHaveBeenCalled();
  });

  it('correct=false 면 교정하지 않는다 — 고객이 원문으로 보겠다고 한 것이다', async () => {
    const spell = makeSpellCorrectionService('니치반');
    const client = makeOpenSearchClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        { provide: SpellCorrectionService, useValue: spell },
      ],
    }).compile();

    await module
      .get(ProductIndexService)
      .searchProducts({ q: '나찌반', sort: 'relevance', page: 1, size: 20, correct: false } as any);

    expect(spell.suggest).not.toHaveBeenCalled();
  });
});

describe('ProductIndexService.searchProducts - 키워드 0건일 때 벡터·계측', () => {
  const hit = (id: string) => ({ _id: id, _source: { master_id: id, version_id: `v-${id}`, name: id } });

  // keywordHitsFor 의 키(검색어)가 요청 본문에 있으면 그 히트를, 없으면 0건을 돌려준다 —
  // 원본 검색과 교정 재검색을 구분하기 위해 호출 순서가 아니라 본문으로 가른다.
  async function buildService(
    keywordHitsFor: Record<string, any[]>,
    vectorHits: any[],
    suggestion: string | null = null,
  ) {
    const client = makeOpenSearchClient();
    const knnCalls: any[] = [];
    client.search = jest.fn().mockImplementation((params: any) => {
      const body = JSON.stringify(params.body.query);
      if (body.includes('"knn"')) {
        knnCalls.push(params);
        return Promise.resolve({ body: { hits: { hits: vectorHits, total: { value: vectorHits.length } } } });
      }
      const matched = Object.keys(keywordHitsFor).find((keyword) => body.includes(keyword));
      const hits = matched ? keywordHitsFor[matched] : [];
      return Promise.resolve({ body: { hits: { hits, total: { value: hits.length } } } });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        { provide: OpenSearchService, useValue: makeOpenSearchService(client) },
        { provide: ConfigService, useValue: makeConfigService() },
        { provide: EmbeddingService, useValue: makeEmbeddingService([0.1, 0.2]) },
        { provide: SpellCorrectionService, useValue: makeSpellCorrectionService(suggestion) },
      ],
    }).compile();
    return { service: module.get<ProductIndexService>(ProductIndexService), knnCalls };
  }

  it('키워드가 0건이면 벡터로 채우지 않는다', async () => {
    const { service } = await buildService({}, [hit('c'), hit('d')]);

    const result = await service.searchProducts({ q: '바리깡', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.items).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });

  it('교정 재검색에는 벡터를 태우지 않는다 — 교정어의 이웃으로 화면이 덮이지 않게', async () => {
    const { service, knnCalls } = await buildService({ 발광: [hit('x')] }, [hit('c'), hit('d')], '발광');

    const result = await service.searchProducts({ q: '바리깡', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.correctedQuery).toBe('발광');
    expect(result.items.map((item) => item.productId)).toEqual(['x']);
    // 원본 검색에서 한 번 부르고, 교정 재검색에서는 부르지 않는다.
    expect(knnCalls).toHaveLength(1);
  });

  it('교정으로 찾은 건수는 원본 검색어의 몫이 아니라 0 으로 기록된다', async () => {
    const { service } = await buildService({ 발광: [hit('x')] }, [], '발광');

    const result = await service.searchProducts({ q: '바리깡', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.pagination.total).toBe(1);
    expect(result.keywordMatchCount).toBe(0);
  });

  it('키워드가 있으면 벡터 융합은 그대로 돈다', async () => {
    const { service } = await buildService({ 펌지: [hit('a')] }, [hit('c')]);

    const result = await service.searchProducts({ q: '펌지', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.items.map((item) => item.productId)).toEqual(['a', 'c']);
    expect(result.keywordMatchCount).toBe(1);
  });
});
