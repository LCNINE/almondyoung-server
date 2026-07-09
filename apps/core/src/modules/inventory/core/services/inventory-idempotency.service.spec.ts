import { ConflictError } from '@app/shared';
import { InventoryIdempotencyService, computeRequestHash } from './inventory-idempotency.service';

type Row = { id: string; endpoint: string; key: string; requestHash: string; response: unknown };

function makeTrx(over: { insertedIds?: Array<{ id: string }>; existing?: Row[] } = {}) {
  const whereUpdate = jest.fn().mockResolvedValue(undefined);
  const trx = {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(over.insertedIds ?? []),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({ where: whereUpdate }),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(over.existing ?? []),
        }),
      }),
    }),
  };
  return { trx, whereUpdate };
}

function build(trx: unknown) {
  // dbService.run 이 즉시 fake trx 로 콜백 실행
  const dbService = { run: (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never;
  return new InventoryIdempotencyService(dbService);
}

describe('computeRequestHash', () => {
  it('같은 본문은 같은 해시, 다른 본문은 다른 해시', () => {
    const a = computeRequestHash({ x: 1 });
    expect(a).toBe(computeRequestHash({ x: 1 }));
    expect(a).not.toBe(computeRequestHash({ x: 2 }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('InventoryIdempotencyService.withIdempotency', () => {
  const dto = { warehouseId: 'w', qty: 3 };

  it('신규 키: handler 를 실행하고 반환값을 response 에 저장 후 그대로 반환한다', async () => {
    const { trx, whereUpdate } = makeTrx({ insertedIds: [{ id: 'row-1' }] });
    const svc = build(trx);
    const handler = jest.fn().mockResolvedValue({ receiptId: 'r-1' });
    const result = await svc.withIdempotency('inbound.simple', 'k-1', dto, handler);
    expect(handler).toHaveBeenCalledWith(trx);
    expect(whereUpdate).toHaveBeenCalled();
    expect(result).toEqual({ receiptId: 'r-1' });
  });

  it('신규 키: handler 가 throw 하면 그대로 전파한다(응답 저장 없음)', async () => {
    const { trx, whereUpdate } = makeTrx({ insertedIds: [{ id: 'row-1' }] });
    const svc = build(trx);
    await expect(
      svc.withIdempotency('inbound.simple', 'k-1', dto, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(whereUpdate).not.toHaveBeenCalled();
  });

  it('중복 키 + 같은 해시 + 응답 존재: handler 를 실행하지 않고 저장 응답을 반환한다', async () => {
    const stored: Row = {
      id: 'row-1', endpoint: 'inbound.simple', key: 'k-1',
      requestHash: computeRequestHash(dto), response: { receiptId: 'r-1' },
    };
    const { trx } = makeTrx({ existing: [stored] });
    const svc = build(trx);
    const handler = jest.fn();
    const result = await svc.withIdempotency('inbound.simple', 'k-1', dto, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({ receiptId: 'r-1' });
  });

  it('중복 키 + 다른 해시: ConflictError(키 재사용)', async () => {
    const stored: Row = {
      id: 'row-1', endpoint: 'inbound.simple', key: 'k-1',
      requestHash: computeRequestHash({ other: true }), response: { receiptId: 'r-1' },
    };
    const { trx } = makeTrx({ existing: [stored] });
    const svc = build(trx);
    await expect(svc.withIdempotency('inbound.simple', 'k-1', dto, jest.fn())).rejects.toThrow(ConflictError);
  });

  it('중복 키 + response null(처리 중): ConflictError', async () => {
    const stored: Row = {
      id: 'row-1', endpoint: 'inbound.simple', key: 'k-1',
      requestHash: computeRequestHash(dto), response: null,
    };
    const { trx } = makeTrx({ existing: [stored] });
    const svc = build(trx);
    await expect(svc.withIdempotency('inbound.simple', 'k-1', dto, jest.fn())).rejects.toThrow(ConflictError);
  });

  it('신규 키: handler 가 null/undefined 로 resolve 하면 throw 하고 응답을 저장하지 않는다', async () => {
    const { trx, whereUpdate } = makeTrx({ insertedIds: [{ id: 'row-1' }] });
    const svc = build(trx);
    const handler = jest.fn().mockResolvedValue(null);
    await expect(svc.withIdempotency('inbound.simple', 'k-1', dto, handler)).rejects.toThrow(
      /must not resolve null\/undefined/,
    );
    expect(whereUpdate).not.toHaveBeenCalled();
  });
});

describe('InventoryIdempotencyService.purgeExpired', () => {
  it('30일 초과 row 를 삭제하고 삭제 건수를 반환한다', async () => {
    const whereDelete = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
    });
    const trx = { delete: jest.fn().mockReturnValue({ where: whereDelete }) };
    const dbService = { run: (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never;
    const svc = new InventoryIdempotencyService(dbService);
    await expect(svc.purgeExpired()).resolves.toBe(2);
    expect(trx.delete).toHaveBeenCalled();
  });
});
