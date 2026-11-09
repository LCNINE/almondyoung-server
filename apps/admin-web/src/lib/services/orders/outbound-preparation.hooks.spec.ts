import type { OutboundPreparationSummary } from '@/lib/types/dto/fulfillment';
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query'
  ),
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));
jest.mock('@/lib/api/domains', () => ({
  orders: {
    picking: {},
    outboundBatches: { createV2: jest.fn() },
    outboundPreparation: {
      summary: jest.fn(),
      planMany: jest.fn(),
      issueWaybills: jest.fn(),
      addManyToBatch: jest.fn(),
      splitManyUnreserved: jest.fn(),
    },
  },
}));
jest.mock('sonner', () => ({ toast: {} }));
jest.mock('@/lib/api/domains/orders/daily-status.shape', () => ({}));
jest.mock('@/lib/api/domains/orders/sales-order-amendments.shape', () => ({}));

import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { orders } from '@/lib/api/domains';
import { createIdempotentCommand } from './idempotency';
import {
  useLoadMoreOutboundPreparation,
  useOutboundPreparationSummary,
} from './queries';
import { useRunOutboundPreparation, useSplitUnreservedMany } from './mutations';

describe('outbound preparation hooks', () => {
  const invalidateQueries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    const queryClient = new QueryClient();
    queryClient.invalidateQueries = invalidateQueries;
    jest.mocked(useQueryClient).mockReturnValue(queryClient);
  });

  it.each(['warehouse-1', 'warehouse-2', ''])(
    'scopes summary to warehouse %s and disables empty IDs',
    (warehouseId) => {
      useOutboundPreparationSummary(warehouseId);

      const options = jest.mocked(useQuery).mock.calls[0][0];

      expect(options.queryKey).toEqual(['outbound-preparation', warehouseId]);
      expect(options.enabled).toBe(Boolean(warehouseId));
      if (typeof options.queryFn !== 'function') {
        throw new Error('Missing query function');
      }

      options.queryFn({
        client: useQueryClient(),
        queryKey: options.queryKey,
        signal: new AbortController().signal,
        meta: undefined,
      });
      expect(orders.outboundPreparation.summary).toHaveBeenCalledWith(
        warehouseId
      );
    }
  );

  it('appends only the requested bucket and advances its offset across pages', async () => {
    const queryClient = useQueryClient();
    const shipment = (shipmentId: string) => ({
      shipmentId,
      orderNos: [],
      itemSummary: '',
      totalQty: 1,
      single: true,
      reason: null,
    });
    const summary: OutboundPreparationSummary = {
      warehouseId: 'w1',
      awaitingMatchingCount: 0,
      buckets: [
        {
          bucket: 'ready',
          count: 401,
          singleCount: 401,
          multiCount: 0,
          shipments: Array.from({ length: 200 }, (_, index) =>
            shipment(`s${index}`)
          ),
        },
        {
          bucket: 'partial',
          count: 1,
          singleCount: 1,
          multiCount: 0,
          shipments: [shipment('partial')],
        },
      ],
    };
    queryClient.setQueryData(['outbound-preparation', 'w1'], summary);
    jest
      .mocked(orders.outboundPreparation.summary)
      .mockImplementation(async (_, page) => ({
        ...summary,
        buckets: [
          {
            ...summary.buckets[0],
            shipments: Array.from(
              { length: Math.min(200, 401 - page!.offset) },
              (_, index) => shipment(`s${page!.offset + index}`)
            ),
          },
        ],
      }));
    useLoadMoreOutboundPreparation('w1');

    const options = jest.mocked(useMutation).mock.calls[0][0];
    const context = { client: queryClient, meta: undefined };

    await options.mutationFn!('ready', context);
    await options.mutationFn!('ready', context);
    await options.mutationFn!('ready', context);

    expect(jest.mocked(orders.outboundPreparation.summary).mock.calls).toEqual([
      ['w1', { bucket: 'ready', offset: 200 }],
      ['w1', { bucket: 'ready', offset: 400 }],
    ]);
    const updated = queryClient.getQueryData<OutboundPreparationSummary>([
      'outbound-preparation',
      'w1',
    ])!;

    expect(updated.buckets[0].shipments.map((item) => item.shipmentId)).toEqual(
      Array.from({ length: 401 }, (_, index) => `s${index}`)
    );
    expect(updated.buckets[1]).toEqual(summary.buckets[1]);
    expect(useLoadMoreOutboundPreparation.permission).toEqual([
      'fulfillment.shipment.read',
    ]);
  });

  it('preserves cached rows on failure and ignores pages from a replaced summary', async () => {
    const queryClient = useQueryClient();
    const summary: OutboundPreparationSummary = {
      warehouseId: 'w1',
      awaitingMatchingCount: 0,
      buckets: [
        {
          bucket: 'ready',
          count: 201,
          singleCount: 201,
          multiCount: 0,
          shipments: [],
        },
      ],
    };
    queryClient.setQueryData(['outbound-preparation', 'w1'], summary);
    useLoadMoreOutboundPreparation('w1');

    const options = jest.mocked(useMutation).mock.calls[0][0];
    const context = { client: queryClient, meta: undefined };
    jest
      .mocked(orders.outboundPreparation.summary)
      .mockRejectedValueOnce(new Error('network'));

    await expect(options.mutationFn!('ready', context)).rejects.toThrow(
      'network'
    );
    expect(queryClient.getQueryData(['outbound-preparation', 'w1'])).toEqual(
      summary
    );

    const refreshed = { ...summary, awaitingMatchingCount: 2 };
    jest
      .mocked(orders.outboundPreparation.summary)
      .mockImplementationOnce(async () => {
        queryClient.setQueryData(['outbound-preparation', 'w1'], refreshed);

        return summary;
      });
    await options.mutationFn!('ready', context);

    expect(queryClient.getQueryData(['outbound-preparation', 'w1'])).toEqual(
      refreshed
    );
  });

  it('passes the caller-owned command unchanged and declares warehouse permission', async () => {
    const command = createIdempotentCommand(
      { shipmentIds: ['s-1'] },
      'original-key'
    );
    useSplitUnreservedMany();

    const options = jest.mocked(useMutation).mock.calls[0][0];

    await options.mutationFn!(command, {
      client: useQueryClient(),
      meta: undefined,
    });
    await options.mutationFn!(command, {
      client: useQueryClient(),
      meta: undefined,
    });

    expect(
      orders.outboundPreparation.splitManyUnreserved
    ).toHaveBeenNthCalledWith(1, command);
    expect(
      orders.outboundPreparation.splitManyUnreserved
    ).toHaveBeenNthCalledWith(2, command);
    expect(useSplitUnreservedMany.permission).toEqual([
      'fulfillment.warehouse.operate',
    ]);
  });

  it('wires runner dependencies, preserves the batch retry key, declares permission and refreshes the warehouse', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-05T00:30:00Z') });
    jest
      .mocked(orders.outboundPreparation.planMany)
      .mockResolvedValue({ succeeded: ['s1'], failed: [] });
    jest.mocked(orders.outboundPreparation.issueWaybills).mockResolvedValue([
      {
        shipmentId: 's1',
        status: 'registered',
        trackingNo: null,
        reason: null,
        nextAttemptAt: null,
      },
    ]);
    jest
      .mocked(orders.outboundBatches.createV2)
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValue({ batchId: 'b1', operationId: 'op1' });
    jest
      .mocked(orders.outboundPreparation.addManyToBatch)
      .mockResolvedValue({ succeeded: ['s1'], failed: [] });
    useRunOutboundPreparation();

    const options = jest.mocked(useMutation).mock.calls[0][0];
    const onProgress = jest.fn();
    const context = { client: useQueryClient(), meta: undefined };
    const variables = {
      warehouseId: 'w1',
      shipmentIds: ['s1'],
      pickingMethod: 'total_picking',
      cartCapacity: 4,
      now: new Date('2026-11-05T00:30:00Z'),
      onProgress,
    };

    try {
      const pending = options.mutationFn!(variables, context);
      await jest.advanceTimersByTimeAsync(2000);
      const result = await pending;
      await options.onSettled!(result, null, variables, undefined, context);

      expect(result).toMatchObject({ joined: 1, batchId: 'b1', failures: [] });
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'batch', retrying: true })
      );
      expect(useRunOutboundPreparation.permission).toEqual([
        'fulfillment.warehouse.operate',
      ]);
      expect(orders.outboundPreparation.planMany).toHaveBeenCalledWith({
        data: { shipmentIds: ['s1'] },
        idempotencyKey: expect.any(String),
      });
      expect(orders.outboundPreparation.issueWaybills).toHaveBeenCalledWith({
        data: { shipmentIds: ['s1'] },
        idempotencyKey: expect.any(String),
      });
      expect(orders.outboundBatches.createV2).toHaveBeenCalledTimes(2);
      const createCalls = jest.mocked(orders.outboundBatches.createV2).mock
        .calls;

      expect(createCalls[0]).toEqual(createCalls[1]);
      expect(createCalls[0]).toEqual([
        {
          warehouseId: 'w1',
          pickingMethod: 'total_picking',
          cartCapacity: 4,
          name: '11/05 토탈피킹 09:30:00',
        },
        expect.any(String),
      ]);
      expect(orders.outboundPreparation.addManyToBatch).toHaveBeenCalledWith(
        'b1',
        {
          data: { shipmentIds: ['s1'] },
          idempotencyKey: expect.any(String),
        }
      );
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['outbound-preparation', 'w1'],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reuses the unresolved batch creation command on a manual retry', async () => {
    const storage = new Map<string, string>();

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    jest.useFakeTimers({ now: new Date('2026-11-05T00:30:00Z') });
    jest
      .mocked(orders.outboundPreparation.planMany)
      .mockImplementation(async ({ data }) => ({
        succeeded: data.shipmentIds,
        failed: [],
      }));
    jest
      .mocked(orders.outboundPreparation.issueWaybills)
      .mockImplementation(async ({ data }) =>
        data.shipmentIds.map((shipmentId) => ({
          shipmentId,
          status: 'registered',
          trackingNo: null,
          reason: null,
          nextAttemptAt: null,
        }))
      );
    jest
      .mocked(orders.outboundPreparation.addManyToBatch)
      .mockImplementation(async (_, { data }) => ({
        succeeded: data.shipmentIds,
        failed: [],
      }));
    jest
      .mocked(orders.outboundBatches.createV2)
      .mockRejectedValue({ statusCode: 503 });
    useRunOutboundPreparation();

    const options = jest.mocked(useMutation).mock.calls[0][0];
    const context = { client: useQueryClient(), meta: undefined };
    const variables = {
      warehouseId: 'w1',
      shipmentIds: ['s1'],
      pickingMethod: 'total_picking' as const,
      onProgress: jest.fn(),
    };

    try {
      const first = options.mutationFn!(
        { ...variables, now: new Date('2026-11-05T00:30:00Z') },
        context
      );
      await jest.advanceTimersByTimeAsync(17000);

      expect(await first).toMatchObject({ batchId: null });

      const [, failedKey] = jest.mocked(orders.outboundBatches.createV2).mock
        .calls[0];

      jest
        .mocked(orders.outboundBatches.createV2)
        .mockReset()
        .mockResolvedValue({ batchId: 'b1', operationId: 'op1' });

      const second = await options.mutationFn!(
        { ...variables, now: new Date('2026-11-05T01:00:00Z') },
        context
      );
      const [firstCall] = jest.mocked(orders.outboundBatches.createV2).mock
        .calls;

      expect(second).toMatchObject({
        batchId: 'b1',
        batchName: '11/05 토탈피킹 09:30:00',
        joined: 1,
      });
      expect(firstCall[0].name).toBe('11/05 토탈피킹 09:30:00');
      expect(firstCall[1]).toBe(failedKey);
      expect(storage.has('outbound-preparation-pending-batch')).toBe(false);

      jest
        .mocked(orders.outboundBatches.createV2)
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockRejectedValueOnce({ statusCode: 503 });

      const third = options.mutationFn!(
        { ...variables, now: new Date('2026-11-05T02:00:00Z') },
        context
      );
      await jest.advanceTimersByTimeAsync(17000);
      await third;

      const fourth = await options.mutationFn!(
        {
          ...variables,
          shipmentIds: ['s2'],
          now: new Date('2026-11-05T02:00:00Z'),
        },
        context
      );
      const calls = jest.mocked(orders.outboundBatches.createV2).mock.calls;

      expect(fourth).toMatchObject({ batchId: 'b1', joined: 1 });
      expect(calls.at(-1)?.[1]).not.toBe(calls[1][1]);
    } finally {
      jest.useRealTimers();
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('refreshes preparation and affected shipment views after success or failure', () => {
    useSplitUnreservedMany();

    const options = jest.mocked(useMutation).mock.calls[0][0];

    options.onSettled!(undefined, null, undefined, undefined, {
      client: useQueryClient(),
      meta: undefined,
    });

    expect(
      invalidateQueries.mock.calls.map(([options]) => options.queryKey)
    ).toEqual(
      expect.arrayContaining([
        ['outbound-preparation'],
        ['shipments'],
        ['fulfillments'],
        ['order-progress'],
        ['orders', 'stats'],
      ])
    );
  });

  it.each([
    ['before', [0, 0, 0, 0]],
    ['plan', [1, 0, 0, 0]],
    ['waybill', [1, 1, 0, 0]],
    ['batch', [1, 1, 1, 0]],
    ['sleep', [1, 0, 0, 0]],
  ] as const)(
    'stops subsequent dependencies when unmounted during %s',
    async (stage, counts) => {
      jest.useFakeTimers({ now: new Date('2026-11-05T00:30:00Z') });
      let unmounted = stage === 'before';
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const plan = jest.mocked(orders.outboundPreparation.planMany);
      const waybill = jest.mocked(orders.outboundPreparation.issueWaybills);
      const batch = jest.mocked(orders.outboundBatches.createV2);
      const join = jest.mocked(orders.outboundPreparation.addManyToBatch);

      plan.mockImplementation(async () => {
        if (stage === 'plan') {
          await blocked;
        }

        if (stage === 'sleep') {
          throw new Error('network');
        }

        return { succeeded: ['s1'], failed: [] };
      });
      waybill.mockImplementation(async () => {
        if (stage === 'waybill') {
          await blocked;
        }

        return [
          {
            shipmentId: 's1',
            status: 'registered',
            trackingNo: null,
            reason: null,
            nextAttemptAt: null,
          },
        ];
      });
      batch.mockImplementation(async () => {
        if (stage === 'batch') {
          await blocked;
        }

        return { batchId: 'b1', operationId: 'op1' };
      });
      join.mockResolvedValue({ succeeded: ['s1'], failed: [] });
      useRunOutboundPreparation();

      const options = jest.mocked(useMutation).mock.calls[0][0];
      const stopped = new Error('unmounted');

      try {
        const pending = options.mutationFn!(
          {
            warehouseId: 'w1',
            shipmentIds: ['s1'],
            pickingMethod: 'total_picking',
            now: new Date('2026-11-05T00:30:00Z'),
            onProgress: jest.fn(),
            assertActive: () => {
              if (unmounted) {
                throw stopped;
              }
            },
          },
          { client: useQueryClient(), meta: undefined }
        );
        const rejection = expect(pending).rejects.toBe(stopped);
        await jest.advanceTimersByTimeAsync(0);

        expect(jest.getTimerCount()).toBe(stage === 'sleep' ? 1 : 0);
        unmounted = true;
        release();
        await jest.runAllTimersAsync();
        await rejection;

        [plan, waybill, batch, join].forEach((request, index) => {
          expect(request).toHaveBeenCalledTimes(counts[index]);
        });
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    }
  );
});
