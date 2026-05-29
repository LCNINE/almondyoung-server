import { BadRequestException, ConflictException } from '@nestjs/common';

import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentsService } from './fulfillments.service';

describe('FulfillmentsService', () => {
  const salesOrderId = '11111111-1111-1111-1111-111111111111';
  const salesOrderLineId = '22222222-2222-2222-2222-222222222222';
  const warehouseId = '33333333-3333-3333-3333-333333333333';
  const variantId = '44444444-4444-4444-4444-444444444444';
  const skuId = '55555555-5555-5555-5555-555555555555';
  const voidVariantId = '66666666-6666-6666-6666-666666666666';
  const voidSalesOrderLineId = '77777777-7777-7777-7777-777777777777';

  type FakeState = {
    salesOrders: Array<Record<string, any>>;
    warehouses: Array<Record<string, any>>;
    salesOrderLines: Array<Record<string, any>>;
    skus: Array<Record<string, any>>;
    fulfillmentOrders: Array<Record<string, any>>;
    fulfillmentOrderItems: Array<Record<string, any>>;
    shipments: Array<Record<string, any>>;
    reservations: Array<Record<string, any>>;
  };

  function rows<T>(value: T[]): T[] & { limit: (count: number) => T[] } {
    const result = [...value] as T[] & { limit: (count: number) => T[] };
    result.limit = (count: number) => result.slice(0, count);
    return result;
  }

  function makeTx(state: FakeState) {
    const selectRowsFor = (table: unknown) => {
      if (table === wmsTables.salesOrders) return state.salesOrders;
      if (table === wmsTables.warehouses) return state.warehouses;
      if (table === wmsTables.salesOrderLines) return state.salesOrderLines;
      if (table === wmsTables.skus) return state.skus;
      if (table === wmsTables.fulfillmentOrders) return state.fulfillmentOrders;
      if (table === wmsTables.fulfillmentOrderItems) return state.fulfillmentOrderItems;
      if (table === wmsTables.shipments) return state.shipments;
      if (table === wmsTables.invoices) return [];
      return [];
    };

    const tx: any = {
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: (_where: unknown) => rows(selectRowsFor(table)),
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (value: any) => ({
          returning: () => {
            if (table === wmsTables.fulfillmentOrders) {
              const row = { id: `fo-${state.fulfillmentOrders.length + 1}`, ...value };
              state.fulfillmentOrders.push(row);
              return [row];
            }

            if (table === wmsTables.fulfillmentOrderItems) {
              const values = Array.isArray(value) ? value : [value];
              const inserted = values.map((item, index) => ({
                id: `foi-${state.fulfillmentOrderItems.length + index + 1}`,
                ...item,
              }));
              state.fulfillmentOrderItems.push(...inserted);
              return inserted;
            }

            return [];
          },
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, any>) => ({
          where: (_where: unknown) => {
            if (table === wmsTables.fulfillmentOrders) {
              state.fulfillmentOrders = state.fulfillmentOrders.map((row) => ({ ...row, ...set }));
            }
            if (table === wmsTables.fulfillmentOrderItems) {
              state.fulfillmentOrderItems = state.fulfillmentOrderItems.map((row) => ({ ...row, ...set }));
            }
            return [];
          },
        }),
      })),
    };

    return tx;
  }

  function makeService(
    options: {
      lines?: Array<Record<string, any>>;
      links?: Array<{ skuId: string; quantity: number }> | null;
      matching?: Record<string, any> | null;
      matchingsByVariant?: Record<string, Record<string, any> | null>;
      policy?: {
        inventoryManagement: boolean;
        preStockSellable: boolean;
        alwaysSellableZeroStock: boolean;
      };
      availableQty?: number;
      reserveError?: Error;
      fulfillmentOrders?: Array<Record<string, any>>;
      fulfillmentOrderItems?: Array<Record<string, any>>;
      shipments?: Array<Record<string, any>>;
    } = {},
  ) {
    const state: FakeState = {
      salesOrders: [{ id: salesOrderId, status: 'confirmed' }],
      warehouses: [{ id: warehouseId }],
      salesOrderLines: options.lines ?? [
        {
          id: salesOrderLineId,
          salesOrderId,
          variantId,
          quantity: 1,
          mappingSnapshotId: null,
        },
      ],
      skus: [{ id: skuId, holderId: null }],
      fulfillmentOrders: options.fulfillmentOrders ?? [],
      fulfillmentOrderItems: options.fulfillmentOrderItems ?? [],
      shipments: options.shipments ?? [],
      reservations: [],
    };
    const tx = makeTx(state);
    const db = { db: { transaction: jest.fn((fn) => fn(tx)) } };
    const productSkuMapping = {
      getByVariant: jest.fn().mockImplementation((requestedVariantId: string) => {
        if (options.matchingsByVariant && requestedVariantId in options.matchingsByVariant) {
          return Promise.resolve(options.matchingsByVariant[requestedVariantId]);
        }

        if (options.matching !== undefined) {
          return Promise.resolve(options.matching);
        }

        return Promise.resolve(
          options.links === null
            ? null
            : {
                status: 'matched',
                strategy: 'variant',
                links: options.links ?? [{ skuId, quantity: 2 }],
              },
        );
      }),
      getMappingSnapshot: jest.fn(),
    };
    const availability = {
      getAvailableQuantity: jest.fn().mockResolvedValue(options.availableQty ?? 10),
    };
    const unifiedReservation = {
      reserveStock: jest.fn().mockImplementation(async (dto) => {
        if (options.reserveError) throw options.reserveError;
        const reservation = {
          id: `rsv-${state.reservations.length + 1}`,
          ...dto,
          status: 'confirmed',
        };
        state.reservations.push(reservation);
        return reservation;
      }),
    };
    const reservationLifecycle = {
      handleFulfillmentOrderStatusChange: jest.fn().mockResolvedValue(undefined),
    };
    const policies = {
      getVariantPolicy: jest.fn().mockResolvedValue(
        options.policy ?? {
          inventoryManagement: true,
          preStockSellable: false,
          alwaysSellableZeroStock: false,
        },
      ),
      evaluateFulfillability: jest.fn(
        (
          policy: {
            inventoryManagement: boolean;
            preStockSellable: boolean;
            alwaysSellableZeroStock: boolean;
          },
          onHandQty: number,
          requestedQty: number,
        ) => {
          if (!policy.inventoryManagement) return true;
          return onHandQty >= requestedQty;
        },
      ),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const service = new FulfillmentsService(
      db as any,
      policies as any,
      availability as any,
      reservationLifecycle as any,
      unifiedReservation as any,
      productSkuMapping as any,
      outbox as any,
    );

    return {
      service,
      state,
      tx,
      productSkuMapping,
      availability,
      reservationLifecycle,
      unifiedReservation,
      policies,
      outbox,
    };
  }

  it('매칭이 없는 sales order line 이 있으면 FO를 만들지 않고 matching failure를 반환한다', async () => {
    const { service, state } = makeService({ links: null });

    try {
      await service.create({ salesOrderId, warehouseId });
      fail('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'PRODUCT_SKU_MATCHING_REQUIRED',
        missingLines: [{ salesOrderLineId, variantId, reason: 'NO_PRODUCT_SKU_MATCHING' }],
      });
    }

    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
  });

  it('salesOrderId와 explicit items를 함께 보내면 매칭 검증 우회를 막는다', async () => {
    const { service, state, productSkuMapping } = makeService({ links: null });

    try {
      await service.create({
        salesOrderId,
        warehouseId,
        items: [{ skuId, quantity: 1, salesOrderLineId, variantId }],
      });
      throw new Error('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'SALES_ORDER_ITEMS_DERIVED_FROM_MATCHING',
      });
    }

    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
  });

  it('explicit items에 item-level SO 참조가 있으면 매칭 검증 우회를 막는다', async () => {
    const { service, state, productSkuMapping } = makeService({ links: null });

    try {
      await service.create({
        warehouseId,
        items: [{ skuId, quantity: 1, salesOrderId, salesOrderLineId, variantId }],
      });
      throw new Error('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'FULFILLMENT_ITEM_SO_REFERENCE_NOT_ALLOWED',
      });
    }

    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
  });

  it('매칭은 있지만 재고 예약이 실패하면 FO와 item을 남기고 unfulfillable 상태로 둔다', async () => {
    const { service, state, outbox } = makeService({
      availableQty: 0,
      reserveError: new ConflictException('Insufficient stock. Available: 0, Requested: 2'),
    });

    const result = await service.create({ salesOrderId, warehouseId });

    expect(result).toMatchObject({
      id: 'fo-1',
      status: 'unfulfillable',
      reservationFailureReason: 'RESERVATION_FAILED',
    });
    expect(state.fulfillmentOrderItems).toHaveLength(1);
    expect(state.fulfillmentOrders[0].reservationFailureDetails.failedItems).toEqual([
      expect.objectContaining({
        fulfillmentOrderItemId: 'foi-1',
        salesOrderLineId,
        variantId,
        skuId,
        requiredQty: 2,
        availableQty: 0,
      }),
    ]);
    expect(outbox.enqueue.mock.calls.map(([event]) => event.eventType)).not.toContain('FulfillmentReady');
  });

  it('매칭과 재고가 충분하면 예약을 생성하고 FO를 ready로 전환한다', async () => {
    const { service, state, unifiedReservation, outbox } = makeService();

    const result = await service.create({ salesOrderId, warehouseId });

    expect(result).toMatchObject({
      id: 'fo-1',
      status: 'ready',
      totalReservedQty: 2,
      reservationFailureReason: null,
      reservationFailureDetails: null,
    });
    expect(state.fulfillmentOrderItems[0]).toMatchObject({ id: 'foi-1', skuId, qty: 2, reservedQty: 2 });
    expect(unifiedReservation.reserveStock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'FULFILLMENT_ORDER',
        targetId: 'fo-1',
        fulfillmentOrderItemId: 'foi-1',
        skuId,
        warehouseId,
        quantity: 2,
      }),
      expect.anything(),
    );
    expect(outbox.enqueue.mock.calls.map(([event]) => event.eventType)).toContain('FulfillmentReady');
  });

  it('matched + void sales order line은 물리 출고 item 없이 제외한다', async () => {
    const { service, state, unifiedReservation, outbox } = makeService({
      matching: {
        status: 'matched',
        strategy: 'void',
        links: [],
      },
    });

    const result = await service.create({ salesOrderId, warehouseId });

    expect(result).toMatchObject({
      id: 'fo-1',
      status: 'completed',
      totalItems: 0,
      totalQty: 0,
      totalReservedQty: 0,
    });
    expect(state.fulfillmentOrderItems).toHaveLength(0);
    expect(unifiedReservation.reserveStock).not.toHaveBeenCalled();
    expect(outbox.enqueue.mock.calls.map(([event]) => event.eventType)).toEqual(['FulfillmentCreated']);
  });

  it('matched + void line과 variant line이 섞인 주문은 물리 출고 item만 생성한다', async () => {
    const { service, state, unifiedReservation } = makeService({
      lines: [
        {
          id: salesOrderLineId,
          salesOrderId,
          variantId,
          quantity: 1,
          mappingSnapshotId: null,
        },
        {
          id: voidSalesOrderLineId,
          salesOrderId,
          variantId: voidVariantId,
          quantity: 3,
          mappingSnapshotId: null,
        },
      ],
      matchingsByVariant: {
        [variantId]: {
          status: 'matched',
          strategy: 'variant',
          links: [{ skuId, quantity: 2 }],
        },
        [voidVariantId]: {
          status: 'matched',
          strategy: 'void',
          links: [],
        },
      },
    });

    const result = await service.create({ salesOrderId, warehouseId });

    expect(result).toMatchObject({
      id: 'fo-1',
      status: 'ready',
      totalItems: 1,
      totalQty: 2,
      totalReservedQty: 2,
    });
    expect(state.fulfillmentOrderItems).toHaveLength(1);
    expect(state.fulfillmentOrderItems[0]).toMatchObject({
      salesOrderLineId,
      variantId,
      skuId,
      qty: 2,
    });
    expect(unifiedReservation.reserveStock).toHaveBeenCalledTimes(1);
  });

  it('inventoryManagement=false variant는 물리 재고 예약 없이 ready로 전환한다', async () => {
    const { service, state, availability, unifiedReservation, outbox } = makeService({
      availableQty: 0,
      reserveError: new ConflictException('reserve should not be called'),
      policy: {
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
      },
    });

    const result = await service.create({ salesOrderId, warehouseId });

    expect(result).toMatchObject({
      id: 'fo-1',
      status: 'ready',
      totalReservedQty: 0,
      reservationFailureReason: null,
      reservationFailureDetails: null,
    });
    expect(state.fulfillmentOrderItems[0]).toMatchObject({ id: 'foi-1', skuId, qty: 2, reservedQty: 0 });
    expect(availability.getAvailableQuantity).not.toHaveBeenCalled();
    expect(unifiedReservation.reserveStock).not.toHaveBeenCalled();
    expect(outbox.enqueue.mock.calls.map(([event]) => event.eventType)).toContain('FulfillmentReady');
  });

  it('sales order line 이 없으면 빈 FO를 만들지 않는다', async () => {
    const { service, state } = makeService({ lines: [] });

    await expect(service.create({ salesOrderId, warehouseId })).rejects.toThrow(
      `Sales order ${salesOrderId} has no lines`,
    );
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
  });

  it('ship은 기존 confirmed reservation을 lifecycle로 해제한다', async () => {
    const { service, reservationLifecycle } = makeService({
      fulfillmentOrders: [
        {
          id: 'fo-ready-1',
          salesOrderId,
          warehouseId,
          status: 'ready',
        },
      ],
      fulfillmentOrderItems: [
        {
          id: 'foi-ready-1',
          fulfillmentOrderId: 'fo-ready-1',
          skuId,
          qty: 2,
          reservedQty: 2,
        },
      ],
      shipments: [
        {
          fulfillmentOrderId: 'fo-ready-1',
          carrier: 'CJ',
          trackingNo: 'TRACK-1',
        },
      ],
    });

    await service.ship('fo-ready-1');

    expect(reservationLifecycle.handleFulfillmentOrderStatusChange).toHaveBeenCalledWith(
      'fo-ready-1',
      'ready',
      'shipped',
      expect.anything(),
    );
  });

  it('cancel은 ready/unfulfillable FO의 기존 confirmed reservation을 lifecycle로 해제한다', async () => {
    const { service, reservationLifecycle } = makeService({
      fulfillmentOrders: [
        {
          id: 'fo-unfulfillable-1',
          salesOrderId,
          warehouseId,
          status: 'unfulfillable',
          totalReservedQty: 1,
        },
      ],
      fulfillmentOrderItems: [
        {
          id: 'foi-unfulfillable-1',
          fulfillmentOrderId: 'fo-unfulfillable-1',
          skuId,
          qty: 2,
          reservedQty: 1,
        },
      ],
    });

    await service.cancel('fo-unfulfillable-1');

    expect(reservationLifecycle.handleFulfillmentOrderStatusChange).toHaveBeenCalledWith(
      'fo-unfulfillable-1',
      'unfulfillable',
      'canceled',
      expect.anything(),
    );
  });

  it('checkAvailability는 현재 FO의 기존 예약 수량을 가용 수량으로 인정한다', async () => {
    const { service, availability } = makeService({
      availableQty: 0,
      fulfillmentOrders: [
        {
          id: 'fo-ready-1',
          salesOrderId,
          warehouseId,
          status: 'ready',
        },
      ],
      fulfillmentOrderItems: [
        {
          id: 'foi-ready-1',
          fulfillmentOrderId: 'fo-ready-1',
          variantId,
          skuId,
          qty: 2,
          reservedQty: 2,
        },
      ],
    });

    await expect(service.checkAvailability('fo-ready-1')).resolves.toEqual({ ready: true });
    expect(availability.getAvailableQuantity).not.toHaveBeenCalled();
  });
});
