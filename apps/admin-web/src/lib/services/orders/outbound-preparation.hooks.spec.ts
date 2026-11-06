jest.mock(
  '@tanstack/react-query',
  () => ({
    useQuery: jest.fn(),
    useMutation: jest.fn(),
    useQueryClient: jest.fn(),
  }),
  { virtual: true }
);
jest.mock(
  '@/lib/api/domains',
  () => ({
    orders: {
      picking: {},
      outboundPreparation: {
        summary: jest.fn(),
        splitManyUnreserved: jest.fn(),
      },
    },
  }),
  { virtual: true }
);
jest.mock('sonner', () => ({ toast: {} }), { virtual: true });
jest.mock('@/lib/api/domains/orders/daily-status.shape', () => ({}), {
  virtual: true,
});
jest.mock('@/lib/api/domains/orders/sales-order-amendments.shape', () => ({}), {
  virtual: true,
});

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orders } from '@/lib/api/domains';
import { createIdempotentCommand } from './idempotency';
import { useOutboundPreparationSummary } from './queries';
import { useSplitUnreservedMany } from './mutations';

describe('outbound preparation hooks', () => {
  const invalidateQueries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useQueryClient as jest.Mock).mockReturnValue({ invalidateQueries });
  });

  it.each(['warehouse-1', 'warehouse-2', ''])(
    'scopes summary to warehouse %s and disables empty IDs',
    (warehouseId) => {
      useOutboundPreparationSummary(warehouseId);

      const options = (useQuery as jest.Mock).mock.calls[0][0];

      expect(options.queryKey).toEqual(['outbound-preparation', warehouseId]);
      expect(options.enabled).toBe(Boolean(warehouseId));
      options.queryFn();
      expect(orders.outboundPreparation.summary).toHaveBeenCalledWith(
        warehouseId
      );
    }
  );

  it('passes the caller-owned command unchanged and declares warehouse permission', async () => {
    const command = createIdempotentCommand(
      { shipmentIds: ['s-1'] },
      'original-key'
    );
    useSplitUnreservedMany();

    const options = (useMutation as jest.Mock).mock.calls[0][0];

    await options.mutationFn(command);
    await options.mutationFn(command);

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

  it('refreshes preparation and affected shipment views after success or failure', () => {
    useSplitUnreservedMany();

    const options = (useMutation as jest.Mock).mock.calls[0][0];

    options.onSettled();

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
});
