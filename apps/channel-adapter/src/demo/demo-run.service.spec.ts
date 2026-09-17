import { ConflictException } from '@nestjs/common';
import { createDemoRunSchema, DemoRunRepositoryPort, DemoRunService, PersistedDemoRun } from './demo-run.service';
import type { DemoCatalogClient, DemoCatalogItem } from './demo-catalog.client';

const trustedCatalog: DemoCatalogItem[] = [
  {
    variantId: '019f1003-0030-7000-a000-000000000030',
    masterId: '019f1001-0030-7000-a000-000000000030',
    versionId: '019f1002-0030-7000-a000-000000000030',
    skuId: '019f1004-0030-7000-a000-000000000030',
    sku: 'DEMO-SKU-030',
    productName: '데모 물류 상품 30',
    unitPrice: 10000,
    availableQuantity: 100,
    components: [{ skuId: '019f1004-0030-7000-a000-000000000030', quantity: 1, availableQuantity: 100 }],
  },
  {
    variantId: '019f1003-0001-7000-a000-000000000001',
    masterId: '019f1001-0001-7000-a000-000000000001',
    versionId: '019f1002-0001-7000-a000-000000000001',
    skuId: '019f1004-0001-7000-a000-000000000001',
    sku: 'DEMO-SKU-001',
    productName: '데모 물류 상품 01',
    unitPrice: 10000,
    availableQuantity: 9,
    components: [{ skuId: '019f1004-0001-7000-a000-000000000001', quantity: 1, availableQuantity: 9 }],
  },
];

function catalogClient(list = jest.fn(() => Promise.resolve(trustedCatalog))): DemoCatalogClient {
  return { list } as unknown as DemoCatalogClient;
}

class ConcurrentMemoryRepository implements DemoRunRepositoryPort {
  protected readonly runs = new Map<string, PersistedDemoRun>();

  async createOrGet(input: PersistedDemoRun): Promise<PersistedDemoRun> {
    await Promise.resolve();
    const existing = this.runs.get(input.requestId);
    if (existing) return existing;
    this.runs.set(input.requestId, input);
    return input;
  }

  getByRequestId(requestId: string): Promise<PersistedDemoRun | null> {
    return Promise.resolve(this.runs.get(requestId) ?? null);
  }

  process(_runId: string): Promise<void> {
    void _runId;
    return Promise.resolve();
  }
  getById(id: string): Promise<PersistedDemoRun | null> {
    return Promise.resolve([...this.runs.values()].find((run) => run.id === id) ?? null);
  }
  list(): Promise<PersistedDemoRun[]> {
    return Promise.resolve([...this.runs.values()]);
  }
  count(): Promise<number> {
    return Promise.resolve(this.runs.size);
  }
}

class PartialReplayRepository extends ConcurrentMemoryRepository {
  processCount = 0;

  override async process(runId: string): Promise<void> {
    this.processCount += 1;
    const run = await this.getById(runId);
    if (!run) return;
    const now = new Date();
    run.items[0] = { ...run.items[0], status: 'enqueued', enqueuedAt: now, updatedAt: now };
    run.items[1] =
      this.processCount === 1
        ? { ...run.items[1], status: 'failed', attempts: 1, error: 'temporary', updatedAt: now }
        : { ...run.items[1], status: 'enqueued', attempts: 2, error: null, enqueuedAt: now, updatedAt: now };
    run.status = this.processCount === 1 ? 'partial_failure' : 'completed';
    run.updatedAt = now;
    run.completedAt = now;
  }
}

describe('DemoRunService request idempotency', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  it('returns one stable run for concurrent equivalent requests', async () => {
    const repository = new ConcurrentMemoryRepository();
    const service = new DemoRunService(repository, catalogClient());
    const request = { requestId, scenario: 'happy_path' as const, count: 2, quantity: 1 };

    const [first, replay] = await Promise.all([
      service.create(request, actorId, 'Bearer test'),
      service.create(request, actorId, 'Bearer test'),
    ]);

    expect(first.id).toBe(replay.id);
    expect(first.inputHash).toBe(replay.inputHash);
    expect(await repository.list()).toHaveLength(1);
  });

  it('durably rejects a reused request id with different normalized input', async () => {
    const repository = new ConcurrentMemoryRepository();
    const service = new DemoRunService(repository, catalogClient());

    await service.create({ requestId, scenario: 'happy_path', count: 1, quantity: 1 }, actorId, 'Bearer test');

    await expect(
      service.create({ requestId, scenario: 'inventory_shortage', count: 1, quantity: 1 }, actorId, 'Bearer test'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await repository.list()).toHaveLength(1);
  });

  it('lets exactly one of two concurrent conflicting inputs own the request id', async () => {
    const repository = new ConcurrentMemoryRepository();
    const service = new DemoRunService(repository, catalogClient());

    const results = await Promise.allSettled([
      service.create({ requestId, scenario: 'happy_path', count: 1 }, actorId, 'Bearer test'),
      service.create({ requestId, scenario: 'inventory_shortage', count: 1 }, actorId, 'Bearer test'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
    expect(await repository.list()).toHaveLength(1);
  });

  it('rejects invalid counts, quantities, and request ids while allowing trusted catalog variants', () => {
    expect(createDemoRunSchema.safeParse({ requestId: 'bad', scenario: 'happy_path', count: 1 }).success).toBe(false);
    expect(createDemoRunSchema.safeParse({ requestId, scenario: 'happy_path', count: 0 }).success).toBe(false);
    expect(createDemoRunSchema.safeParse({ requestId, scenario: 'happy_path', count: 1, quantity: 101 }).success).toBe(
      false,
    );
    expect(
      createDemoRunSchema.safeParse({
        requestId,
        scenario: 'happy_path',
        count: 1,
        variantId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(true);
  });

  it('resumes only unfinished work when the same normalized request is posted again', async () => {
    const repository = new PartialReplayRepository();
    const service = new DemoRunService(repository, catalogClient());
    const original = await service.create({ requestId, scenario: 'happy_path', count: 2 }, actorId, 'Bearer test');

    expect(original.status).toBe('partial_failure');
    expect(original.items.map((item) => item.status)).toEqual(['enqueued', 'failed']);

    const replay = await service.create(
      {
        requestId,
        scenario: 'happy_path',
        count: 2,
        variantId: original.variantId,
        quantity: original.quantity,
      },
      actorId,
      'Bearer test',
    );

    expect(replay.status).toBe('completed');
    expect(replay.items.map((item) => item.status)).toEqual(['enqueued', 'enqueued']);
    expect(repository.processCount).toBe(2);
  });

  it('persists the fixture version and chooses inventory-safe scenario defaults', async () => {
    const repository = new ConcurrentMemoryRepository();
    const service = new DemoRunService(repository, catalogClient());

    const happy = await service.create({ requestId, scenario: 'happy_path', count: 50 }, actorId, 'Bearer test');
    const shortage = await service.create(
      {
        requestId: '44444444-4444-4444-8444-444444444444',
        scenario: 'inventory_shortage',
        count: 1,
      },
      actorId,
      'Bearer test',
    );

    expect(happy).toMatchObject({
      fixtureVersion: 'demo-logistics-v1',
      variantId: '019f1003-0030-7000-a000-000000000030',
      quantity: 1,
    });
    expect(shortage).toMatchObject({
      fixtureVersion: 'demo-logistics-v1',
      variantId: '019f1003-0001-7000-a000-000000000001',
      quantity: 10,
    });
  });

  it('replays persisted lines before consulting the mutable catalog and resumes only unfinished work', async () => {
    const repository = new PartialReplayRepository();
    const list = jest.fn(() => Promise.resolve(trustedCatalog));
    const service = new DemoRunService(repository, catalogClient(list));
    const request = {
      requestId,
      scenario: 'happy_path' as const,
      count: 2,
      mode: 'specified' as const,
      variantIds: [trustedCatalog[0].variantId],
      productsPerOrder: 1,
      minQuantity: 1,
      maxQuantity: 1,
    };

    const first = await service.create(request, actorId, 'Bearer admin');
    list.mockRejectedValueOnce(new Error('catalog changed/unavailable'));
    const replayed = await service.create(request, actorId, 'Bearer admin');

    expect(list).toHaveBeenCalledTimes(1);
    expect(replayed.items.map((item) => item.lines)).toEqual(first.items.map((item) => item.lines));
    expect(replayed.status).toBe('completed');
  });

  it('accepts new bounded multi-product inputs and rejects invalid combinations', () => {
    expect(
      createDemoRunSchema.safeParse({
        requestId,
        scenario: 'happy_path',
        count: 5,
        mode: 'random',
        variantIds: [],
        productsPerOrder: 2,
        minQuantity: 1,
        maxQuantity: 3,
      }).success,
    ).toBe(true);
    expect(
      createDemoRunSchema.safeParse({
        requestId,
        scenario: 'happy_path',
        count: 1,
        mode: 'specified',
        variantIds: [trustedCatalog[0].variantId, trustedCatalog[1].variantId],
        productsPerOrder: 2,
        minQuantity: 1,
        maxQuantity: 3,
      }).success,
    ).toBe(true);
    expect(
      createDemoRunSchema.safeParse({
        requestId,
        scenario: 'happy_path',
        count: 1,
        mode: 'specified',
        variantIds: [],
      }).success,
    ).toBe(false);
    expect(
      createDemoRunSchema.safeParse({
        requestId,
        scenario: 'happy_path',
        count: 1,
        mode: 'specified',
        variantIds: Array.from(
          { length: 6 },
          (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ),
      }).success,
    ).toBe(false);
    expect(
      createDemoRunSchema.safeParse({
        requestId,
        scenario: 'happy_path',
        count: 1,
        mode: 'random',
        productsPerOrder: 6,
      }).success,
    ).toBe(false);
    expect(
      createDemoRunSchema.safeParse({
        requestId,
        scenario: 'happy_path',
        count: 1,
        mode: 'random',
        minQuantity: 4,
        maxQuantity: 3,
      }).success,
    ).toBe(false);
  });

  it('replays the normalized whole-catalog random input returned by the run detail', async () => {
    const repository = new ConcurrentMemoryRepository();
    const service = new DemoRunService(repository, catalogClient());
    const request = {
      requestId,
      scenario: 'happy_path' as const,
      count: 1,
      mode: 'random' as const,
      variantIds: [],
      productsPerOrder: 1,
      minQuantity: 1,
      maxQuantity: 3,
    };

    const first = await service.create(request, actorId, 'Bearer test');
    const replayInput = createDemoRunSchema.parse({
      requestId: first.input.requestId,
      scenario: first.input.scenario,
      count: first.input.count,
      mode: first.input.mode,
      variantIds: first.input.variantIds,
      productsPerOrder: first.input.productsPerOrder,
      minQuantity: first.input.minQuantity,
      maxQuantity: first.input.maxQuantity,
    });
    const replay = await service.create(replayInput, actorId, 'Bearer test');

    expect(replay.id).toBe(first.id);
    expect(replay.items.map((item) => item.lines)).toEqual(first.items.map((item) => item.lines));
  });
});
