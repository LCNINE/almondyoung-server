import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentReservationsFacade } from './fulfillment-reservations.facade';

describe('FulfillmentReservationsFacade.reserve', () => {
  const fulfillmentOrderId = '11111111-1111-1111-1111-111111111111';
  const fulfillmentOrderItemId = '22222222-2222-2222-2222-222222222222';
  const warehouseId = '33333333-3333-3333-3333-333333333333';
  const skuId = '44444444-4444-4444-4444-444444444444';

  function makeFacade(
    options: {
      foStatus?: string;
      firstItemVariantId?: string | null;
      policyInventoryManagement?: boolean;
      firstItemReservedQty?: number;
      reservations?: Array<{ id: string; skuId: string; quantity: number }>;
    } = {},
  ) {
    const state = {
      fo: {
        id: fulfillmentOrderId,
        status: options.foStatus ?? 'unfulfillable',
        warehouseId,
        totalReservedQty: 1,
        reservationFailureReason: 'RESERVATION_FAILED',
        reservationFailureDetails: { failedItems: [{ skuId }] },
      },
      items: [
        {
          id: fulfillmentOrderItemId,
          fulfillmentOrderId,
          variantId: options.firstItemVariantId ?? null,
          skuId,
          qty: 1,
          reservedQty: options.firstItemReservedQty ?? 0,
        },
        {
          id: '55555555-5555-5555-5555-555555555555',
          fulfillmentOrderId,
          variantId: null,
          skuId: '66666666-6666-6666-6666-666666666666',
          qty: 1,
          reservedQty: 1,
        },
      ],
    };

    const tx: any = {
      query: {
        fulfillmentOrderItems: {
          findFirst: jest.fn().mockImplementation(() => state.items[0]),
          findMany: jest.fn().mockImplementation(() => state.items),
        },
        fulfillmentOrders: {
          findFirst: jest.fn().mockImplementation(() => state.fo),
        },
      },
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => ({
          where: (_where: unknown) => {
            if (table === wmsTables.fulfillmentOrderItems) {
              state.items[0] = { ...state.items[0], ...set };
            }
            if (table === wmsTables.fulfillmentOrders) {
              state.fo = { ...state.fo, ...set };
            }
            return [];
          },
        }),
      })),
    };

    const unified = {
      reserveStock: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
      getReservationsByTarget: jest.fn().mockResolvedValue(options.reservations ?? []),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
    };
    const outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const policies = {
      getVariantPolicy: jest.fn().mockResolvedValue({
        inventoryManagement: options.policyInventoryManagement ?? true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      }),
    };
    const productSellableQuantity = {
      recalculateAndPublishForSku: jest.fn().mockResolvedValue(undefined),
    };

    const facade = new FulfillmentReservationsFacade(
      {} as any,
      unified as any,
      productSellableQuantity as any,
      policies as any,
      outbox as any,
    );

    return { facade, state, tx, unified, productSellableQuantity, policies, outbox };
  }

  it('manual reserve로 모든 item이 예약되면 FO를 ready로 바꾸고 READY 이벤트를 enqueue한다', async () => {
    const { facade, state, tx, unified, outbox } = makeFacade();

    await facade.reserve({ fulfillmentOrderItemId, quantity: 1 }, tx);

    expect(unified.reserveStock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'FULFILLMENT_ORDER',
        targetId: fulfillmentOrderId,
        fulfillmentOrderItemId,
        skuId,
        warehouseId,
        quantity: 1,
      }),
      tx,
    );
    expect(state.fo).toMatchObject({
      status: 'ready',
      totalReservedQty: 2,
      reservationFailureReason: null,
      reservationFailureDetails: null,
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'FulfillmentReady',
        aggregateType: 'fulfillment',
        aggregateId: fulfillmentOrderId,
        partitionKey: fulfillmentOrderId,
        payload: { fulfillmentOrderId },
      }),
      tx,
    );
  });

  it('labeled FO는 수동 예약 refresh가 ready로 되돌리지 않고 READY 이벤트도 내지 않는다', async () => {
    const { facade, state, tx, outbox } = makeFacade({ foStatus: 'labeled' });

    await facade.reserve({ fulfillmentOrderItemId, quantity: 1 }, tx);

    expect(state.fo.status).toBe('labeled');
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('pending FO가 예약을 잃으면 picking 대상에 남지 않도록 created로 내린다', async () => {
    const { facade, state, tx, unified } = makeFacade({
      foStatus: 'pending',
      firstItemReservedQty: 1,
      reservations: [{ id: 'reservation-1', skuId, quantity: 1 }],
    });

    await facade.unreserve({ fulfillmentOrderItemId, quantity: 1 }, tx);

    expect(unified.releaseReservation).toHaveBeenCalledWith('reservation-1', tx);
    expect(state.fo).toMatchObject({
      status: 'created',
      totalReservedQty: 1,
    });
  });
});
