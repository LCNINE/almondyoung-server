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

  type QueryRows<T> = T[] & {
    limit: (count: number) => QueryRows<T>;
    offset: (count: number) => QueryRows<T>;
    orderBy: (...args: unknown[]) => QueryRows<T>;
  };

  function rows<T>(value: T[]): QueryRows<T> {
    const result = [...value] as QueryRows<T>;
    result.limit = (count: number) => rows(result.slice(0, count));
    result.offset = (count: number) => rows(result.slice(count));
    result.orderBy = () => result;
    result.for = () => result;
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
        from: (table: unknown) => {
          const result = rows(selectRowsFor(table));
          const query: any = {
            innerJoin: () => query,
            where: (_where: unknown) => result,
            limit: (count: number) => result.limit(count),
            orderBy: (...args: unknown[]) => result.orderBy(...args),
          };
          return query;
        },
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
    const db = {
      db: { transaction: jest.fn((fn) => fn(tx)) },
      run: jest.fn((fn: (t: any) => any, aTx?: any) => fn(aTx ?? tx)),
    };
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
    const outboundConsumption = {
      ensureShipmentLines: jest.fn().mockResolvedValue(undefined),
      consumeShipment: jest.fn().mockResolvedValue(undefined),
    };
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
      outboundConsumption as any,
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
      outboundConsumption,
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
    // FulfillmentReady 는 구독 서비스가 없어 발행하지 않는다 (FO 상태는 ready 로 전환됨).
    expect(outbox.enqueue.mock.calls.map(([event]) => event.eventType)).not.toContain('FulfillmentReady');
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

  it('디지털 라인만 있는 sales order는 물리 FO가 필요 없다고 판별한다', async () => {
    const { service, productSkuMapping } = makeService({
      lines: [
        {
          id: salesOrderLineId,
          salesOrderId,
          variantId,
          quantity: 1,
          mappingSnapshotId: null,
          fulfillmentKind: 'digital',
          requiresShipping: false,
        },
      ],
    });

    await expect(service.requiresPhysicalFulfillmentOrder(salesOrderId)).resolves.toBe(false);
    // 디지털 라인은 matching 조회 이전에 제외된다.
    expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
  });

  it('디지털 라인과 물리 라인이 섞이면 물리 FO가 필요하다고 판별한다 (디지털 라인은 제외)', async () => {
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
          id: voidSalesOrderLineId,
          salesOrderId,
          variantId: voidVariantId,
          quantity: 1,
          mappingSnapshotId: null,
          fulfillmentKind: 'digital',
          requiresShipping: false,
        },
      ],
      matchingsByVariant: {
        [variantId]: {
          status: 'matched',
          strategy: 'variant',
          links: [{ skuId, quantity: 1 }],
        },
      },
    });

    await expect(service.requiresPhysicalFulfillmentOrder(salesOrderId)).resolves.toBe(true);
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
    // FulfillmentCreated 는 구독 서비스가 없어 발행하지 않는다.
    expect(outbox.enqueue.mock.calls.map(([event]) => event.eventType)).toEqual([]);
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
    // FulfillmentReady 는 구독 서비스가 없어 발행하지 않는다 (FO 상태는 ready 로 전환됨).
    expect(outbox.enqueue.mock.calls.map(([event]) => event.eventType)).not.toContain('FulfillmentReady');
  });

  it('sales order line 이 없으면 빈 FO를 만들지 않는다', async () => {
    const { service, state } = makeService({ lines: [] });

    await expect(service.create({ salesOrderId, warehouseId })).rejects.toThrow(
      `Sales order ${salesOrderId} has no lines`,
    );
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
  });

  it('ship은 출고분을 재고원장에서 소진한다 (lifecycle release 가 아니라 consume 경로)', async () => {
    const { service, outboundConsumption, reservationLifecycle } = makeService({
      fulfillmentOrders: [
        {
          id: 'fo-invoiced-1',
          salesOrderId,
          warehouseId,
          status: 'invoiced',
        },
      ],
      fulfillmentOrderItems: [
        {
          id: 'foi-invoiced-1',
          fulfillmentOrderId: 'fo-invoiced-1',
          skuId,
          qty: 2,
          reservedQty: 2,
        },
      ],
      shipments: [
        {
          id: 'shipment-invoiced-1',
          fulfillmentOrderId: 'fo-invoiced-1',
          carrier: 'CJ',
          trackingNo: 'TRACK-1',
        },
      ],
    });

    await service.ship('fo-invoiced-1');

    // 상자 단위 소진 seam 으로 위임된다 (상자 라인 생성 → SHIP 이벤트 + 예약 소진).
    expect(outboundConsumption.ensureShipmentLines).toHaveBeenCalledWith(
      'shipment-invoiced-1',
      'fo-invoiced-1',
      expect.anything(),
    );
    expect(outboundConsumption.consumeShipment).toHaveBeenCalledWith('shipment-invoiced-1', expect.anything());
    // 옛 버그 경로('shipped' release) 는 더 이상 타지 않는다.
    expect(reservationLifecycle.handleFulfillmentOrderStatusChange).not.toHaveBeenCalledWith(
      'fo-invoiced-1',
      'invoiced',
      'shipped',
      expect.anything(),
    );
  });

  describe('ship guard', () => {
    it('이미 shipped인 FO는 idempotent return한다', async () => {
      const { service, reservationLifecycle, outbox } = makeService({
        fulfillmentOrders: [{ id: 'fo-already-shipped', salesOrderId, warehouseId, status: 'shipped' }],
        fulfillmentOrderItems: [{ id: 'foi-1', fulfillmentOrderId: 'fo-already-shipped', skuId, qty: 2, reservedQty: 0, shippedQty: 2 }],
        shipments: [{ fulfillmentOrderId: 'fo-already-shipped', carrier: 'CJ', trackingNo: 'TRK-X' }],
      });

      await expect(service.ship('fo-already-shipped')).resolves.toBeDefined();
      expect(reservationLifecycle.handleFulfillmentOrderStatusChange).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('completed FO는 ship이 ConflictException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-completed', salesOrderId, warehouseId, status: 'completed' }],
        fulfillmentOrderItems: [],
      });

      await expect(service.ship('fo-completed')).rejects.toThrow(ConflictException);
    });

    it('canceled FO는 ship이 ConflictException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-canceled', salesOrderId, warehouseId, status: 'canceled' }],
        fulfillmentOrderItems: [],
      });

      await expect(service.ship('fo-canceled')).rejects.toThrow(ConflictException);
    });

    it('ready 상태 일반 FO는 ship이 ConflictException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [{ id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 2, reservedQty: 2, shippedQty: 0 }],
      });

      await expect(service.ship('fo-ready')).rejects.toThrow(ConflictException);
    });

    it.each(['invoiced', 'labeled', 'picked', 'inspecting', 'inspected'] as const)(
      '%s 상태 일반 FO는 ship을 허용한다',
      async (status) => {
        const { service } = makeService({
          fulfillmentOrders: [{ id: `fo-${status}`, salesOrderId, warehouseId, status }],
          fulfillmentOrderItems: [{ id: 'foi-1', fulfillmentOrderId: `fo-${status}`, skuId, qty: 2, reservedQty: 2, shippedQty: 0 }],
          shipments: [{ fulfillmentOrderId: `fo-${status}`, carrier: 'CJ', trackingNo: 'TRK-1' }],
        });

        await expect(service.ship(`fo-${status}`)).resolves.toBeDefined();
      },
    );

    it('자사 FO에 상자(shipment)가 없으면 ship이 fail-loud로 ConflictException을 던진다', async () => {
      const { service, outboundConsumption } = makeService({
        fulfillmentOrders: [{ id: 'fo-no-shipment', salesOrderId, warehouseId, status: 'inspected' }],
        fulfillmentOrderItems: [{ id: 'foi-1', fulfillmentOrderId: 'fo-no-shipment', skuId, qty: 2, reservedQty: 2, shippedQty: 0 }],
        shipments: [],
      });

      await expect(service.ship('fo-no-shipment')).rejects.toThrow(ConflictException);
      // 상자가 없으면 소진 경로로 진입하지 않는다.
      expect(outboundConsumption.consumeShipment).not.toHaveBeenCalled();
      expect(outboundConsumption.ensureShipmentLines).not.toHaveBeenCalled();
    });

    it('drop_ship FO는 상자 없이도 출고되지만 재고원장을 소진하지 않는다 (가드)', async () => {
      const { service, outboundConsumption } = makeService({
        fulfillmentOrders: [
          {
            id: 'fo-drop-guard',
            salesOrderId,
            warehouseId,
            status: 'ready',
            fulfillmentMode: 'drop_ship',
            directShipStatus: 'forwarded',
          },
        ],
        fulfillmentOrderItems: [{ id: 'foi-1', fulfillmentOrderId: 'fo-drop-guard', skuId, qty: 2, reservedQty: 0, shippedQty: 0 }],
        shipments: [],
      });

      await expect(service.ship('fo-drop-guard')).resolves.toBeDefined();
      // 타사 소유 재고 — 원장 비소진, 상자 라인 생성도 안 함.
      expect(outboundConsumption.consumeShipment).not.toHaveBeenCalled();
      expect(outboundConsumption.ensureShipmentLines).not.toHaveBeenCalled();
    });

    it('drop_ship FO는 directShipStatus=forwarded일 때만 ship을 허용한다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [
          {
            id: 'fo-drop-forwarded',
            salesOrderId,
            warehouseId,
            status: 'ready',
            fulfillmentMode: 'drop_ship',
            directShipStatus: 'forwarded',
          },
        ],
        fulfillmentOrderItems: [{ id: 'foi-1', fulfillmentOrderId: 'fo-drop-forwarded', skuId, qty: 2, reservedQty: 0, shippedQty: 0 }],
      });

      await expect(service.ship('fo-drop-forwarded')).resolves.toBeDefined();
    });

    it('drop_ship FO에서 directShipStatus=pending이면 ship이 ConflictException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [
          {
            id: 'fo-drop-pending',
            salesOrderId,
            warehouseId,
            status: 'ready',
            fulfillmentMode: 'drop_ship',
            directShipStatus: 'pending',
          },
        ],
        fulfillmentOrderItems: [],
      });

      await expect(service.ship('fo-drop-pending')).rejects.toThrow(ConflictException);
    });
  });

  describe('assignShipment guard', () => {
    it('terminal 상태 FO에 shipment 등록 시 ConflictException을 던진다', async () => {
      for (const status of ['shipped', 'completed', 'canceled']) {
        const { service } = makeService({
          fulfillmentOrders: [{ id: `fo-${status}`, salesOrderId, warehouseId, status }],
          fulfillmentOrderItems: [],
          shipments: [],
        });

        await expect(
          service.assignShipment(`fo-${status}`, { trackingNo: 'TRK-1' }),
        ).rejects.toThrow(ConflictException);
      }
    });

    it('이미 shipment가 있는 FO에 중복 등록 시 ConflictException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-labeled', salesOrderId, warehouseId, status: 'labeled' }],
        fulfillmentOrderItems: [],
        shipments: [{ id: 'ship-existing', fulfillmentOrderId: 'fo-labeled', trackingNo: 'TRK-1' }],
      });

      await expect(service.assignShipment('fo-labeled', { trackingNo: 'TRK-2' })).rejects.toThrow(ConflictException);
    });

    it.each(['picked', 'inspecting', 'inspected', 'invoiced'] as const)(
      '%s 상태에서 assignShipment는 상태를 labeled로 역전이하지 않는다',
      async (status) => {
        const { service, state } = makeService({
          fulfillmentOrders: [{ id: `fo-${status}`, salesOrderId, warehouseId, status }],
          fulfillmentOrderItems: [],
          shipments: [],
        });

        await service.assignShipment(`fo-${status}`, { trackingNo: 'TRK-NEW' });

        expect(state.fulfillmentOrders[0].status).toBe(status);
      },
    );

    it('ready 상태에서 assignShipment는 labeled로 전환한다', async () => {
      const { service, state } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [],
        shipments: [],
      });

      await service.assignShipment('fo-ready', { trackingNo: 'TRK-READY' });

      expect(state.fulfillmentOrders[0].status).toBe('labeled');
    });
  });

  it('ship은 FulfillmentShipped outbox 이벤트를 발행한다', async () => {
    const { service, outbox } = makeService({
      fulfillmentOrders: [{ id: 'fo-ship-1', salesOrderId, warehouseId, status: 'invoiced' }],
      fulfillmentOrderItems: [{ id: 'foi-ship-1', fulfillmentOrderId: 'fo-ship-1', skuId, qty: 3, reservedQty: 3, shippedQty: 0 }],
      shipments: [{ id: 'shipment-1', fulfillmentOrderId: 'fo-ship-1', carrier: 'CJ', trackingNo: 'TRK-001' }],
    });

    await service.ship('fo-ship-1');

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'FulfillmentShipped' }),
      expect.anything(),
    );
  });

  describe('markDelivered guard', () => {
    it.each(['ready', 'labeled', 'invoiced', 'canceled', 'completed'] as const)(
      '%s 상태 FO는 markDelivered가 ConflictException을 던진다',
      async (status) => {
        const { service } = makeService({
          fulfillmentOrders: [{ id: `fo-${status}`, salesOrderId, warehouseId, status }],
          shipments: [],
        });

        await expect(service.markDelivered(`fo-${status}`)).rejects.toThrow(ConflictException);
      },
    );
  });

  it('markDelivered는 FulfillmentDelivered outbox 이벤트를 발행하고 shipment를 delivered로 업데이트한다', async () => {
    const { service, outbox } = makeService({
      fulfillmentOrders: [{ id: 'fo-delivered-1', salesOrderId, warehouseId, status: 'shipped' }],
      shipments: [{ id: 'shipment-2', fulfillmentOrderId: 'fo-delivered-1', trackingNo: 'TRK-002', carrier: 'CJ' }],
    });

    await service.markDelivered('fo-delivered-1');

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'FulfillmentDelivered' }),
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

    it('같은 FOI가 중복으로 들어오면 BadRequestException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 5, shippedQty: 0 },
        ],
      });

      await expect(
        service.split('fo-ready', {
          items: [
            { fulfillmentOrderItemId: 'foi-1', quantity: 1 },
            { fulfillmentOrderItemId: 'foi-1', quantity: 1 },
          ],
        }),
      ).rejects.toThrow('Duplicate fulfillmentOrderItemId');
    });

    it('quantity가 0 이하면 BadRequestException을 던진다 (items 경로)', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 5, shippedQty: 0 },
        ],
      });

      await expect(
        service.split('fo-ready', { items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 0 }] }),
      ).rejects.toThrow('Split quantity must be greater than 0');
    });

    it('quantity가 음수면 BadRequestException을 던진다 (legacy lines 경로)', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 5, shippedQty: 0 },
        ],
      });

      await expect(
        service.split('fo-ready', { lines: [{ fulfillmentOrderLineId: 'foi-1', quantity: -1 }] }),
      ).rejects.toThrow('Split quantity must be greater than 0');
    });

    it('존재하지 않는 FOI id가 들어오면 BadRequestException을 던진다 (silent skip 금지)', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 5, shippedQty: 0 },
        ],
      });

      await expect(
        service.split('fo-ready', { items: [{ fulfillmentOrderItemId: 'foi-unknown', quantity: 1 }] }),
      ).rejects.toThrow('not found in FO fo-ready');
    });

    it('legacy lines 경로: 다른 FO 소속 FOI는 BadRequestException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-foreign', fulfillmentOrderId: 'fo-other', skuId, qty: 5, reservedQty: 5, shippedQty: 0 },
        ],
      });

      await expect(
        service.split('fo-ready', { lines: [{ fulfillmentOrderLineId: 'foi-foreign', quantity: 1 }] }),
      ).rejects.toThrow('not found in FO fo-ready');
    });

    it('legacy lines 경로: 같은 line이 중복으로 들어오면 BadRequestException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 5, shippedQty: 0 },
        ],
      });

      await expect(
        service.split('fo-ready', {
          lines: [
            { fulfillmentOrderLineId: 'foi-1', quantity: 1 },
            { fulfillmentOrderLineId: 'foi-1', quantity: 1 },
          ],
        }),
      ).rejects.toThrow('Duplicate fulfillmentOrderLineId');
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

    it('shippedQty=0인 FOI 전체 수량을 분할하면 BadRequestException을 던진다', async () => {
      const { service } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 0, shippedQty: 0 },
        ],
      });

      // 전체 5개 분할 시도 → 원본에 0개 잔존 → 차단
      await expect(service.split('fo-ready', { items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 5 }] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('shippedQty > 0이면 splittable qty 전체 분할이 허용된다', async () => {
      const { service, state } = makeService({
        fulfillmentOrders: [{ id: 'fo-ready', salesOrderId, warehouseId, status: 'ready', totalQty: 5, totalItems: 1 }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 3, shippedQty: 3 },
        ],
      });

      // splittableQty = 5 - 3 = 2, 전부 분할해도 원본에 shippedQty=3이 남음 → 허용
      await service.split('fo-ready', { items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 2 }] });
      const originalFoi = state.fulfillmentOrderItems.find((i) => i.id === 'foi-1');
      expect(originalFoi?.qty).toBe(3); // 5 - 2 = 3 (= shippedQty)
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

    it('split 후 원본 FO의 totalQty가 분할 수량만큼 감소한다', async () => {
      const { service, state } = makeService({
        fulfillmentOrders: [
          { id: 'fo-ready', salesOrderId, warehouseId, status: 'ready', totalQty: 5, totalItems: 1 },
        ],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 5, reservedQty: 0, shippedQty: 0 },
        ],
      });

      const newFo = await service.split('fo-ready', {
        items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 3 }],
      });

      // 반환된 신규 FO는 분할 수량
      expect(newFo?.totalQty).toBe(3);

      // 원본 FO는 분할 수량만큼 감소 (mock 제약으로 상태에서 id로 구분)
      const originFo = state.fulfillmentOrders.find((fo) => fo.id === 'fo-ready');
      expect(originFo?.totalQty).toBe(2); // 5 - 3
    });

    it('split 후 원본 FOI의 qty가 분할 수량만큼 감소한다', async () => {
      const { service, state } = makeService({
        fulfillmentOrders: [
          { id: 'fo-ready', salesOrderId, warehouseId, status: 'ready', totalQty: 4, totalItems: 1 },
        ],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 4, reservedQty: 4, shippedQty: 0 },
        ],
      });

      await service.split('fo-ready', {
        items: [{ fulfillmentOrderItemId: 'foi-1', quantity: 1 }],
      });

      const originalFoi = state.fulfillmentOrderItems.find((i) => i.id === 'foi-1');
      expect(originalFoi?.qty).toBe(3); // 4 - 1
    });
  });

  it('getOne은 상세 운영 화면에 필요한 배송, 예약, 액션 정보를 반환한다', async () => {
    const { service, tx } = makeService({
      fulfillmentOrders: [
        {
          id: 'fo-detail',
          salesOrderId,
          warehouseId,
          status: 'picked',
          fulfillmentMode: 'in_house',
          directShipStatus: null,
          batchId: null,
        },
      ],
      fulfillmentOrderItems: [
        {
          id: 'foi-detail',
          fulfillmentOrderId: 'fo-detail',
          salesOrderId,
          salesOrderLineId,
          variantId,
          skuId,
          skuCode: 'SKU-001',
          skuName: '상세 테스트 SKU',
          qty: 2,
          reservedQty: 2,
          pickedQty: 2,
          shippedQty: 0,
          status: 'picked',
        },
      ],
      shipments: [
        {
          id: 'shipment-detail',
          fulfillmentOrderId: 'fo-detail',
          trackingNo: 'TRACK-001',
          carrier: 'CJ',
          status: 'ready',
          eta: null,
          invoiceUrl: null,
        },
      ],
    });

    const detail = await service.getOne('fo-detail', tx);

    expect(detail?.id).toBe('fo-detail');
    expect(detail?.shipment).toMatchObject({
      id: 'shipment-detail',
      trackingNo: 'TRACK-001',
    });
    expect(detail?.batch).toBeNull();
    expect(detail?.reservations).toHaveLength(0);
    expect(detail?.blockedReasons).toHaveLength(0);
    expect(detail?.items[0]).toMatchObject({
      id: 'foi-detail',
      skuCode: 'SKU-001',
    });
    expect(detail?.adminAvailableActions).toEqual(
      expect.arrayContaining(['split', 'reserve', 'assignShipment', 'cancel', 'ship']),
    );
  });

  describe('computeAdminAvailableActions / computeBlockedReasons', () => {
    function makeFoDetail(
      status: string,
      options: {
        fulfillmentMode?: string;
        directShipStatus?: string | null;
        shippedQty?: number;
      } = {},
    ) {
      const { fulfillmentMode = 'in_house', directShipStatus = null, shippedQty = 0 } = options;
      return makeService({
        fulfillmentOrders: [
          {
            id: 'fo-action-test',
            salesOrderId,
            warehouseId,
            status,
            fulfillmentMode,
            directShipStatus,
            batchId: null,
          },
        ],
        fulfillmentOrderItems: [
          {
            id: 'foi-action-test',
            fulfillmentOrderId: 'fo-action-test',
            salesOrderId,
            salesOrderLineId,
            variantId,
            skuId,
            qty: 2,
            reservedQty: 2,
            pickedQty: 0,
            shippedQty,
            status: 'ready',
          },
        ],
      });
    }

    it('shipped 상태에서 deliver만 허용하고 TERMINAL_STATUS blockedReason을 반환한다', async () => {
      const { service, tx } = makeFoDetail('shipped');
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).toEqual(['deliver']);
      expect(detail?.blockedReasons).toContain('TERMINAL_STATUS');
    });

    it('completed 상태에서 액션이 없고 TERMINAL_STATUS blockedReason을 반환한다', async () => {
      const { service, tx } = makeFoDetail('completed');
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).toHaveLength(0);
      expect(detail?.blockedReasons).toContain('TERMINAL_STATUS');
    });

    it('canceled 상태에서 액션이 없고 TERMINAL_STATUS blockedReason을 반환한다', async () => {
      const { service, tx } = makeFoDetail('canceled');
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).toHaveLength(0);
      expect(detail?.blockedReasons).toContain('TERMINAL_STATUS');
    });

    it('inspected 상태에서 ship이 허용된다', async () => {
      const { service, tx } = makeFoDetail('inspected');
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).toContain('ship');
    });

    it('ready 상태에서 ship이 없고 split/reserve/unreserve/transferReservation/assignShipment/cancel이 있다', async () => {
      const { service, tx } = makeFoDetail('ready');
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).not.toContain('ship');
      expect(detail?.adminAvailableActions).toEqual(
        expect.arrayContaining(['split', 'reserve', 'unreserve', 'transferReservation', 'assignShipment', 'cancel']),
      );
      expect(detail?.blockedReasons).toHaveLength(0);
    });

    it('shipped item이 있으면 split/unreserve/transferReservation을 제거하고 SHIPPED_EVIDENCE를 추가한다', async () => {
      const { service, tx } = makeFoDetail('ready', { shippedQty: 1 });
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).not.toContain('split');
      expect(detail?.adminAvailableActions).not.toContain('unreserve');
      expect(detail?.adminAvailableActions).not.toContain('transferReservation');
      expect(detail?.adminAvailableActions).toContain('reserve');
      expect(detail?.adminAvailableActions).toContain('assignShipment');
      expect(detail?.blockedReasons).toContain('SHIPPED_EVIDENCE');
    });

    it('terminal 상태 + shipped item이면 TERMINAL_STATUS와 SHIPPED_EVIDENCE 둘 다 반환한다', async () => {
      const { service, tx } = makeFoDetail('shipped', { shippedQty: 2 });
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.blockedReasons).toContain('TERMINAL_STATUS');
      expect(detail?.blockedReasons).toContain('SHIPPED_EVIDENCE');
    });

    it('drop_ship + directShipStatus 미설정이면 forwardDropShip을 허용한다', async () => {
      const { service, tx } = makeFoDetail('ready', { fulfillmentMode: 'drop_ship', directShipStatus: null });
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).toContain('forwardDropShip');
      expect(detail?.adminAvailableActions).not.toContain('completeDropShip');
    });

    it('drop_ship + directShipStatus=pending이면 forwardDropShip을 허용한다', async () => {
      const { service, tx } = makeFoDetail('ready', { fulfillmentMode: 'drop_ship', directShipStatus: 'pending' });
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).toContain('forwardDropShip');
      expect(detail?.adminAvailableActions).not.toContain('completeDropShip');
    });

    it('drop_ship + directShipStatus=forwarded이면 completeDropShip만 허용한다', async () => {
      const { service, tx } = makeFoDetail('ready', { fulfillmentMode: 'drop_ship', directShipStatus: 'forwarded' });
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).toContain('completeDropShip');
      expect(detail?.adminAvailableActions).not.toContain('forwardDropShip');
    });

    it('drop_ship terminal FO에서는 forwardDropShip/completeDropShip을 허용하지 않는다', async () => {
      const { service, tx } = makeFoDetail('canceled', { fulfillmentMode: 'drop_ship', directShipStatus: 'forwarded' });
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).not.toContain('forwardDropShip');
      expect(detail?.adminAvailableActions).not.toContain('completeDropShip');
    });

    it('in_house FO에서는 drop_ship 관련 액션이 없다', async () => {
      const { service, tx } = makeFoDetail('ready', { fulfillmentMode: 'in_house' });
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).not.toContain('forwardDropShip');
      expect(detail?.adminAvailableActions).not.toContain('completeDropShip');
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
