import { ConflictException } from '@nestjs/common';
import { startBatchPicking } from './batch-start';
import * as locks from './allocation.locks';
import { BatchStartDeps } from './allocation.types';

jest.mock('./allocation.locks');
const mockedLocks = locks as jest.Mocked<typeof locks>;

type Row = Record<string, unknown>;

/** select 체인이 호출 순서대로 rows 를 돌려주는 가짜 trx. insert/update 는 기록만 한다. */
function fakeTrx(selectResults: Row[][]) {
  const inserted: Row[][] = [];
  const updated: Row[] = [];
  const queue = [...selectResults];
  const chain = (rows: Row[]) => {
    const promise = Promise.resolve(rows);
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      orderBy: () => self,
      limit: () => self,
      for: () => promise,
      then: promise.then.bind(promise),
    };
    return self;
  };
  const trx = {
    select: () => chain(queue.shift() ?? []),
    insert: () => ({
      values: (values: Row[]) => {
        inserted.push(values);
        return { returning: async () => values.map((value, index) => ({ id: `alloc-${index + 1}`, ...value })) };
      },
    }),
    update: () => ({
      set: (value: Row) => ({
        where: () => ({
          returning: async () => {
            updated.push(value);
            return [{ id: 'batch-1' }];
          },
        }),
      }),
    }),
  };
  return { trx, inserted, updated };
}

function deps(startSession = jest.fn(async () => ({ id: 'session-1', status: 'active' }))) {
  return {
    commands: {
      execute: jest.fn(async (_request, handler) => (await handler(trxHolder.trx, 'cmd-1', 'hash')).response),
    },
    workflowGate: { assertV2MutationAllowed: jest.fn() },
    sessions: { startSession },
    invariant: {},
    controlledStock: {},
    waybills: {},
  } as unknown as BatchStartDeps & { sessions: { startSession: jest.Mock } };
}

const trxHolder: { trx: unknown } = { trx: undefined };

const aggregate = {
  batch: { id: 'batch-1', warehouseId: 'wh-1', startedAt: null },
  shipments: [],
  lines: [
    { id: 'line-1', shipmentId: 'shp-1', skuId: 'sku-1', qty: 2 },
    { id: 'line-2', shipmentId: 'shp-2', skuId: 'sku-1', qty: 1 },
  ],
  workItems: [
    { id: 'wi-1', shipmentId: 'shp-1', status: 'queued' },
    { id: 'wi-2', shipmentId: 'shp-2', status: 'queued' },
  ],
};

beforeEach(() => {
  jest.resetAllMocks();
  mockedLocks.lockAggregate.mockResolvedValue(aggregate as never);
  mockedLocks.assertStartEligibility.mockResolvedValue([]);
  mockedLocks.lockSourceCapacities.mockResolvedValue({
    capacities: [
      { skuId: 'sku-1', sourceLocationId: 'loc-1', locationCode: 'A-01', stockVersion: 4, remainingQty: 10 },
    ],
    inboundPendingBySku: new Map(),
  });
  mockedLocks.describeStartBlockers.mockImplementation(async (_trx, blockers) =>
    blockers.map((blocker) => ({ ...blocker, trackingNo: null, skuCode: null, skuName: null })),
  );
});

describe('startBatchPicking', () => {
  it('queued 작업 항목 전부를 배정하고 그 배정으로 세션을 시작한 뒤 배치 시작 시각을 적는다', async () => {
    const fake = fakeTrx([
      [{ id: 'batch-1', startedAt: null }], // 배치 조회
      [{ shipmentId: 'shp-1' }, { shipmentId: 'shp-2' }], // queued 작업 항목
    ]);
    trxHolder.trx = fake.trx;
    const d = deps();
    const result = await startBatchPicking(d, 'discrete', {
      batchId: 'batch-1',
      actorId: 'actor-1',
      idempotencyKey: 'k',
    });

    expect(result).toEqual({
      state: 'started',
      operationId: 'cmd-1',
      batchId: 'batch-1',
      sessionId: 'session-1',
      status: 'active',
    });
    expect(fake.inserted[0]).toEqual([
      { workItemId: 'wi-1', shipmentLineId: 'line-1', sourceLocationId: 'loc-1', qty: 2, sourceStockVersion: 4 },
      { workItemId: 'wi-2', shipmentLineId: 'line-2', sourceLocationId: 'loc-1', qty: 1, sourceStockVersion: 4 },
    ]);
    expect(d.sessions.startSession).toHaveBeenCalledWith(
      {
        batchId: 'batch-1',
        actorId: 'actor-1',
        allocations: [
          {
            id: 'alloc-1',
            workItemId: 'wi-1',
            shipmentLineId: 'line-1',
            skuId: 'sku-1',
            sourceLocationId: 'loc-1',
            quantity: 2,
            sourceStockVersion: 4,
          },
          {
            id: 'alloc-2',
            workItemId: 'wi-2',
            shipmentLineId: 'line-2',
            skuId: 'sku-1',
            sourceLocationId: 'loc-1',
            quantity: 1,
            sourceStockVersion: 4,
          },
        ],
      },
      fake.trx,
    );
    expect(fake.updated).toHaveLength(1);
  });

  it('단독 claim 으로 picking 인 작업 항목도 queued 와 함께 배정한다', async () => {
    mockedLocks.lockAggregate.mockResolvedValue({
      ...aggregate,
      workItems: [
        { id: 'wi-1', shipmentId: 'shp-1', status: 'queued' },
        { id: 'wi-2', shipmentId: 'shp-2', status: 'picking' },
      ],
    } as never);
    const fake = fakeTrx([
      [{ id: 'batch-1', startedAt: null }],
      [{ shipmentId: 'shp-1' }, { shipmentId: 'shp-2' }], // queued·picking 작업 항목
    ]);
    trxHolder.trx = fake.trx;
    await startBatchPicking(deps(), 'discrete', { batchId: 'batch-1', actorId: 'actor-1', idempotencyKey: 'k' });

    expect(mockedLocks.assertStartEligibility).toHaveBeenCalledWith(fake.trx, expect.anything(), expect.anything(), [
      'shp-1',
      'shp-2',
    ]);
    expect(fake.inserted[0]).toEqual([
      expect.objectContaining({ workItemId: 'wi-1', shipmentLineId: 'line-1' }),
      expect.objectContaining({ workItemId: 'wi-2', shipmentLineId: 'line-2' }),
    ]);
  });

  it('이미 시작된 배치는 활성 세션을 그대로 돌려주고 배정·인계를 하지 않는다', async () => {
    const fake = fakeTrx([
      [{ id: 'batch-1', startedAt: new Date() }],
      [{ id: 'session-9', status: 'active' }], // 활성 세션
    ]);
    trxHolder.trx = fake.trx;
    const d = deps();
    const result = await startBatchPicking(d, 'discrete', { batchId: 'batch-1', actorId: 'a', idempotencyKey: 'k2' });
    expect(result).toMatchObject({ state: 'started', sessionId: 'session-9' });
    expect(fake.inserted).toHaveLength(0);
    expect(d.sessions.startSession).not.toHaveBeenCalled();
  });

  it('시작할 작업 항목(queued·picking)이 없으면 PICKING_BATCH_EMPTY', async () => {
    trxHolder.trx = fakeTrx([[{ id: 'batch-1', startedAt: null }], []]).trx;
    await expect(
      startBatchPicking(deps(), 'discrete', { batchId: 'batch-1', actorId: 'a', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ response: { code: 'PICKING_BATCH_EMPTY' } });
  });

  it.each(['completed', 'canceled'])('%s 배치는 시작하지 않는다(OUTBOUND_BATCH_NOT_STARTABLE)', async (status) => {
    const fake = fakeTrx([[{ id: 'batch-1', startedAt: null, status }]]);
    trxHolder.trx = fake.trx;
    const d = deps();
    await expect(
      startBatchPicking(d, 'discrete', { batchId: 'batch-1', actorId: 'a', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ response: { code: 'OUTBOUND_BATCH_NOT_STARTABLE' } });
    expect(mockedLocks.lockAggregate).not.toHaveBeenCalled();
    expect(fake.inserted).toHaveLength(0);
    expect(d.sessions.startSession).not.toHaveBeenCalled();
  });

  it('잠금을 기다리는 사이 배치가 끝났으면 잠근 행으로 다시 막는다', async () => {
    mockedLocks.lockAggregate.mockResolvedValue({
      ...aggregate,
      batch: { ...aggregate.batch, status: 'canceled' },
    } as never);
    const fake = fakeTrx([
      [{ id: 'batch-1', startedAt: null, status: 'created' }],
      [{ shipmentId: 'shp-1' }, { shipmentId: 'shp-2' }],
    ]);
    trxHolder.trx = fake.trx;
    await expect(
      startBatchPicking(deps(), 'discrete', { batchId: 'batch-1', actorId: 'a', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ response: { code: 'OUTBOUND_BATCH_NOT_STARTABLE' } });
    expect(fake.inserted).toHaveLength(0);
  });

  it('시작 전 배치에 옛 코드가 연 세션이 열려 있으면 PICKING_BATCH_STATE_CORRUPT 이고 배정하지 않는다', async () => {
    const fake = fakeTrx([
      [{ id: 'batch-1', startedAt: null, status: 'picking' }],
      [{ shipmentId: 'shp-1' }, { shipmentId: 'shp-2' }],
      [{ id: 'legacy-session' }], // 열린 세션
    ]);
    trxHolder.trx = fake.trx;
    const d = deps();
    await expect(
      startBatchPicking(d, 'discrete', { batchId: 'batch-1', actorId: 'a', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ response: { code: 'PICKING_BATCH_STATE_CORRUPT' } });
    expect(fake.inserted).toHaveLength(0);
    expect(d.sessions.startSession).not.toHaveBeenCalled();
  });

  it('모자란 줄이 있으면 배정·세션·started_at 을 아무것도 쓰지 않고 BATCH_START_BLOCKED 로 전부 보고한다', async () => {
    const fake = fakeTrx([[{ id: 'batch-1', startedAt: null }], [{ shipmentId: 'shp-1' }, { shipmentId: 'shp-2' }]]);
    trxHolder.trx = fake.trx;
    mockedLocks.lockSourceCapacities.mockResolvedValue({
      capacities: [],
      inboundPendingBySku: new Map([['sku-1', 2]]),
    });
    mockedLocks.assertStartEligibility.mockResolvedValue([
      {
        shipmentId: 'shp-2',
        reason: 'WAYBILL_NOT_READY',
        shipmentLineId: null,
        skuId: null,
        requiredQty: null,
        shortQty: null,
        detail: 'WAYBILL_STALE: x',
      },
    ]);
    const d = deps();

    const error = await startBatchPicking(d, 'discrete', {
      batchId: 'batch-1',
      actorId: 'actor',
      idempotencyKey: 'k',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    const body = (error as ConflictException).getResponse() as {
      code: string;
      errors: Array<{ shipmentId: string; reason: string }>;
    };
    expect(body.code).toBe('BATCH_START_BLOCKED');
    expect(body.errors.map((b) => [b.shipmentId, b.reason])).toEqual([
      ['shp-1', 'INBOUND_PENDING'],
      ['shp-2', 'STOCK_SHORT'],
      ['shp-2', 'WAYBILL_NOT_READY'],
    ]);
    expect(fake.inserted).toEqual([]);
    expect(fake.updated).toEqual([]);
    expect(d.sessions.startSession).not.toHaveBeenCalled();
  });
});
