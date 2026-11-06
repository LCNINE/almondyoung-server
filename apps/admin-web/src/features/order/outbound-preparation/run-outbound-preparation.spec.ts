import {
  batchNameFor,
  RETRY_DELAYS_MS,
  runOutboundPreparation,
  type PreparationDeps,
  type PreparationInput,
  type PreparationProgress,
} from './run-outbound-preparation';
import type { BatchResultItem } from '../../../lib/types/dto/fulfillment';

const input: PreparationInput = {
  warehouseId: 'w1',
  shipmentIds: ['s1', 's2', 's3'],
  pickingMethod: 'total_picking',
  now: new Date('2026-11-05T00:30:00Z'),
};

function waybill(
  shipmentId: string,
  status = 'registered',
  reason: string | null = null
): BatchResultItem {
  return { shipmentId, status, reason, trackingNo: null, nextAttemptAt: null };
}

function failure(shipmentId: string, transient: boolean) {
  return {
    shipmentId,
    transient,
    code: 'FAILED',
    message: '처리하지 못했어요.',
  };
}

function makeDeps() {
  let key = 0;

  return {
    planMany: jest
      .fn<
        ReturnType<PreparationDeps['planMany']>,
        Parameters<PreparationDeps['planMany']>
      >()
      .mockImplementation(async (ids) => ({ succeeded: ids, failed: [] })),
    issueWaybills: jest
      .fn<
        ReturnType<PreparationDeps['issueWaybills']>,
        Parameters<PreparationDeps['issueWaybills']>
      >()
      .mockImplementation(async (ids) => ids.map((id) => waybill(id))),
    createBatch: jest
      .fn<
        ReturnType<PreparationDeps['createBatch']>,
        Parameters<PreparationDeps['createBatch']>
      >()
      .mockResolvedValue({ id: 'b1' }),
    addManyToBatch: jest
      .fn<
        ReturnType<PreparationDeps['addManyToBatch']>,
        Parameters<PreparationDeps['addManyToBatch']>
      >()
      .mockImplementation(async (_, ids) => ({ succeeded: ids, failed: [] })),
    sleep: jest
      .fn<
        ReturnType<PreparationDeps['sleep']>,
        Parameters<PreparationDeps['sleep']>
      >()
      .mockResolvedValue(undefined),
    newKey: jest.fn(() => `key-${++key}`),
  } satisfies PreparationDeps;
}

describe('runOutboundPreparation', () => {
  it('prepares three shipments and reports immutable progress snapshots', async () => {
    const deps = makeDeps();
    const progress: PreparationProgress[] = [];
    const result = await runOutboundPreparation(deps, input, (p) =>
      progress.push(p)
    );

    expect(result).toEqual({
      stage: 'join',
      retrying: false,
      planned: 3,
      waybilled: 3,
      joined: 3,
      total: 3,
      batchId: 'b1',
      batchName: '11/05 토탈피킹 09:30',
      failures: [],
    });
    expect(deps.createBatch).toHaveBeenCalledTimes(1);
    expect(deps.createBatch).toHaveBeenCalledWith({
      warehouseId: 'w1',
      pickingMethod: 'total_picking',
      name: '11/05 토탈피킹 09:30',
    });
    expect(progress[0]).toMatchObject({ stage: 'plan', planned: 0, joined: 0 });
    expect(progress.at(-1)).toEqual(result);
    expect([...new Set(progress.map((p) => p.stage))]).toEqual([
      'plan',
      'waybill',
      'batch',
      'join',
    ]);
    expect(deps.planMany.mock.calls[0][1]).not.toBe(
      deps.issueWaybills.mock.calls[0][1]
    );
    expect(deps.issueWaybills.mock.calls[0][1]).not.toBe(
      deps.addManyToBatch.mock.calls[0][2]
    );
  });

  it('excludes permanent planning failures from waybill issuance', async () => {
    const deps = makeDeps();
    deps.planMany.mockResolvedValue({
      succeeded: ['s1', 's2'],
      failed: [failure('s3', false)],
    });

    const result = await runOutboundPreparation(deps, input, jest.fn());

    expect(deps.issueWaybills).toHaveBeenCalledWith(
      ['s1', 's2'],
      expect.any(String)
    );
    expect(result.failures).toEqual([
      { shipmentId: 's3', stage: 'plan', message: '처리하지 못했어요.' },
    ]);
    expect(result.joined).toBe(2);
  });

  it('retries only transient planning failures twice with the same key', async () => {
    const deps = makeDeps();
    deps.planMany
      .mockResolvedValueOnce({
        succeeded: ['s1', 's2'],
        failed: [failure('s3', true)],
      })
      .mockResolvedValueOnce({ succeeded: [], failed: [failure('s3', true)] });
    const progress = jest.fn();

    const result = await runOutboundPreparation(deps, input, progress);

    expect(deps.sleep.mock.calls).toEqual([[2000], [5000]]);
    expect(deps.planMany.mock.calls).toEqual([
      [input.shipmentIds, 'key-1'],
      [['s3'], 'key-1'],
      [['s3'], 'key-1'],
    ]);
    expect(result).toMatchObject({
      planned: 3,
      joined: 3,
      retrying: false,
      failures: [],
    });
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'plan', retrying: true, planned: 2 })
    );
  });

  it('immediately retries time-budget-exceeded with the same key and subset', async () => {
    const deps = makeDeps();
    deps.issueWaybills.mockResolvedValueOnce([
      waybill('s1'),
      waybill('s2', 'used'),
      waybill('s3', 'pending', 'time-budget-exceeded'),
    ]);

    const result = await runOutboundPreparation(deps, input, jest.fn());

    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.issueWaybills.mock.calls).toEqual([
      [input.shipmentIds, 'key-2'],
      [['s3'], 'key-2'],
    ]);
    expect(result.waybilled).toBe(3);
  });

  it('does not create a batch when all waybills failed', async () => {
    const deps = makeDeps();
    deps.issueWaybills.mockResolvedValue(
      input.shipmentIds.map((id) => waybill(id, 'failed', '발급하지 못했어요.'))
    );

    const result = await runOutboundPreparation(deps, input, jest.fn());

    expect(deps.createBatch).not.toHaveBeenCalled();
    expect(deps.addManyToBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      batchId: null,
      batchName: null,
      waybilled: 0,
    });
    expect(result.failures.map((f) => f.stage)).toEqual([
      'waybill',
      'waybill',
      'waybill',
    ]);
  });

  it('joins the existing batch without creating another', async () => {
    const deps = makeDeps();
    const result = await runOutboundPreparation(
      deps,
      { ...input, existingBatchId: 'b1' },
      jest.fn()
    );

    expect(deps.createBatch).not.toHaveBeenCalled();
    expect(deps.addManyToBatch).toHaveBeenCalledWith(
      'b1',
      input.shipmentIds,
      expect.any(String)
    );
    expect(result).toMatchObject({ batchId: 'b1', joined: 3, batchName: null });
  });

  it('records the fourth transient failure after exactly three retries', async () => {
    const deps = makeDeps();
    deps.planMany.mockResolvedValue({
      succeeded: [],
      failed: input.shipmentIds.map((id) => failure(id, true)),
    });

    const result = await runOutboundPreparation(deps, input, jest.fn());

    expect(RETRY_DELAYS_MS).toEqual([2000, 5000, 10000]);
    expect(deps.sleep.mock.calls).toEqual([[2000], [5000], [10000]]);
    expect(deps.planMany).toHaveBeenCalledTimes(4);
    expect(deps.issueWaybills).not.toHaveBeenCalled();
    expect(result.failures).toHaveLength(3);
    expect(result.retrying).toBe(false);
  });

  it.each([
    new TypeError('Failed to fetch'),
    { statusCode: 503, message: '잠시 후 다시 시도해요.' },
  ])('retries network and server exceptions: %s', async (error) => {
    const deps = makeDeps();
    deps.planMany.mockRejectedValueOnce(error);
    deps.issueWaybills.mockRejectedValueOnce(error);
    deps.createBatch.mockRejectedValueOnce(error);
    deps.addManyToBatch.mockRejectedValueOnce(error);

    const result = await runOutboundPreparation(
      deps,
      { ...input, cartCapacity: 4 },
      jest.fn()
    );

    expect(deps.sleep.mock.calls).toEqual([[2000], [2000], [2000], [2000]]);
    expect(deps.createBatch.mock.calls[0]).toEqual(
      deps.createBatch.mock.calls[1]
    );
    expect(deps.createBatch.mock.calls[0][0].cartCapacity).toBe(4);
    expect(result).toMatchObject({ joined: 3, failures: [] });
  });

  it('records permanent batch creation errors for every eligible shipment without retrying', async () => {
    const deps = makeDeps();
    deps.createBatch.mockRejectedValue({
      response: { status: 403, data: { message: '권한이 없어요.' } },
    });

    const result = await runOutboundPreparation(deps, input, jest.fn());

    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.addManyToBatch).not.toHaveBeenCalled();
    expect(result.batchId).toBeNull();
    expect(result.failures).toEqual(
      input.shipmentIds.map((shipmentId) => ({
        shipmentId,
        stage: 'batch',
        message: '권한이 없어요.',
      }))
    );
  });

  it('keeps the batch and retries only transient join failures with one key', async () => {
    const deps = makeDeps();
    deps.addManyToBatch.mockResolvedValueOnce({
      succeeded: ['s1'],
      failed: [failure('s2', false), failure('s3', true)],
    });

    const result = await runOutboundPreparation(deps, input, jest.fn());

    expect(deps.addManyToBatch.mock.calls).toEqual([
      ['b1', input.shipmentIds, 'key-4'],
      ['b1', ['s3'], 'key-4'],
    ]);
    expect(result).toMatchObject({ batchId: 'b1', joined: 2 });
    expect(result.failures).toEqual([
      { shipmentId: 's2', stage: 'join', message: '처리하지 못했어요.' },
    ]);
  });

  it('drains immediate waybill continuations before delayed pending retries without using the retry budget', async () => {
    const deps = makeDeps();
    deps.issueWaybills
      .mockResolvedValueOnce([
        waybill('s1'),
        waybill('s2', 'pending', 'busy'),
        waybill('s3', 'pending', 'time-budget-exceeded'),
      ])
      .mockResolvedValueOnce([waybill('s3', 'pending', 'time-budget-exceeded')])
      .mockResolvedValueOnce([waybill('s3', 'pending', 'time-budget-exceeded')])
      .mockResolvedValueOnce([waybill('s3', 'pending', 'time-budget-exceeded')])
      .mockResolvedValueOnce([waybill('s3')])
      .mockResolvedValueOnce([waybill('s2', 'pending', 'busy')])
      .mockResolvedValueOnce([waybill('s2', 'pending', 'busy')])
      .mockResolvedValueOnce([waybill('s2', 'pending', 'busy')]);

    const result = await runOutboundPreparation(deps, input, jest.fn());

    expect(deps.issueWaybills.mock.calls.map(([ids]) => ids)).toEqual([
      input.shipmentIds,
      ['s3'],
      ['s3'],
      ['s3'],
      ['s3'],
      ['s2'],
      ['s2'],
      ['s2'],
    ]);
    expect(
      new Set(deps.issueWaybills.mock.calls.map(([, key]) => key)).size
    ).toBe(1);
    expect(deps.sleep.mock.calls).toEqual([[2000], [5000], [10000]]);
    expect(result).toMatchObject({ waybilled: 2, joined: 2 });
    expect(result.failures).toEqual([
      { shipmentId: 's2', stage: 'waybill', message: 'busy' },
    ]);
  });

  it('does not treat omitted results or allocated waybills as success', async () => {
    const deps = makeDeps();
    deps.planMany.mockResolvedValue({ succeeded: ['s1', 's2'], failed: [] });
    deps.issueWaybills.mockResolvedValue([waybill('s1', 'allocated')]);

    const result = await runOutboundPreparation(deps, input, jest.fn());

    expect(
      result.failures.map(({ shipmentId, stage }) => ({ shipmentId, stage }))
    ).toEqual([
      { shipmentId: 's3', stage: 'plan' },
      { shipmentId: 's1', stage: 'waybill' },
      { shipmentId: 's2', stage: 'waybill' },
    ]);
    expect(deps.createBatch).not.toHaveBeenCalled();
  });

  it('makes no requests for empty input', async () => {
    const deps = makeDeps();
    const result = await runOutboundPreparation(
      deps,
      { ...input, shipmentIds: [] },
      jest.fn()
    );

    expect(deps.planMany).not.toHaveBeenCalled();
    expect(deps.createBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      total: 0,
      joined: 0,
      failures: [],
      retrying: false,
    });
  });
});

describe('batchNameFor', () => {
  it.each([
    ['total_picking', '토탈피킹'],
    ['individual', '개별피킹'],
    ['multi_order', '멀티오더'],
  ] as const)('formats %s in Asia/Seoul', (method, label) => {
    expect(batchNameFor(input.now, method)).toBe(`11/05 ${label} 09:30`);
    expect(batchNameFor(new Date('2026-12-31T15:05:00Z'), method)).toBe(
      `01/01 ${label} 00:05`
    );
  });
});
