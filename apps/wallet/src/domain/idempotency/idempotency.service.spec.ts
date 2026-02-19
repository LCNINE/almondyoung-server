import { ConflictException } from '@nestjs/common';
import {
  IdempotencyTx,
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

  it('allows same idempotency key across different operations', async () => {
    const cancel = await service.beginHttpRequest({
      idempotencyKey: 'idem-5',
      operation: 'POST /v1/intents/intent-1/cancel',
      actorId: 'customer-1',
      requestMethod: 'POST',
      requestPath: '/v1/intents/intent-1/cancel',
      requestBody: {},
    });

    const supersede = await service.beginHttpRequest({
      idempotencyKey: 'idem-5',
      operation: 'POST /v1/intents/intent-1/supersede',
      actorId: 'customer-1',
      requestMethod: 'POST',
      requestPath: '/v1/intents/intent-1/supersede',
      requestBody: {},
    });

    expect(cancel.kind).toBe('STARTED');
    expect(supersede.kind).toBe('STARTED');
  });

  it('throws 409 for cancel when same key is reused with different payload', async () => {
    await service.beginHttpRequest({
      idempotencyKey: 'idem-6',
      operation: 'POST /v1/intents/intent-1/cancel',
      actorId: 'customer-1',
      requestMethod: 'POST',
      requestPath: '/v1/intents/intent-1/cancel',
      requestBody: { reasonCode: 'CUSTOMER_REQUEST' },
    });

    await expect(
      service.beginHttpRequest({
        idempotencyKey: 'idem-6',
        operation: 'POST /v1/intents/intent-1/cancel',
        actorId: 'customer-1',
        requestMethod: 'POST',
        requestPath: '/v1/intents/intent-1/cancel',
        requestBody: { reasonCode: 'DUPLICATE_ORDER' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('replays completed command for same messageType and idempotency key', async () => {
    const begin = await service.beginCommandRequest({
      idempotencyKey: 'cmd-idem-1',
      operation: 'CreatePaymentIntent',
      requestBody: { referenceId: 'ref-1', payableAmount: 1000 },
    });

    expect(begin.kind).toBe('STARTED');
    if (begin.kind !== 'STARTED') {
      throw new Error('Expected STARTED');
    }

    await service.completeSuccess(begin.recordId, 200, { status: 'PROCESSED' });

    const replay = await service.beginCommandRequest({
      idempotencyKey: 'cmd-idem-1',
      operation: 'CreatePaymentIntent',
      requestBody: { referenceId: 'ref-1', payableAmount: 1000 },
    });

    expect(replay).toMatchObject({
      kind: 'REPLAY',
      responseCode: 200,
      responseBody: { status: 'PROCESSED' },
    });
  });

  it('treats in-progress command as replay (no-op)', async () => {
    await service.beginCommandRequest({
      idempotencyKey: 'cmd-idem-2',
      operation: 'CancelPaymentIntent',
      requestBody: { intentId: 'intent-1' },
    });

    const replay = await service.beginCommandRequest({
      idempotencyKey: 'cmd-idem-2',
      operation: 'CancelPaymentIntent',
      requestBody: { intentId: 'intent-1' },
    });

    expect(replay).toMatchObject({
      kind: 'REPLAY',
      responseCode: 202,
      responseBody: { status: 'IN_PROGRESS' },
    });
  });

  it('replays failed command with same payload', async () => {
    const begin = await service.beginCommandRequest({
      idempotencyKey: 'cmd-idem-3',
      operation: 'StartPaymentLeg',
      requestBody: { intentId: 'intent-1', legId: 'leg-1', operation: 'AUTHORIZE' },
    });

    expect(begin.kind).toBe('STARTED');
    if (begin.kind !== 'STARTED') {
      throw new Error('Expected STARTED');
    }

    await service.completeFailure(begin.recordId, 500, {
      error: 'PROVIDER_TIMEOUT',
      message: 'timeout',
    });

    const retry = await service.beginCommandRequest({
      idempotencyKey: 'cmd-idem-3',
      operation: 'StartPaymentLeg',
      requestBody: { intentId: 'intent-1', legId: 'leg-1', operation: 'AUTHORIZE' },
    });

    expect(retry).toMatchObject({
      kind: 'REPLAY',
      responseCode: 500,
      responseBody: {
        error: 'PROVIDER_TIMEOUT',
        message: 'timeout',
      },
    });
  });
});

class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly store = new Map<string, IdempotencyKeyRecord>();

  async runInTransaction<T>(callback: (tx: IdempotencyTx) => Promise<T>): Promise<T> {
    return callback({} as IdempotencyTx);
  }

  async findByIdForUpdate(
    _tx: IdempotencyTx,
    recordId: string,
  ): Promise<IdempotencyKeyRecord | null> {
    return this.store.get(recordId) ?? null;
  }

  async insert(_tx: IdempotencyTx, record: NewIdempotencyKeyRecord): Promise<void> {
    if (this.store.has(record.id)) {
      const error = new Error('duplicate key value violates unique constraint');
      (error as Error & { code?: string }).code = '23505';
      throw error;
    }
    this.store.set(record.id, {
      responseCode: null,
      responseBody: null,
      ...record,
      updatedAt: record.updatedAt ?? record.createdAt,
    });
  }

  async update(
    _tx: IdempotencyTx,
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

  async updateIfPending(
    _tx: IdempotencyTx,
    recordId: string,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<boolean> {
    const existing = this.store.get(recordId);
    if (!existing || existing.status !== 'PENDING') {
      return false;
    }

    this.store.set(recordId, {
      ...existing,
      ...patch,
    });
    return true;
  }

  async updateIfExpired(
    _tx: IdempotencyTx,
    recordId: string,
    now: Date,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<boolean> {
    const existing = this.store.get(recordId);
    if (!existing || existing.expiresAt.getTime() > now.getTime()) {
      return false;
    }

    this.store.set(recordId, {
      ...existing,
      ...patch,
    });
    return true;
  }
}
