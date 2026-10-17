import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { HttpIdempotencyInterceptor, bodyForRequestHash } from './http-idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKeyRecord } from './idempotency.schema';

describe('bodyForRequestHash', () => {
  const REFUND_PATHS = ['/v1/payment-intents/abc/refund', '/v1/admin/payment-intents/abc/refund', '/v1/refunds'];

  it.each(REFUND_PATHS)('%s 는 최상위 kind 를 뺀 사본을 돌려준다', (path) => {
    const body = { amount: 1000, kind: 'RETURN' };
    expect(bodyForRequestHash('POST', path, body)).toEqual({ amount: 1000 });
    expect(body).toEqual({ amount: 1000, kind: 'RETURN' });
  });

  it('kind 가 없는 환불 바디는 그대로다', () => {
    const body = { amount: 1000 };
    expect(bodyForRequestHash('POST', '/v1/payment-intents/abc/refund', body)).toEqual({ amount: 1000 });
  });

  it('다른 경로의 kind 는 건드리지 않는다', () => {
    const body = { kind: 'X' };
    expect(bodyForRequestHash('POST', '/v1/payment-intents/abc/capture', body)).toBe(body);
    expect(bodyForRequestHash('POST', '/v1/refunds/extra', body)).toBe(body);
  });

  it('POST 가 아니면 건드리지 않는다', () => {
    const body = { kind: 'X' };
    expect(bodyForRequestHash('PUT', '/v1/refunds', body)).toBe(body);
  });

  it('배열·null·원시 바디는 그대로다', () => {
    const arr = [{ kind: 'X' }];
    expect(bodyForRequestHash('POST', '/v1/refunds', arr)).toBe(arr);
    expect(bodyForRequestHash('POST', '/v1/refunds', null)).toBeNull();
    expect(bodyForRequestHash('POST', '/v1/refunds', undefined)).toBeUndefined();
  });
});

describe('HttpIdempotencyInterceptor — 환불 재시도', () => {
  function build() {
    const store = new Map<string, IdempotencyKeyRecord>();
    const repository = {
      runInTransaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
      findByIdForUpdate: jest.fn(async (_tx: unknown, id: string) => store.get(id) ?? null),
      insert: jest.fn(async (_tx: unknown, r: IdempotencyKeyRecord) => void store.set(r.id, r)),
      update: jest.fn(),
      updateIfPending: jest.fn(async (_tx: unknown, id: string, patch: Partial<IdempotencyKeyRecord>) => {
        store.set(id, { ...store.get(id)!, ...patch } as IdempotencyKeyRecord);
        return true;
      }),
      updateIfExpired: jest.fn(),
    };
    return new HttpIdempotencyInterceptor(new IdempotencyService(repository as never));
  }

  function ctx(url: string, body: unknown): ExecutionContext {
    const request = { method: 'POST', url, body, headers: { 'idempotency-key': 'k1' }, user: { sub: 'u1' } };
    const reply = { statusCode: 201, code: jest.fn() };
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    } as unknown as ExecutionContext;
  }

  async function call(interceptor: HttpIdempotencyInterceptor, url: string, body: unknown, handler: jest.Mock) {
    const obs = await interceptor.intercept(ctx(url, body), { handle: handler });
    return lastValueFrom(obs);
  }

  it('kind 없이 성공한 요청을 kind 를 붙여 재시도하면 409 가 아니라 REPLAY 다', async () => {
    const interceptor = build();
    const handler = jest.fn(() => of({ refundId: 'r1' }));
    const url = '/v1/payment-intents/abc/refund';

    await call(interceptor, url, { amount: 1000 }, handler);
    const replay = await call(interceptor, url, { amount: 1000, kind: 'RETURN' }, handler);

    expect(replay).toEqual({ refundId: 'r1' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('환불 밖 경로는 kind 가 달라지면 여전히 409 다', async () => {
    const interceptor = build();
    const handler = jest.fn(() => of({ ok: true }));
    const url = '/v1/payment-intents/abc/capture';

    await call(interceptor, url, { amount: 1000 }, handler);
    await expect(call(interceptor, url, { amount: 1000, kind: 'X' }, handler)).rejects.toMatchObject({
      response: { error: 'IDEMPOTENCY_KEY_HASH_MISMATCH' },
    });
  });
});
