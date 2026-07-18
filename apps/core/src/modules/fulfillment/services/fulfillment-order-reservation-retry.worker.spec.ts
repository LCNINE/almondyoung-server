import { PgDialect } from 'drizzle-orm/pg-core';
import { FulfillmentOrderReservationRetryWorker } from './fulfillment-order-reservation-retry.worker';

describe('FulfillmentOrderReservationRetryWorker', () => {
  const lineId1 = '11111111-1111-1111-1111-111111111111';
  const lineId2 = '22222222-2222-2222-2222-222222222222';

  function makeWorker(options: {
    candidates?: Array<{ id: string }>;
    // retryOne 의 shipment line 조회 결과 — select 호출 순서대로 pop
    linesPerCall?: Array<Array<{ qty: number }>>;
    reservePartialImpl?: jest.Mock;
    shouldRunReservationRetry?: boolean;
  }) {
    const linesQueue = [...(options.linesPerCall ?? [])];

    const db = {
      db: {
        execute: jest.fn(() => Promise.resolve(options.candidates ?? [])),
        select: jest.fn(() => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve(linesQueue.shift() ?? []),
            }),
          }),
        })),
      },
    };

    const shipmentReservations = {
      reservePartial: options.reservePartialImpl ?? jest.fn().mockResolvedValue({ mutated: false, reservedQty: 0 }),
    };
    const workflowGate = {
      shouldRunReservationRetry: jest.fn(() => options.shouldRunReservationRetry ?? true),
    };

    const worker = new FulfillmentOrderReservationRetryWorker(
      db as never,
      workflowGate as never,
      shipmentReservations as never,
    );
    return { worker, db, shipmentReservations, workflowGate };
  }

  it('후보가 없으면 reservePartial을 호출하지 않는다', async () => {
    const { worker, shipmentReservations } = makeWorker({ candidates: [] });

    await worker.retryUnfulfillable();

    expect(shipmentReservations.reservePartial).not.toHaveBeenCalled();
  });

  it('후보 shipment line마다 라인 qty로 reservePartial을 호출한다', async () => {
    const { worker, shipmentReservations } = makeWorker({
      candidates: [{ id: lineId1 }],
      linesPerCall: [[{ qty: 3 }]],
    });

    await worker.retryUnfulfillable();

    expect(shipmentReservations.reservePartial).toHaveBeenCalledTimes(1);
    expect(shipmentReservations.reservePartial).toHaveBeenCalledWith(lineId1, 3, undefined);
  });

  it('사라진 라인(조회 0건)은 건너뛰고 다음 후보를 계속 처리한다', async () => {
    const { worker, shipmentReservations } = makeWorker({
      candidates: [{ id: lineId1 }, { id: lineId2 }],
      linesPerCall: [[], [{ qty: 2 }]],
    });

    await worker.retryUnfulfillable();

    expect(shipmentReservations.reservePartial).toHaveBeenCalledTimes(1);
    expect(shipmentReservations.reservePartial).toHaveBeenCalledWith(lineId2, 2, undefined);
  });

  it('한 라인에서 예기치 못한 에러가 나도 다음 후보 라인은 계속 처리한다', async () => {
    const reservePartialImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ mutated: true, reservedQty: 1 });
    const { worker, shipmentReservations } = makeWorker({
      candidates: [{ id: lineId1 }, { id: lineId2 }],
      linesPerCall: [[{ qty: 1 }], [{ qty: 1 }]],
      reservePartialImpl,
    });

    await worker.retryUnfulfillable();

    expect(shipmentReservations.reservePartial).toHaveBeenCalledTimes(2);
    expect(shipmentReservations.reservePartial).toHaveBeenNthCalledWith(2, lineId2, 1, undefined);
  });

  it('이전 주기가 아직 실행 중이면 건너뛴다', async () => {
    let resolveCandidates!: (rows: Array<{ id: string }>) => void;
    const pending = new Promise<Array<{ id: string }>>((resolve) => {
      resolveCandidates = resolve;
    });

    const db = {
      db: {
        execute: jest.fn(() => pending),
        select: jest.fn(),
      },
    };
    const shipmentReservations = { reservePartial: jest.fn() };
    const workflowGate = { shouldRunReservationRetry: jest.fn().mockReturnValue(true) };
    const worker = new FulfillmentOrderReservationRetryWorker(
      db as never,
      workflowGate as never,
      shipmentReservations as never,
    );

    const first = worker.retryUnfulfillable();
    await worker.retryUnfulfillable(); // 두 번째 호출은 가드에 걸려 즉시 반환

    expect(db.db.execute).toHaveBeenCalledTimes(1);

    resolveCandidates([]);
    await first;
  });

  it('maintenance에서는 후보 조회와 직접 재시도를 모두 중지한다', async () => {
    const { worker, db, shipmentReservations } = makeWorker({
      candidates: [{ id: lineId1 }],
      shouldRunReservationRetry: false,
    });

    await worker.retryUnfulfillable();
    await expect(worker.findCandidates(20)).resolves.toEqual([]);
    await worker.retryOne(lineId1);

    expect(db.db.execute).not.toHaveBeenCalled();
    expect(db.db.select).not.toHaveBeenCalled();
    expect(shipmentReservations.reservePartial).not.toHaveBeenCalled();
  });

  it('후보 공정성은 confirmed와 short-pick released 수요의 requestedAt을 함께 사용한다', async () => {
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
    };
    const worker = new FulfillmentOrderReservationRetryWorker(
      db as never,
      workflowGate as never,
      { reservePartial: jest.fn() } as never,
    );

    await expect(worker.findCandidates(20)).resolves.toEqual([]);
    const rendered = new PgDialect().sqlToQuery(capturedQuery as never).sql.replace(/\s+/g, ' ');
    expect(rendered).toContain("reservation.status = 'confirmed'");
    expect(rendered).toContain("reservation.status = 'released'");
    expect(rendered).toContain("reservation.state_reason LIKE 'short-pick:%'");
  });
});
