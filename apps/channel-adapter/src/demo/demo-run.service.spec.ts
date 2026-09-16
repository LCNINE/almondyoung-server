import { ConflictException } from '@nestjs/common';
import { createDemoRunSchema, DemoRunRepositoryPort, DemoRunService, PersistedDemoRun } from './demo-run.service';

class ConcurrentMemoryRepository implements DemoRunRepositoryPort {
  protected readonly runs = new Map<string, PersistedDemoRun>();

  async createOrGet(input: PersistedDemoRun): Promise<PersistedDemoRun> {
    await Promise.resolve();
    const existing = this.runs.get(input.requestId);
    if (existing) return existing;
    this.runs.set(input.requestId, input);
    return input;
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
    const service = new DemoRunService(repository);
    const request = { requestId, scenario: 'happy_path' as const, count: 2, quantity: 1 };

    const [first, replay] = await Promise.all([service.create(request, actorId), service.create(request, actorId)]);

    expect(first.id).toBe(replay.id);
    expect(first.inputHash).toBe(replay.inputHash);
    expect(await repository.list()).toHaveLength(1);
  });

  it('durably rejects a reused request id with different normalized input', async () => {
    const repository = new ConcurrentMemoryRepository();
    const service = new DemoRunService(repository);

    await service.create({ requestId, scenario: 'happy_path', count: 1, quantity: 1 }, actorId);

    await expect(
      service.create({ requestId, scenario: 'inventory_shortage', count: 1, quantity: 1 }, actorId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await repository.list()).toHaveLength(1);
  });

  it('lets exactly one of two concurrent conflicting inputs own the request id', async () => {
    const repository = new ConcurrentMemoryRepository();
    const service = new DemoRunService(repository);

    const results = await Promise.allSettled([
      service.create({ requestId, scenario: 'happy_path', count: 1 }, actorId),
      service.create({ requestId, scenario: 'inventory_shortage', count: 1 }, actorId),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
    expect(await repository.list()).toHaveLength(1);
  });

  it('rejects invalid counts, quantities, request ids, and non-fixture variants', () => {
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
    ).toBe(false);
  });

  it('resumes only unfinished work when the same normalized request is posted again', async () => {
    const repository = new PartialReplayRepository();
    const service = new DemoRunService(repository);
    const original = await service.create({ requestId, scenario: 'happy_path', count: 2 }, actorId);

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
    );

    expect(replay.status).toBe('completed');
    expect(replay.items.map((item) => item.status)).toEqual(['enqueued', 'enqueued']);
    expect(repository.processCount).toBe(2);
  });

  it('persists the fixture version and chooses inventory-safe scenario defaults', async () => {
    const repository = new ConcurrentMemoryRepository();
    const service = new DemoRunService(repository);

    const happy = await service.create({ requestId, scenario: 'happy_path', count: 50 }, actorId);
    const shortage = await service.create(
      {
        requestId: '44444444-4444-4444-8444-444444444444',
        scenario: 'inventory_shortage',
        count: 1,
      },
      actorId,
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
});
