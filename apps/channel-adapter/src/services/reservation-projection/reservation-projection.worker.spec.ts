import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import type { LineItemReservationResult } from '../../adapters/medusa/medusa.client';
import { inboxEvents, medusaReservationProjectionVersions } from '../../schema';
import { ReservationProjectionWorker } from './reservation-projection.worker';

const T = new Date('2026-11-01T00:00:00.000Z');

type Write = { lineItemId: string; quantity: number; allowDecrease: boolean };

function payload(over: Partial<SalesOrderLineReservationStatePayload> = {}): SalesOrderLineReservationStatePayload {
  return {
    salesOrderId: 'so-1',
    salesChannel: 'medusa',
    channelOrderId: 'order_1',
    orderedAt: '2026-11-09T00:00:00.000Z',
    version: 5,
    asOf: '2026-11-09T00:01:00.000Z',
    lines: [],
    ...over,
  };
}


type Setup = {
  cutover?: Date | null;
  applied?: number | null;
  writes?: Write[];
  results?: LineItemReservationResult[];
  throws?: Error;
};
type InboxUpdate = Record<string, unknown> & { nextAttemptAt?: Date };

function setup(opts: Setup) {
  const inboxUpdates: InboxUpdate[] = [];
  const upserts: { v: { salesOrderId: string; appliedVersion: number } }[] = [];
  const db = {
    transaction: async <R>(cb: (trx: { execute: () => Promise<void> }) => Promise<R>) => cb({ execute: async () => undefined }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (opts.applied == null ? [] : [{ appliedVersion: opts.applied }]) }),
      }),
    }),
    update: (table: unknown) => ({
      set: (v: InboxUpdate) => ({
        where: async () => {
          if (table === inboxEvents) inboxUpdates.push(v);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: { salesOrderId: string; appliedVersion: number }) => ({
        onConflictDoUpdate: async () => {
          if (table === medusaReservationProjectionVersions) upserts.push({ v });
        },
      }),
    }),
  };
  const cutover = { get: jest.fn().mockResolvedValue(opts.cutover === undefined ? T : opts.cutover) };
  const projection = { toWrites: jest.fn().mockResolvedValue(opts.writes ?? [{ lineItemId: 'li', quantity: 1, allowDecrease: true }]) };
  const medusa = {
    setLineItemReservations: jest.fn().mockImplementation(async () => {
      if (opts.throws) throw opts.throws;
      return opts.results ?? [{ lineItemId: 'li', outcome: 'set', quantityBefore: 0, quantityAfter: 1 }];
    }),
  };
  // 협력자 스텁 — 워커가 쓰는 메서드만 구현한 부분 객체라 unknown 경유 캐스트가 필요하다.
  const worker = new ReservationProjectionWorker(
    { db } as never,
    cutover as never,
    projection as never,
    medusa as never,
  );
  return { worker, inboxUpdates, upserts, medusa, projection };
}

const claim = (over: Partial<SalesOrderLineReservationStatePayload> = {}, attempts = 1) => ({ id: 'e1', attempts, payload: payload(over) });

describe('ReservationProjectionWorker', () => {
  afterEach(() => delete process.env.RESERVATION_PROJECTION_MAX_RETRIES);

  it.each<[string, Setup, Partial<SalesOrderLineReservationStatePayload>]>([
    ['T 없음', { cutover: null }, {}],
    ['orderedAt < T', {}, { orderedAt: '2026-10-31T00:00:00.000Z' }],
    ['예약 투영 채널이 아님', {}, { salesChannel: 'naver' }],
    ['3pl 처럼 예약 축이 없는 채널', {}, { salesChannel: '3pl' as never }],
    ['version <= applied', { applied: 5 }, {}],
  ])('건너뜀: %s — published, Medusa 호출 0', async (_n, opts, over) => {
    const { worker, inboxUpdates, upserts, medusa } = setup(opts as Setup);
    await worker.processClaimed(claim(over as Partial<SalesOrderLineReservationStatePayload>));
    expect(medusa.setLineItemReservations).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    expect(inboxUpdates[0]).toMatchObject({ status: 'published' });
  });

  it('정상 — 한 번 호출하고 applied_version 을 올린다', async () => {
    const { worker, inboxUpdates, upserts, medusa } = setup({ applied: 4 });
    await worker.processClaimed(claim());
    expect(medusa.setLineItemReservations).toHaveBeenCalledTimes(1);
    expect(upserts[0].v).toMatchObject({ salesOrderId: 'so-1', appliedVersion: 5 });
    expect(inboxUpdates[0]).toMatchObject({ status: 'published' });
  });

  it('쓸 줄이 없으면 Medusa 호출 없이 버전만 올린다', async () => {
    const { worker, upserts, medusa } = setup({ writes: [] });
    await worker.processClaimed(claim());
    expect(medusa.setLineItemReservations).not.toHaveBeenCalled();
    expect(upserts[0].v.appliedVersion).toBe(5);
  });

  it('not_managed·not_found 는 성공', async () => {
    const { worker, inboxUpdates, upserts } = setup({
      results: [
        { lineItemId: 'a', outcome: 'not_managed', quantityBefore: 0, quantityAfter: 0 },
        { lineItemId: 'b', outcome: 'not_found', quantityBefore: 0, quantityAfter: 0 },
      ],
    });
    await worker.processClaimed(claim());
    expect(upserts).toHaveLength(1);
    expect(inboxUpdates[0]).toMatchObject({ status: 'published' });
  });

  it('deferred — 버전 유지, 60초 뒤 재시도, attempts 불변', async () => {
    const { worker, inboxUpdates, upserts } = setup({
      results: [{ lineItemId: 'li', outcome: 'deferred', quantityBefore: 2, quantityAfter: 2 }],
    });
    const before = Date.now();
    await worker.processClaimed(claim({}, 4)); // claim 이 3 → 4 로 올린 뒤
    expect(upserts).toHaveLength(0);
    expect(inboxUpdates[0]).toMatchObject({ status: 'pending', attempts: 3 });
    expect(inboxUpdates[0].nextAttemptAt!.getTime() - before).toBeGreaterThanOrEqual(59_000);
  });

  it('error 결과 — attempts+1 로 재시도, 버전 유지', async () => {
    const { worker, inboxUpdates, upserts } = setup({
      results: [{ lineItemId: 'li', outcome: 'error', quantityBefore: 0, quantityAfter: 0, message: 'boom' }],
    });
    await worker.processClaimed(claim({}, 3));
    expect(upserts).toHaveLength(0);
    expect(inboxUpdates[0]).toMatchObject({ status: 'pending', attempts: 3 });
  });

  it('클라이언트가 던지면 재시도하고, 상한(env)에 닿으면 failed', async () => {
    process.env.RESERVATION_PROJECTION_MAX_RETRIES = '3';
    const a = setup({ throws: new Error('timeout') });
    await a.worker.processClaimed(claim({}, 2));
    expect(a.inboxUpdates[0]).toMatchObject({ status: 'pending', attempts: 2 });

    const b = setup({ throws: new Error('timeout') });
    await b.worker.processClaimed(claim({}, 3));
    expect(b.inboxUpdates[0]).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('200줄 넘는 쓰기는 여러 번에 나눠 부른다', async () => {
    const writes: Write[] = Array.from({ length: 450 }, (_, i) => ({ lineItemId: `li${i}`, quantity: 1, allowDecrease: true }));
    const { worker, medusa, upserts } = setup({ writes, results: [] });
    await worker.processClaimed(claim());
    expect(medusa.setLineItemReservations).toHaveBeenCalledTimes(3);
    expect(medusa.setLineItemReservations.mock.calls.map((c: Write[][]) => c[0].length)).toEqual([200, 200, 50]);
    expect(upserts).toHaveLength(1);
  });

  it('같은 배치에 error 와 deferred 가 섞이면 error 로 센다', async () => {
    const { worker, inboxUpdates, upserts } = setup({
      results: [
        { lineItemId: 'a', outcome: 'deferred', quantityBefore: 1, quantityAfter: 1 },
        { lineItemId: 'b', outcome: 'error', quantityBefore: 0, quantityAfter: 0, message: 'x' },
      ],
    });
    await worker.processClaimed(claim({}, 2));
    expect(upserts).toHaveLength(0);
    expect(inboxUpdates[0]).toMatchObject({ status: 'pending', attempts: 2 });
  });

  it.each([[undefined], ['abc'], ['0'], ['-3']])('상한 env=%s 이면 기본 10 을 쓴다', async (env) => {
    if (env === undefined) delete process.env.RESERVATION_PROJECTION_MAX_RETRIES;
    else process.env.RESERVATION_PROJECTION_MAX_RETRIES = env;
    const nine = setup({ throws: new Error('x') });
    await nine.worker.processClaimed(claim({}, 9));
    expect(nine.inboxUpdates[0]).toMatchObject({ status: 'pending' });
    const ten = setup({ throws: new Error('x') });
    await ten.worker.processClaimed(claim({}, 10));
    expect(ten.inboxUpdates[0]).toMatchObject({ status: 'failed' });
  });
});
