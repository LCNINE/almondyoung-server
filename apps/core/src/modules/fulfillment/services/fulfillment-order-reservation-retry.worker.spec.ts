import { ConflictException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { FulfillmentOrderReservationRetryWorker } from './fulfillment-order-reservation-retry.worker';

describe('FulfillmentOrderReservationRetryWorker', () => {
  const foId1 = '11111111-1111-1111-1111-111111111111';
  const foId2 = '22222222-2222-2222-2222-222222222222';
  const foiId1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const foiId2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  function makeWorker(options: {
    candidates?: Array<{ id: string }>;
    // retryOne의 FOI 조회 결과 — select 호출 순서대로 pop
    itemsPerCall?: Array<Array<{ id: string; qty: number; reservedQty: number }>>;
    reserveImpl?: jest.Mock;
    shouldRunReservationRetry?: boolean;
  }) {
    const candidates = options.candidates ?? [];
    const itemsQueue = [...(options.itemsPerCall ?? [])];

    const db = {
      db: {
        selectDistinct: jest.fn(() => ({
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                where: () => ({
                  orderBy: () => ({
                    limit: () => Promise.resolve(candidates),
                  }),
                }),
              }),
            }),
          }),
        })),
        select: jest.fn(() => ({
          from: () => ({
            where: () => ({
              orderBy: () => Promise.resolve(itemsQueue.shift() ?? []),
            }),
          }),
        })),
      },
    };

    const reservations = {
      reserve: options.reserveImpl ?? jest.fn().mockResolvedValue({}),
    };
    const workflowGate = {
      shouldRunReservationRetry: jest.fn(() => options.shouldRunReservationRetry ?? true),
    };

    const worker = new FulfillmentOrderReservationRetryWorker(
      db as never,
      reservations as never,
      workflowGate as never,
    );
    return { worker, db, reservations, workflowGate };
  }

  it('후보가 없으면 reserve를 호출하지 않는다', async () => {
    const { worker, reservations } = makeWorker({ candidates: [] });

    await worker.retryUnfulfillable();

    expect(reservations.reserve).not.toHaveBeenCalled();
  });

  it('부족 FOI마다 부족분(qty - reservedQty)만큼 reserve를 호출하고, 부족분 0인 FOI는 건너뛴다', async () => {
    const { worker, reservations } = makeWorker({
      candidates: [{ id: foId1 }],
      itemsPerCall: [
        [
          { id: foiId1, qty: 3, reservedQty: 1 },
          { id: foiId2, qty: 2, reservedQty: 2 },
        ],
      ],
    });

    await worker.retryUnfulfillable();

    expect(reservations.reserve).toHaveBeenCalledTimes(1);
    expect(reservations.reserve).toHaveBeenCalledWith(
      foId1,
      { fulfillmentOrderItemId: foiId1, quantity: 2 },
      undefined,
    );
  });

  it('재고 부족(Conflict)으로 한 FOI가 실패해도 나머지 FOI는 계속 시도한다', async () => {
    const reserveImpl = jest
      .fn()
      .mockRejectedValueOnce(new ConflictException('Insufficient stock'))
      .mockResolvedValueOnce({});
    const { worker, reservations } = makeWorker({
      candidates: [{ id: foId1 }],
      itemsPerCall: [
        [
          { id: foiId1, qty: 1, reservedQty: 0 },
          { id: foiId2, qty: 1, reservedQty: 0 },
        ],
      ],
      reserveImpl,
    });

    await worker.retryUnfulfillable();

    expect(reservations.reserve).toHaveBeenCalledTimes(2);
    expect(reservations.reserve).toHaveBeenNthCalledWith(
      2,
      foId1,
      { fulfillmentOrderItemId: foiId2, quantity: 1 },
      undefined,
    );
  });

  it('한 FO에서 예기치 못한 에러가 나도 다음 후보 FO는 계속 처리한다', async () => {
    const reserveImpl = jest.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({});
    const { worker, reservations } = makeWorker({
      candidates: [{ id: foId1 }, { id: foId2 }],
      itemsPerCall: [[{ id: foiId1, qty: 1, reservedQty: 0 }], [{ id: foiId2, qty: 1, reservedQty: 0 }]],
      reserveImpl,
    });

    await worker.retryUnfulfillable();

    expect(reservations.reserve).toHaveBeenCalledTimes(2);
    expect(reservations.reserve).toHaveBeenNthCalledWith(
      2,
      foId2,
      { fulfillmentOrderItemId: foiId2, quantity: 1 },
      undefined,
    );
  });

  it('이전 주기가 아직 실행 중이면 건너뛴다', async () => {
    let resolveCandidates!: (rows: Array<{ id: string }>) => void;
    const pending = new Promise<Array<{ id: string }>>((resolve) => {
      resolveCandidates = resolve;
    });

    const db = {
      db: {
        selectDistinct: jest.fn(() => ({
          from: () => ({
            innerJoin: () => ({
              innerJoin: () => ({
                where: () => ({
                  orderBy: () => ({
                    limit: () => pending,
                  }),
                }),
              }),
            }),
          }),
        })),
        select: jest.fn(),
      },
    };
    const reservations = { reserve: jest.fn() };
    const workflowGate = { shouldRunReservationRetry: jest.fn().mockReturnValue(true) };
    const worker = new FulfillmentOrderReservationRetryWorker(
      db as never,
      reservations as never,
      workflowGate as never,
    );

    const first = worker.retryUnfulfillable();
    await worker.retryUnfulfillable(); // 두 번째 호출은 가드에 걸려 즉시 반환

    expect(db.db.selectDistinct).toHaveBeenCalledTimes(1);

    resolveCandidates([]);
    await first;
  });

  it('maintenance에서는 후보 조회와 직접 재시도를 모두 중지한다', async () => {
    const { worker, db, reservations } = makeWorker({
      candidates: [{ id: foId1 }],
      shouldRunReservationRetry: false,
    });

    await worker.retryUnfulfillable();
    await expect(worker.findCandidates(20)).resolves.toEqual([]);
    await worker.retryOne(foId1);

    expect(db.db.selectDistinct).not.toHaveBeenCalled();
    expect(db.db.select).not.toHaveBeenCalled();
    expect(reservations.reserve).not.toHaveBeenCalled();
  });

  it('V2 후보 공정성은 confirmed와 short-pick released 수요의 requestedAt을 함께 사용한다', async () => {
    let capturedQuery: unknown;
    const db = {
      db: {
        execute: jest.fn((query: unknown) => {
          capturedQuery = query;
          return Promise.resolve([]);
        }),
      },
    };
    const workflowGate = {
      shouldRunReservationRetry: jest.fn(() => true),
      getMode: jest.fn(() => 'v2'),
    };
    const worker = new FulfillmentOrderReservationRetryWorker(
      db as never,
      { reserve: jest.fn() } as never,
      workflowGate as never,
    );

    await expect(worker.findCandidates(20)).resolves.toEqual([]);
    const rendered = new PgDialect().sqlToQuery(capturedQuery as never).sql.replace(/\s+/g, ' ');
    expect(rendered).toContain("reservation.status = 'confirmed'");
    expect(rendered).toContain("reservation.status = 'released'");
    expect(rendered).toContain("reservation.state_reason LIKE 'short-pick:%'");
  });
});
