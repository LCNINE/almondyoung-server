import { BadRequestException, ConflictException } from '@nestjs/common';

import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentsService } from './fulfillments.service';

describe('FulfillmentsService', () => {
  const salesOrderId = '11111111-1111-1111-1111-111111111111';
  const salesOrderLineId = '22222222-2222-2222-2222-222222222222';
  const secondSalesOrderLineId = '22222222-2222-2222-2222-222222222223';
  const warehouseId = '33333333-3333-3333-3333-333333333333';
  const variantId = '44444444-4444-4444-4444-444444444444';
  const secondVariantId = '44444444-4444-4444-4444-444444444445';
  const skuId = '55555555-5555-5555-5555-555555555555';
  const snapshotSkuId = '55555555-5555-5555-5555-555555555556';
  const mappingSnapshotId = '88888888-8888-8888-8888-888888888888';
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
    salesOrderCancellations: Array<Record<string, any>>;
    salesOrderAmendments: Array<Record<string, any>>;
    businessLinks: Array<Record<string, any>>;
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
      if (table === wmsTables.salesOrderCancellations) return state.salesOrderCancellations;
      if (table === wmsTables.salesOrderAmendments) return state.salesOrderAmendments;
      if (table === wmsTables.businessLinks) return state.businessLinks;
      return [];
    };

    const tx: any = {
      execute: jest.fn().mockResolvedValue([]),
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: (_where: unknown) => rows(selectRowsFor(table)),
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (value: any) => {
          if (table === wmsTables.businessLinks) {
            const values = Array.isArray(value) ? value : [value];
            const inserted = values.map((link, index) => ({
              id: `business-link-${state.businessLinks.length + index + 1}`,
              ...link,
              createdAt: new Date('2026-05-30T00:00:00.000Z'),
              updatedAt: new Date('2026-05-30T00:00:00.000Z'),
            }));
            state.businessLinks.push(...inserted);
            return { returning: () => inserted };
          }

          return {
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
          };
        },
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
      salesOrderStatus?: string;
      warehouses?: Array<Record<string, any>>;
      lines?: Array<Record<string, any>>;
      skus?: Array<Record<string, any>>;
      links?: Array<{ skuId: string; quantity: number }> | null;
      matching?: Record<string, any> | null;
      matchingsByVariant?: Record<string, Record<string, any> | null>;
      mappingSnapshots?: Record<string, { mappings: Array<{ skuId: string; quantity: number }> }>;
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
      salesOrderCancellations?: Array<Record<string, any>>;
      salesOrderAmendments?: Array<Record<string, any>>;
      businessLinks?: Array<Record<string, any>>;
    } = {},
  ) {
    const state: FakeState = {
      salesOrders: [{ id: salesOrderId, status: options.salesOrderStatus ?? 'confirmed' }],
      warehouses: options.warehouses ?? [{ id: warehouseId }],
      salesOrderLines: options.lines ?? [
        {
          id: salesOrderLineId,
          salesOrderId,
          variantId,
          quantity: 1,
          mappingSnapshotId: null,
        },
      ],
      skus: options.skus ?? [{ id: skuId, holderId: null }],
      fulfillmentOrders: options.fulfillmentOrders ?? [],
      fulfillmentOrderItems: options.fulfillmentOrderItems ?? [],
      shipments: options.shipments ?? [],
      reservations: [],
      salesOrderCancellations: options.salesOrderCancellations ?? [],
      salesOrderAmendments: options.salesOrderAmendments ?? [],
      businessLinks: options.businessLinks ?? [],
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
      getMappingSnapshot: jest
        .fn()
        .mockImplementation((requestedSnapshotId: string) =>
          Promise.resolve(options.mappingSnapshots?.[requestedSnapshotId] ?? { mappings: [] }),
        ),
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
      handleFulfillmentOrderSplit: jest.fn().mockResolvedValue(undefined),
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
    const salesOrderAmendments = {
      create: jest.fn().mockImplementation(async (dto, operatorId) => {
        const row = {
          id: `amendment-${state.salesOrderAmendments.length + 1}`,
          ...dto,
          createdBy: operatorId ?? null,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date('2026-05-30T00:00:00.000Z'),
          createdAt: new Date('2026-05-30T00:00:00.000Z'),
          updatedAt: new Date('2026-05-30T00:00:00.000Z'),
        };
        state.salesOrderAmendments.push(row);
        state.businessLinks.push({
          id: `business-link-${state.businessLinks.length + 1}`,
          sourceType: 'sales_order',
          sourceId: dto.salesOrderId,
          sourceExternalRef: null,
          targetType: 'sales_order_amendment',
          targetId: row.id,
          targetExternalRef: null,
          relationName: 'opened_amendment',
          metadata: {
            amendmentKind: dto.amendmentKind,
            decision: dto.decision,
            deltaTypes: dto.deltas.map((delta) => delta.type),
          },
          occurredAt: row.occurredAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
        return row;
      }),
    };

    const service = new FulfillmentsService(
      db as any,
      policies as any,
      availability as any,
      reservationLifecycle as any,
      unifiedReservation as any,
      productSkuMapping as any,
      outbox as any,
      salesOrderAmendments as any,
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
      salesOrderAmendments,
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

  it('legacy ignored 매칭은 SKU link가 있어도 미해결로 보고 FO를 만들지 않는다', async () => {
    const { service, state } = makeService({
      matching: {
        status: 'ignored',
        strategy: 'variant',
        links: [{ skuId, quantity: 1 }],
      },
    });

    try {
      await service.create({ salesOrderId, warehouseId });
      fail('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'PRODUCT_SKU_MATCHING_REQUIRED',
        missingLines: [{ salesOrderLineId, variantId, reason: 'LEGACY_PRODUCT_MATCHING_IGNORED' }],
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

  it('salesOrderId에 대한 FO가 이미 있으면 새 FO를 만들지 않고 기존 FO를 반환한다', async () => {
    const { service, state, productSkuMapping, unifiedReservation } = makeService({
      fulfillmentOrders: [
        {
          id: 'fo-existing-1',
          salesOrderId,
          warehouseId,
          status: 'ready',
        },
      ],
    });

    const result = await service.create({ salesOrderId, warehouseId });

    expect(result).toMatchObject({ id: 'fo-existing-1', salesOrderId, status: 'ready' });
    expect(state.fulfillmentOrders).toHaveLength(1);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
    expect(unifiedReservation.reserveStock).not.toHaveBeenCalled();
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

  it('부분 취소된 SalesOrder line 수량은 backlog retry의 FO 생성 수량에서 차감한다', async () => {
    const { service, state, unifiedReservation } = makeService({
      lines: [
        {
          id: salesOrderLineId,
          salesOrderId,
          variantId,
          quantity: 3,
          mappingSnapshotId: null,
        },
      ],
      salesOrderCancellations: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          salesOrderId,
          cancellationScope: 'partial',
          status: 'applied',
          metadata: {
            cancelledLines: [{ salesOrderLineId, quantity: 1 }],
          },
        },
      ],
    });

    const result = await service.create({ salesOrderId, warehouseId });

    expect(result).toMatchObject({
      id: 'fo-1',
      status: 'ready',
      totalReservedQty: 4,
    });
    expect(state.fulfillmentOrderItems[0]).toMatchObject({
      salesOrderLineId,
      skuId,
      qty: 4,
      reservedQty: 4,
    });
    expect(unifiedReservation.reserveStock).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 4,
      }),
      expect.anything(),
    );
  });

  it('CS 보상 출고는 fulfillment-only amendment와 별도 FO를 만들고 원 SalesOrder line을 바꾸지 않는다', async () => {
    const { service, state, unifiedReservation, salesOrderAmendments } = makeService();
    const originalLines = state.salesOrderLines.map((line) => ({ ...line }));

    const result = await service.createCompensationShipment(
      {
        salesOrderId,
        warehouseId,
        reasonCode: 'CS_COMPENSATION_GIFT',
        fulfillmentInstruction: 'Ship free gift for CS compensation',
        items: [{ variantId, quantity: 1, salesOrderLineId }],
      },
      '99999999-9999-9999-9999-999999999999',
    );

    expect(result.amendment).toMatchObject({
      id: 'amendment-1',
      salesOrderId,
      amendmentKind: 'fulfillment_only',
      decision: 'approved',
      reasonCode: 'CS_COMPENSATION_GIFT',
      deltas: [
        expect.objectContaining({
          type: 'fulfillment_only_correction',
          salesOrderLineId,
          fulfillmentInstruction: 'Ship free gift for CS compensation',
        }),
      ],
    });
    expect(result.fulfillmentOrder).toMatchObject({
      id: 'fo-1',
      salesOrderId: null,
      status: 'ready',
      totalQty: 2,
      totalReservedQty: 2,
    });
    expect(state.fulfillmentOrderItems[0]).toMatchObject({
      salesOrderId,
      salesOrderLineId,
      variantId,
      skuId,
      qty: 2,
      reservedQty: 2,
    });
    expect(state.salesOrderLines).toEqual(originalLines);
    expect(salesOrderAmendments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amendmentKind: 'fulfillment_only',
        metadata: expect.objectContaining({
          compensationShipment: expect.objectContaining({
            fulfillmentOrderId: 'fo-1',
            items: [{ variantId, quantity: 1, salesOrderLineId }],
          }),
        }),
      }),
      '99999999-9999-9999-9999-999999999999',
      expect.anything(),
    );
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
    expect(state.businessLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'sales_order',
          sourceId: salesOrderId,
          targetType: 'sales_order_amendment',
          targetId: 'amendment-1',
          relationName: 'opened_amendment',
        }),
        expect.objectContaining({
          sourceType: 'sales_order_amendment',
          sourceId: 'amendment-1',
          targetType: 'fulfillment_order',
          targetId: 'fo-1',
          relationName: 'caused_compensation_fulfillment',
        }),
        expect.objectContaining({
          sourceType: 'sales_order',
          sourceId: salesOrderId,
          targetType: 'fulfillment_order',
          targetId: 'fo-1',
          relationName: 'caused_compensation_fulfillment',
          metadata: expect.objectContaining({ amendmentId: 'amendment-1' }),
        }),
      ]),
    );
  });

  it('CS 보상 출고는 참조한 원 주문 라인의 mapping snapshot을 우선 사용한다', async () => {
    const { service, state, productSkuMapping, unifiedReservation } = makeService({
      lines: [
        {
          id: salesOrderLineId,
          salesOrderId,
          variantId,
          quantity: 1,
          mappingSnapshotId,
        },
      ],
      skus: [
        { id: skuId, holderId: null },
        { id: snapshotSkuId, holderId: null },
      ],
      links: [{ skuId, quantity: 9 }],
      mappingSnapshots: {
        [mappingSnapshotId]: {
          mappings: [{ skuId: snapshotSkuId, quantity: 3 }],
        },
      },
    });

    const result = await service.createCompensationShipment({
      salesOrderId,
      warehouseId,
      reasonCode: 'MISSED_ITEM',
      items: [{ variantId, quantity: 2, salesOrderLineId }],
    });

    expect(result.fulfillmentOrder).toMatchObject({
      id: 'fo-1',
      status: 'ready',
      totalQty: 6,
      totalReservedQty: 6,
    });
    expect(productSkuMapping.getMappingSnapshot).toHaveBeenCalledWith(mappingSnapshotId, expect.anything());
    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
    expect(state.fulfillmentOrderItems[0]).toMatchObject({
      salesOrderId,
      salesOrderLineId,
      mappingSnapshotId,
      variantId,
      skuId: snapshotSkuId,
      qty: 6,
      reservedQty: 6,
    });
    expect(unifiedReservation.reserveStock).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentOrderItemId: 'foi-1',
        skuId: snapshotSkuId,
        warehouseId,
        quantity: 6,
      }),
      expect.anything(),
    );
  });

  it('CS 보상 출고는 accepted 상태가 아닌 SalesOrder에는 만들 수 없다', async () => {
    const { service, state, productSkuMapping } = makeService({ salesOrderStatus: 'pending' });

    await expect(
      service.createCompensationShipment({
        salesOrderId,
        warehouseId,
        reasonCode: 'MISSED_ITEM',
        items: [{ variantId, quantity: 1, salesOrderLineId }],
      }),
    ).rejects.toThrow(`Cannot create compensation shipment for SalesOrder ${salesOrderId} in status pending`);

    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
    expect(productSkuMapping.getMappingSnapshot).not.toHaveBeenCalled();
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
    expect(state.salesOrderAmendments).toHaveLength(0);
    expect(state.businessLinks).toHaveLength(0);
  });

  it('CS 보상 출고는 참조한 원 주문 라인과 요청 variant가 다르면 snapshot을 사용하지 않는다', async () => {
    const { service, state, productSkuMapping } = makeService({
      lines: [
        {
          id: salesOrderLineId,
          salesOrderId,
          variantId,
          quantity: 1,
          mappingSnapshotId,
        },
      ],
      mappingSnapshots: {
        [mappingSnapshotId]: {
          mappings: [{ skuId: snapshotSkuId, quantity: 1 }],
        },
      },
    });

    await expect(
      service.createCompensationShipment({
        salesOrderId,
        warehouseId,
        reasonCode: 'MISSED_ITEM',
        items: [{ variantId: secondVariantId, quantity: 1, salesOrderLineId }],
      }),
    ).rejects.toThrow(
      `Compensation item variant ${secondVariantId} does not match SalesOrder line ${salesOrderLineId} variant ${variantId}`,
    );

    expect(productSkuMapping.getMappingSnapshot).not.toHaveBeenCalled();
    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
    expect(state.salesOrderAmendments).toHaveLength(0);
    expect(state.businessLinks).toHaveLength(0);
  });

  it('CS 보상 출고는 새 FO 생성 전에 warehouse 존재 여부를 검증한다', async () => {
    const missingWarehouseId = '99999999-9999-9999-9999-999999999999';
    const { service, state, productSkuMapping } = makeService({ warehouses: [] });

    await expect(
      service.createCompensationShipment({
        salesOrderId,
        warehouseId: missingWarehouseId,
        reasonCode: 'MISSED_ITEM',
        items: [{ variantId, quantity: 1, salesOrderLineId }],
      }),
    ).rejects.toThrow(`Warehouse ${missingWarehouseId} not found`);

    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
    expect(state.salesOrderAmendments).toHaveLength(0);
    expect(state.businessLinks).toHaveLength(0);
  });

  it('CS 보상 출고는 여러 보상 라인을 amendment delta에 모두 남긴다', async () => {
    const { service } = makeService({
      lines: [
        {
          id: salesOrderLineId,
          salesOrderId,
          variantId,
          quantity: 1,
          mappingSnapshotId: null,
        },
        {
          id: secondSalesOrderLineId,
          salesOrderId,
          variantId: secondVariantId,
          quantity: 1,
          mappingSnapshotId: null,
        },
      ],
      matchingsByVariant: {
        [variantId]: {
          status: 'matched',
          strategy: 'variant',
          links: [{ skuId, quantity: 1 }],
        },
        [secondVariantId]: {
          status: 'matched',
          strategy: 'variant',
          links: [{ skuId, quantity: 1 }],
        },
      },
    });

    const result = await service.createCompensationShipment({
      salesOrderId,
      warehouseId,
      reasonCode: 'MISSED_ITEMS',
      items: [
        { variantId, quantity: 1, salesOrderLineId },
        { variantId: secondVariantId, quantity: 2, salesOrderLineId: secondSalesOrderLineId },
      ],
    });

    expect(result.amendment.deltas).toEqual([
      expect.objectContaining({
        type: 'fulfillment_only_correction',
        salesOrderLineId,
        metadata: { variantId, quantity: 1 },
      }),
      expect.objectContaining({
        type: 'fulfillment_only_correction',
        salesOrderLineId: secondSalesOrderLineId,
        metadata: { variantId: secondVariantId, quantity: 2 },
      }),
    ]);
  });

  it('CS 보상 출고는 기존 FO를 amendment에 링크할 수 있다', async () => {
    const { service, state, productSkuMapping, unifiedReservation } = makeService({
      fulfillmentOrders: [
        {
          id: 'fo-existing-1',
          salesOrderId: null,
          warehouseId,
          status: 'ready',
          totalItems: 1,
          totalQty: 1,
        },
      ],
    });
    const originalLines = state.salesOrderLines.map((line) => ({ ...line }));

    const result = await service.createCompensationShipment({
      salesOrderId,
      fulfillmentOrderId: 'fo-existing-1',
      reasonCode: 'MISSED_ITEM',
    });

    expect(result.fulfillmentOrder).toMatchObject({ id: 'fo-existing-1', status: 'ready' });
    expect(state.fulfillmentOrders).toHaveLength(1);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
    expect(state.salesOrderLines).toEqual(originalLines);
    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
    expect(unifiedReservation.reserveStock).not.toHaveBeenCalled();
    expect(state.businessLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'sales_order_amendment',
          targetType: 'fulfillment_order',
          targetId: 'fo-existing-1',
          relationName: 'caused_compensation_fulfillment',
        }),
        expect.objectContaining({
          sourceType: 'sales_order',
          sourceId: salesOrderId,
          targetType: 'fulfillment_order',
          targetId: 'fo-existing-1',
          relationName: 'caused_compensation_fulfillment',
        }),
      ]),
    );
  });

  it('CS 보상 출고는 주문에 연결된 기존 FO를 링크하지 않는다', async () => {
    const { service, state } = makeService({
      fulfillmentOrders: [
        {
          id: 'fo-regular-1',
          salesOrderId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          warehouseId,
          status: 'ready',
          totalItems: 1,
          totalQty: 1,
        },
      ],
    });

    await expect(
      service.createCompensationShipment({
        salesOrderId,
        fulfillmentOrderId: 'fo-regular-1',
        reasonCode: 'MISSED_ITEM',
      }),
    ).rejects.toThrow('Compensation shipment can only link standalone fulfillment orders');

    expect(state.salesOrderAmendments).toHaveLength(0);
    expect(state.businessLinks).toHaveLength(0);
  });

  it('matched + void line만 있는 sales order는 물리 FO가 필요 없다고 판별한다', async () => {
    const { service, state, unifiedReservation, outbox } = makeService({
      matching: {
        status: 'matched',
        strategy: 'void',
        links: [],
      },
    });

    await expect(service.requiresPhysicalFulfillmentOrder(salesOrderId)).resolves.toBe(false);

    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
    expect(unifiedReservation.reserveStock).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('matched + void line과 variant line이 섞이면 물리 FO가 필요하다고 판별한다', async () => {
    const { service, state } = makeService({
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

    await expect(service.requiresPhysicalFulfillmentOrder(salesOrderId)).resolves.toBe(true);

    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
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

  it('void 매칭 라인과 미해결 라인이 섞이면 void 라인은 제외하고 남은 라인만 awaiting_matching 사유로 남긴다', async () => {
    const { service, state } = makeService({
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
        [variantId]: null,
        [voidVariantId]: {
          status: 'matched',
          strategy: 'void',
          links: [],
        },
      },
    });

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

  describe('split guard', () => {
    it('shipped FO는 split이 ConflictException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-shipped', salesOrderId, warehouseId, status: 'shipped' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-shipped', skuId, qty: 3, reservedQty: 0, shippedQty: 3 },
        ],
      });

      await expect(service.split('fo-shipped', { items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 1 }] })).rejects.toThrow(
        "Cannot split FO fo-shipped in status 'shipped'",
      );
    });

    it('completed FO는 split이 ConflictException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-completed', salesOrderId, warehouseId, status: 'completed' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-completed', skuId, qty: 2, reservedQty: 0, shippedQty: 2 },
        ],
      });

      await expect(service.split('fo-completed', { items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 1 }] })).rejects.toThrow(
        "Cannot split FO fo-completed in status 'completed'",
      );
    });

    it('canceled FO는 split이 ConflictException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-canceled', salesOrderId, warehouseId, status: 'canceled' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-canceled', skuId, qty: 2, reservedQty: 0, shippedQty: 0 },
        ],
      });

      await expect(service.split('fo-canceled', { items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 1 }] })).rejects.toThrow(
        "Cannot split FO fo-canceled in status 'canceled'",
      );
    });

    it('split quantity > splittable qty이면 BadRequestException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 5, shippedQty: 3 },
        ],
      });

      // splittableQty = 5 - 3 = 2, requesting 3 → 400
      await expect(service.split('fo-ready', { items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 3 }] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('split은 originalFulfillmentOrderItemId(원본)와 newFulfillmentOrderItemId(신규)를 구분해서 lifecycle에 전달한다', async () => {
      const { service, reservationLifecycle } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-original', fulfillmentOrderId: 'fo-ready', skuId, qty: 4, reservedQty: 4, shippedQty: 0 },
        ],
      });

      const handleSplit = jest.spyOn(reservationLifecycle, 'handleFulfillmentOrderSplit' as any).mockResolvedValue(undefined);

      await service.split('fo-ready', { items: [{ fulfillmentOrderItemId: 'foi-original', quantity: 2 }] });

      expect(handleSplit).toHaveBeenCalledWith(
        'fo-ready',
        expect.any(String),
        [
          expect.objectContaining({
            originalFulfillmentOrderItemId: 'foi-original',
            newFulfillmentOrderItemId: expect.stringMatching(/^foi-/),
            skuId,
            splitQuantity: 2,
            originalQuantityBeforeSplit: 4,
          }),
        ],
        expect.anything(),
      );
    });
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
