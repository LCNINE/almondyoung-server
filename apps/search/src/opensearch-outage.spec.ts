import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenSearchService, PING_TIMEOUT_MS } from './opensearch.service';
import { HealthController } from './health.controller';
import { ProductIndexService } from './product-index.service';
import { OpenSearchKeywordRepository } from './opensearch-keyword.repository';
import { EmbeddingService } from './embedding.service';
import { SpellCorrectionService } from './spell-correction.service';

/**
 * OpenSearch 가 죽어 있어도 search 앱은 «부팅에 성공하고», 돌아오면 «스스로 붙어야» 한다.
 *
 * 부팅 훅이 throw 하면 프로세스가 재시작을 반복하고, 포트가 계속 unhealthy 라 ALB 가 전
 * 경로를 502 로 돌려준다. 이 앱은 다른 앱들과 한 ECS 태스크를 공유하므로 그 이웃까지
 * 주기적으로 교체된다 — OpenSearch 한 곳의 장애가 훨씬 넓게 번진다.
 */

const UNREACHABLE = () => Promise.reject(new Error('connect ECONNREFUSED'));

describe('OpenSearch 장애 중 부팅', () => {
  it('OpenSearchService: 클러스터 헬스체크가 실패해도 onModuleInit 이 던지지 않는다', async () => {
    const service = new OpenSearchService({ get: () => undefined } as unknown as ConfigService);
    // 실제 클라이언트를 건드리지 않고 헬스체크만 죽은 것으로 만든다.
    (service.getClient().cluster as unknown as { health: () => Promise<unknown> }).health = UNREACHABLE;

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('ProductIndexService: 인덱스 준비가 실패해도 onModuleInit 이 던지지 않는다', async () => {
    const { service } = await makeProductIndexService(UNREACHABLE);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('OpenSearchKeywordRepository: 인덱스 준비가 실패해도 onModuleInit 이 던지지 않는다', async () => {
    const repository = new OpenSearchKeywordRepository({
      getClient: () => ({ indices: { exists: UNREACHABLE, create: jest.fn() } }),
      getQueryEventsIndex: () => 'search_query_events',
    } as unknown as OpenSearchService);

    await expect(repository.onModuleInit()).resolves.toBeUndefined();
  });
});

describe('/health 는 OpenSearch 가 느려도 빨리 답한다', () => {
  // ALB 헬스체크 타임아웃은 5초다. 클라이언트 기본값(요청 30초 + 재시도 3회)으로 두면
  // OpenSearch 가 «거절» 이 아니라 «먹통» 일 때 /health 가 그 시간을 그대로 끌어가
  // 부팅을 살려놔도 결국 같은 태스크 교체로 돌아간다.

  it('ping 에 ALB 타임아웃보다 짧은 requestTimeout 과 재시도 0 을 건다', async () => {
    const ping = jest.fn().mockResolvedValue({});
    const service = new OpenSearchService({ get: () => undefined } as unknown as ConfigService);
    (service.getClient() as unknown as { ping: unknown }).ping = ping;

    await service.ping();

    expect(ping).toHaveBeenCalledWith({}, { requestTimeout: PING_TIMEOUT_MS, maxRetries: 0 });
    expect(PING_TIMEOUT_MS).toBeLessThan(5000);
  });

  it('ping 이 실패해도 /health 는 200 본문(degraded)을 돌려준다', async () => {
    const controller = new HealthController({ ping: async () => false } as unknown as OpenSearchService);

    await expect(controller.check()).resolves.toMatchObject({
      status: 'degraded',
      opensearch: 'disconnected',
    });
  });
});

describe('OpenSearch 복구 후 재연결', () => {
  // 이 스위트가 실패를 캐시하는 회귀를 잡는다. 부팅이 살아남게 된 뒤로는 «프로세스가 새로
  // 뜨면서 초기화되는» 구제가 없으므로, 거절된 promise 를 들고 있으면 OpenSearch 가
  // 돌아와도 이 프로세스가 사는 동안 영영 검색이 안 된다 — 502 보다 나쁜 상태다.

  it('ProductIndexService: 부팅 때 실패했어도 그 뒤 요청은 성공한다', async () => {
    let reachable = false;
    const { service, client } = await makeProductIndexService(() =>
      reachable ? Promise.resolve({ body: true }) : Promise.reject(new Error('connect ECONNREFUSED')),
    );

    await service.onModuleInit();
    expect(client.indices.exists).toHaveBeenCalled();

    reachable = true;
    await expect(service.deleteProduct('550e8400-e29b-41d4-a716-446655440000')).resolves.toBeUndefined();
    expect(client.delete).toHaveBeenCalled();
  });

  it('OpenSearchKeywordRepository: 부팅 때 실패했어도 그 뒤 기록은 성공한다', async () => {
    let reachable = false;
    const index = jest.fn().mockResolvedValue({});
    const repository = new OpenSearchKeywordRepository({
      getClient: () => ({
        indices: {
          exists: () =>
            reachable ? Promise.resolve({ body: true }) : Promise.reject(new Error('connect ECONNREFUSED')),
          create: jest.fn(),
        },
        index,
      }),
      getQueryEventsIndex: () => 'search_query_events',
    } as unknown as OpenSearchService);

    await repository.onModuleInit();

    reachable = true;
    await expect(
      repository.record({
        keyword: '헤어',
        keywordNorm: '헤어',
        keywordCompact: '헤어',
        searchedAt: '2026-09-16T05:07:19.000Z',
        resultCount: 20,
      }),
    ).resolves.toBeUndefined();
    expect(index).toHaveBeenCalled();
  });
});

async function makeProductIndexService(exists: () => Promise<unknown>) {
  const client = {
    indices: {
      exists: jest.fn(exists),
      create: jest.fn().mockResolvedValue({}),
      putMapping: jest.fn().mockResolvedValue({}),
      analyze: jest.fn().mockResolvedValue({ body: { tokens: [] } }),
    },
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    search: jest.fn().mockResolvedValue({ body: { hits: { hits: [], total: { value: 0 } } } }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProductIndexService,
      {
        provide: OpenSearchService,
        useValue: { getClient: () => client, getProductsIndex: () => 'search_products' },
      },
      { provide: ConfigService, useValue: { get: () => undefined } },
      { provide: EmbeddingService, useValue: { enabled: false, embedQuery: jest.fn() } },
      {
        provide: SpellCorrectionService,
        useValue: { buildDictionary: jest.fn().mockResolvedValue(undefined), suggest: () => null },
      },
    ],
  }).compile();

  return { service: module.get(ProductIndexService), client };
}
