import { BadRequestException, ConflictException } from '@nestjs/common';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentReservationsFacade } from './fulfillment-reservations.facade';

describe('FulfillmentReservationsFacade', () => {
  const fulfillmentOrderId = '11111111-1111-1111-1111-111111111111';
  const otherFulfillmentOrderId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const fulfillmentOrderItemId = '22222222-2222-2222-2222-222222222222';
  const warehouseId = '33333333-3333-3333-3333-333333333333';
  const skuId = '44444444-4444-4444-4444-444444444444';
  const otherSkuId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  function makeFacade(
    options: {
      foStatus?: string;
      firstItemVariantId?: string | null;
      firstItemShippedQty?: number;
      policyInventoryManagement?: boolean;
      firstItemReservedQty?: number;
      firstItemFulfillmentOrderId?: string;
      reservations?: Array<{ id: string; skuId: string; quantity: number }>;
      extraItems?: Array<Record<string, any>>;
      toFo?: { id: string; status: string; warehouseId: string; totalReservedQty: number };
    } = {},
  ) {
    const fo = {
      id: fulfillmentOrderId,
      status: options.foStatus ?? 'unfulfillable',
      warehouseId,
      totalReservedQty: 1,
      reservationFailureReason: 'RESERVATION_FAILED',
      reservationFailureDetails: { failedItems: [{ skuId }] },
    };
    const state = {
      fo,
      toFo: options.toFo ?? null,
      items: [
        {
          id: fulfillmentOrderItemId,
          fulfillmentOrderId: options.firstItemFulfillmentOrderId ?? fulfillmentOrderId,
          variantId: options.firstItemVariantId ?? null,
          skuId,
          qty: 1,
          reservedQty: options.firstItemReservedQty ?? 0,
          shippedQty: options.firstItemShippedQty ?? 0,
        },
        {
          id: '55555555-5555-5555-5555-555555555555',
          fulfillmentOrderId,
          variantId: null,
          skuId: '66666666-6666-6666-6666-666666666666',
          qty: 1,
          reservedQty: 1,
          shippedQty: 0,
        },
        ...(options.extraItems ?? []),
      ],
    };

    const tx: any = {
      query: {
        fulfillmentOrderItems: {
          findFirst: jest.fn().mockImplementation((opts?: { where?: unknown }) => {
            return state.items.find((item) => {
              if (!opts?.where) return true;
              // Approximate: match by the string in the where clause. We inspect calls by id.
              return true;
            });
          }),
          findMany: jest.fn().mockImplementation(() => state.items),
        },
        fulfillmentOrders: {
          findFirst: jest.fn().mockImplementation((opts?: { where?: unknown }) => {
            if (state.toFo) {
              // Return toFo on the 2nd call (for transferReservation)
              const callCount = (tx.query.fulfillmentOrders.findFirst as jest.Mock).mock.calls.length;
              if (callCount > 1) return state.toFo;
            }
            return state.fo;
          }),
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

  describe('reserve', () => {
    it('manual reserve로 모든 item이 예약되면 FO를 ready로 바꾸고 READY 이벤트를 enqueue한다', async () => {
      const { facade, state, tx, unified, outbox } = makeFacade();

      await facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx);

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

      await facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx);

      expect(state.fo.status).toBe('labeled');
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('URL FO id와 FOI 소속 FO id가 다르면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeFacade({ firstItemFulfillmentOrderId: otherFulfillmentOrderId });

      await expect(
        facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx),
      ).rejects.toThrow(BadRequestException);
    });

    it('shipped FO에 reserve 요청하면 ConflictException을 던진다', async () => {
      const { facade, tx } = makeFacade({ foStatus: 'shipped' });

      await expect(
        facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx),
      ).rejects.toThrow(ConflictException);
    });

    it('completed FO에 reserve 요청하면 ConflictException을 던진다', async () => {
      const { facade, tx } = makeFacade({ foStatus: 'completed' });

      await expect(
        facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('unreserve', () => {
    it('pending FO가 예약을 잃으면 picking 대상에 남지 않도록 created로 내린다', async () => {
      const { facade, state, tx, unified } = makeFacade({
        foStatus: 'pending',
        firstItemReservedQty: 1,
        reservations: [{ id: 'reservation-1', skuId, quantity: 1 }],
      });

      await facade.unreserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx);

      expect(unified.releaseReservation).toHaveBeenCalledWith('reservation-1', tx);
      expect(state.fo).toMatchObject({
        status: 'created',
        totalReservedQty: 1,
      });
    });

    it('URL FO id와 FOI 소속 FO id가 다르면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeFacade({ firstItemFulfillmentOrderId: otherFulfillmentOrderId });

      await expect(
        facade.unreserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx),
      ).rejects.toThrow(BadRequestException);
    });

    it('shipped FO에 unreserve 요청하면 ConflictException을 던진다', async () => {
      const { facade, tx } = makeFacade({ foStatus: 'shipped' });

      await expect(
        facade.unreserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx),
      ).rejects.toThrow(ConflictException);
    });

    it('shippedQty > 0인 FOI에 unreserve 요청하면 shipped evidence guard가 ConflictException을 던진다', async () => {
      const { facade, tx } = makeFacade({ foStatus: 'ready', firstItemShippedQty: 1 });

      await expect(
        facade.unreserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 1 }, tx),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('transferReservation', () => {
    it('from FOI와 to FOI의 SKU가 다르면 BadRequestException을 던진다', async () => {
      const toItemId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      const { facade, tx, state } = makeFacade({
        extraItems: [
          { id: toItemId, fulfillmentOrderId, skuId: otherSkuId, qty: 1, reservedQty: 0, shippedQty: 0 },
        ],
      });

      // first findFirst → fromItem (skuId), second → toItem (otherSkuId)
      let callCount = 0;
      tx.query.fulfillmentOrderItems.findFirst = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return state.items[0];
        return { id: toItemId, fulfillmentOrderId, skuId: otherSkuId, qty: 1, reservedQty: 0, shippedQty: 0 };
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fulfillmentOrderItemId, toFulfillmentOrderItemId: toItemId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('from FOI가 URL FO에 속하지 않으면 BadRequestException을 던진다', async () => {
      const toItemId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      const { facade, tx, state } = makeFacade({
        firstItemFulfillmentOrderId: otherFulfillmentOrderId,
        extraItems: [
          { id: toItemId, fulfillmentOrderId, skuId, qty: 1, reservedQty: 0, shippedQty: 0 },
        ],
      });

      let callCount = 0;
      tx.query.fulfillmentOrderItems.findFirst = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return state.items[0]; // from → belongs to otherFulfillmentOrderId
        return { id: toItemId, fulfillmentOrderId, skuId, qty: 1, reservedQty: 0, shippedQty: 0 };
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fulfillmentOrderItemId, toFulfillmentOrderItemId: toItemId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
