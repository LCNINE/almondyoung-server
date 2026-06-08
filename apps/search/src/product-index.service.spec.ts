import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProductIndexService } from './product-index.service';
import { OpenSearchService } from './opensearch.service';

const MASTER_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeOpenSearchClient(overrides: Partial<{
  exists: any;
  create: any;
  update: any;
  delete: any;
  search: any;
  putMapping: any;
}> = {}) {
  return {
    indices: {
      exists: jest.fn().mockResolvedValue({ body: true }),
      create: jest.fn().mockResolvedValue({}),
      putMapping: jest.fn().mockResolvedValue({}),
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

function makeConfigService(reviewScoreWeight?: string) {
  return {
    get: jest.fn((key: string) => (key === 'REVIEW_SCORE_WEIGHT' ? reviewScoreWeight : undefined)),
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
      body: { doc: reviewStats },
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
      description: null,
      thumbnail: null,
      brand: null,
      category_ids: [],
      category_names: [],
      tags: [],
      min_base_price: null,
      max_base_price: null,
      min_membership_price: null,
      max_membership_price: null,
      status: 'active',
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
      ],
    }).compile();
    service = module.get(ProductIndexService);
  });

  it('no keyword: sorts by bayesian_review_score desc → review_count desc → updated_at desc', async () => {
    await service.searchProducts({ sort: 'review', page: 1, size: 20 } as any);

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          sort: [
            { bayesian_review_score: { order: 'desc', missing: 0 } },
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
        { bayesian_review_score: { order: 'desc', missing: 0 } },
        { review_count: { order: 'desc', missing: 0 } },
        { updated_at: { order: 'desc' } },
      ]);
    }
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
