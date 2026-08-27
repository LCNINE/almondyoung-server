import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProductIndexService } from './product-index.service';
import { OpenSearchService } from './opensearch.service';
import { EmbeddingService } from './embedding.service';

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
      ],
    }).compile();
    return { service: module.get(ProductIndexService), client };
  }

  it('임베딩이 꺼져 있으면 키워드 순서를 그대로 쓴다', async () => {
    const { service } = await buildService(makeEmbeddingService(), [hit('a'), hit('b')], []);

    const result = await service.searchProducts({ q: '펌지', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.items.map((item) => item.productId)).toEqual(['a', 'b']);
  });

  it('양쪽에서 걸린 상품이 한쪽에서만 1위인 상품보다 위로 온다', async () => {
    // 키워드 [a, b, c] / 벡터 [c, b] →
    //   b = 1/62 + 1/62 = 0.03226  (양쪽에서 2위)
    //   c = 1/63 + 1/61 = 0.03227  (키워드 3위 + 벡터 1위)
    //   a = 1/61          = 0.01639 (키워드 1위뿐)
    // a 가 키워드 1위여도 양쪽에 걸린 b·c 에게 밀린다.
    const { service } = await buildService(
      makeEmbeddingService([0.1, 0.2]),
      [hit('a'), hit('b'), hit('c')],
      [hit('c'), hit('b')],
    );

    const result = await service.searchProducts({ q: '펌지', sort: 'relevance', page: 1, size: 20 } as any);

    expect(result.items.map((item) => item.productId)).toEqual(['c', 'b', 'a']);
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

  it('벡터 검색이 실패해도 키워드 결과로 계속 간다', async () => {
    const embedding = { enabled: true, embedQuery: jest.fn().mockRejectedValue(new Error('openai down')) };
    const { service } = await buildService(embedding, [hit('a'), hit('b')], []);

    await expect(
      service.searchProducts({ q: '펌지', sort: 'relevance', page: 1, size: 20 } as any),
    ).resolves.toMatchObject({ items: [{ productId: 'a' }, { productId: 'b' }] });
  });
});
