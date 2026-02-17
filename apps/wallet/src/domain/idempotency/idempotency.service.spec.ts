import { ConflictException } from '@nestjs/common';
import {
  IdempotencyRepository,
} from './idempotency.repository';
import { IdempotencyService } from './idempotency.service';
import {
  IdempotencyKeyRecord,
  NewIdempotencyKeyRecord,
  UpdateIdempotencyKeyRecord,
} from './idempotency.schema';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let repository: InMemoryIdempotencyRepository;

  beforeEach(() => {
    repository = new InMemoryIdempotencyRepository();
    service = new IdempotencyService(repository as unknown as IdempotencyRepository);
  });

  it('starts first request and replays completed response for same key/payload', async () => {
    const begin = await service.beginHttpRequest({
      idempotencyKey: 'idem-1',
      operation: 'POST /v1/intents',
      actorId: 'customer-1',
      requestMethod: 'POST',
      requestPath: '/v1/intents',
      requestBody: { customerId: 'customer-1', amount: 1000 },
    });

    expect(begin.kind).toBe('STARTED');
    if (begin.kind !== 'STARTED') {
      throw new Error('Expected STARTED');
    }

    await service.completeSuccess(begin.recordId, 201, {
      success: true,
      data: { intentId: 'intent-1' },
    });

    const replay = await service.beginHttpRequest({
      idempotencyKey: 'idem-1',
      operation: 'POST /v1/intents',
      actorId: 'customer-1',
      requestMethod: 'POST',
      requestPath: '/v1/intents',
      requestBody: { customerId: 'customer-1', amount: 1000 },
    });

    expect(replay).toMatchObject({
      kind: 'REPLAY',
      responseCode: 201,
      responseBody: { success: true, data: { intentId: 'intent-1' } },
    });
  });

  it('throws 409 when same key is reused with different payload', async () => {
    await service.beginHttpRequest({
      idempotencyKey: 'idem-2',
      operation: 'POST /v1/intents',
      actorId: 'customer-1',
      requestMethod: 'POST',
      requestPath: '/v1/intents',
      requestBody: { amount: 1000 },
    });

    let thrown: unknown;
    try {
      await service.beginHttpRequest({
        idempotencyKey: 'idem-2',
        operation: 'POST /v1/intents',
        actorId: 'customer-1',
        requestMethod: 'POST',
        requestPath: '/v1/intents',
        requestBody: { amount: 2000 },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getStatus()).toBe(409);
    expect((thrown as ConflictException).getResponse()).toMatchObject({
      error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
    });
  });

  it('throws 409 when same key request is in progress', async () => {
    await service.beginHttpRequest({
      idempotencyKey: 'idem-3',
      operation: 'POST /v1/intents',
      actorId: 'customer-1',
      requestMethod: 'POST',
      requestPath: '/v1/intents',
      requestBody: { amount: 1000 },
    });

    let thrown: unknown;
    try {
      await service.beginHttpRequest({
        idempotencyKey: 'idem-3',
        operation: 'POST /v1/intents',
        actorId: 'customer-1',
        requestMethod: 'POST',
        requestPath: '/v1/intents',
        requestBody: { amount: 1000 },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toMatchObject({
      error: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    });
  });

  it('treats different actor as different idempotency scope', async () => {
    const first = await service.beginHttpRequest({
      idempotencyKey: 'idem-4',
      operation: 'POST /v1/intents',
      actorId: 'customer-1',
      requestMethod: 'POST',
      requestPath: '/v1/intents',
      requestBody: { amount: 1000 },
    });

    const second = await service.beginHttpRequest({
      idempotencyKey: 'idem-4',
      operation: 'POST /v1/intents',
      actorId: 'customer-2',
      requestMethod: 'POST',
      requestPath: '/v1/intents',
      requestBody: { amount: 1000 },
    });

    expect(first.kind).toBe('STARTED');
    expect(second.kind).toBe('STARTED');
    if (first.kind === 'STARTED' && second.kind === 'STARTED') {
      expect(first.recordId).not.toBe(second.recordId);
    }
  });
});

class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly store = new Map<string, IdempotencyKeyRecord>();

  async findById(recordId: string): Promise<IdempotencyKeyRecord | null> {
    return this.store.get(recordId) ?? null;
  }

  async insert(record: NewIdempotencyKeyRecord): Promise<void> {
    if (this.store.has(record.id)) {
      const error = new Error('duplicate key value violates unique constraint');
      (error as Error & { code?: string }).code = '23505';
      throw error;
    }
    this.store.set(record.id, {
      responseCode: null,
      responseBody: null,
      ...record,
    });
  }

  async update(
    recordId: string,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<void> {
    const existing = this.store.get(recordId);
    if (!existing) {
      return;
    }
    this.store.set(recordId, {
      ...existing,
      ...patch,
    });
  }
}
