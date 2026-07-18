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
    shipmentLines: Array<Record<string, any>>;
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
      if (table === wmsTables.shipmentLines) return state.shipmentLines;
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

              if (table === wmsTables.shipments) {
                const row = { id: `shipment-${state.shipments.length + 1}`, ...value };
                state.shipments.push(row);
                return [row];
              }

              if (table === wmsTables.shipmentLines) {
                const values = Array.isArray(value) ? value : [value];
                const inserted = values.map((line, index) => ({
                  id: `shipment-line-${state.shipmentLines.length + index + 1}`,
                  ...line,
                }));
                state.shipmentLines.push(...inserted);
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
      shipmentLines: [],
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
    const reservationLifecycle = {
      handleFulfillmentOrderStatusChange: jest.fn().mockResolvedValue(undefined),
      releaseLeftoverReservations: jest.fn().mockResolvedValue(0),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const shipmentReservation = {
      reservePartial: jest.fn().mockResolvedValue({ mutated: false, reservedQty: 0 }),
      recompute: jest.fn().mockResolvedValue(undefined),
    };
    const fulfillmentProgress = {
      projectOrder: jest.fn().mockReturnValue({ status: 'created' }),
    };

    const service = new FulfillmentsService(
      db as any,
      reservationLifecycle as any,
      productSkuMapping as any,
      outbox as any,
      {
        assertV2MutationAllowed: jest.fn(),
        assertOperationalMutationAllowed: jest.fn(),
      } as any,
      shipmentReservation as any,
      fulfillmentProgress as any,
    );

    return {
      service,
      state,
      tx,
      productSkuMapping,
      reservationLifecycle,
      shipmentReservation,
      fulfillmentProgress,
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
    const { service, state, productSkuMapping, shipmentReservation } = makeService({
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
    expect(shipmentReservation.reservePartial).not.toHaveBeenCalled();
  });

  it('부분 취소된 SalesOrder line 수량은 backlog retry의 FO 생성 수량에서 차감한다', async () => {
    const { service, state, shipmentReservation } = makeService({
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

    // V2 create 는 Draft shipment line 을 만들고 부분예약(reservePartial)에 위임한다 —
    // FO 상태 투영은 reservePartial 내부 몫이므로(여기서는 목) row 는 created 로 남는다.
    expect(result).toMatchObject({
      id: 'fo-1',
      status: 'created',
      totalQty: 4,
    });
    expect(state.fulfillmentOrderItems[0]).toMatchObject({
      salesOrderLineId,
      skuId,
      qty: 4,
      reservedQty: 0,
    });
    expect(state.shipmentLines).toHaveLength(1);
    expect(state.shipmentLines[0]).toMatchObject({ skuId, qty: 4 });
    expect(shipmentReservation.reservePartial).toHaveBeenCalledWith(state.shipmentLines[0].id, 4, expect.anything());
  });

  it('matched + void line만 있는 sales order는 물리 FO가 필요 없다고 판별한다', async () => {
    const { service, state, outbox } = makeService({
      matching: {
        status: 'matched',
        strategy: 'void',
        links: [],
      },
    });

    await expect(service.requiresPhysicalFulfillmentOrder(salesOrderId)).resolves.toBe(false);

    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
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

  it('matched + void line만 있는 sales order는 placeholder FO 없이 null을 반환한다', async () => {
    const { service, state, shipmentReservation, outbox } = makeService({
      matching: {
        status: 'matched',
        strategy: 'void',
        links: [],
      },
    });

    const result = await service.create({ salesOrderId, warehouseId });

    // V2 는 digital-only/void-matched 주문에 placeholder FO 를 만들지 않는다 (V1 의 completed 빈 FO 제거).
    expect(result).toBeNull();
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
    expect(shipmentReservation.reservePartial).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('matched + void line과 variant line이 섞인 주문은 물리 출고 item만 생성한다', async () => {
    const { service, state, shipmentReservation } = makeService({
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
      status: 'created',
      totalItems: 1,
      totalQty: 2,
    });
    expect(state.fulfillmentOrderItems).toHaveLength(1);
    expect(state.fulfillmentOrderItems[0]).toMatchObject({
      salesOrderLineId,
      variantId,
      skuId,
      qty: 2,
    });
    expect(shipmentReservation.reservePartial).toHaveBeenCalledTimes(1);
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

  it('sales order line 이 없으면 빈 FO를 만들지 않는다', async () => {
    const { service, state } = makeService({ lines: [] });

    await expect(service.create({ salesOrderId, warehouseId })).rejects.toThrow(
      `Sales order ${salesOrderId} has no lines`,
    );
    expect(state.fulfillmentOrders).toHaveLength(0);
    expect(state.fulfillmentOrderItems).toHaveLength(0);
  });

  it('ship은 비-drop_ship(자사) FO 를 거부한다 — 자사 출고는 consumeShipment(검수 자동완료) 경유', async () => {
    const { service } = makeService({
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
    });

    await expect(service.ship('fo-invoiced-1')).rejects.toThrow(ConflictException);
  });

  describe('ship guard', () => {
    it('이미 shipped인 FO는 idempotent return한다', async () => {
      const { service, reservationLifecycle, outbox } = makeService({
        fulfillmentOrders: [{ id: 'fo-already-shipped', salesOrderId, warehouseId, status: 'shipped' }],
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-already-shipped', skuId, qty: 2, reservedQty: 0, shippedQty: 2 },
        ],
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
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-ready', skuId, qty: 2, reservedQty: 2, shippedQty: 0 },
        ],
      });

      await expect(service.ship('fo-ready')).rejects.toThrow(ConflictException);
    });

    it.each(['invoiced', 'labeled', 'picked', 'inspecting', 'inspected'] as const)(
      '%s 상태라도 일반(비-drop_ship) FO는 ship이 ConflictException을 던진다 — 자사 출고는 consumeShipment 경유',
      async (status) => {
        const { service } = makeService({
          fulfillmentOrders: [{ id: `fo-${status}`, salesOrderId, warehouseId, status }],
          fulfillmentOrderItems: [
            { id: 'foi-1', fulfillmentOrderId: `fo-${status}`, skuId, qty: 2, reservedQty: 2, shippedQty: 0 },
          ],
        });

        await expect(service.ship(`fo-${status}`)).rejects.toThrow(ConflictException);
      },
    );

    it('drop_ship FO는 상자 없이도 출고된다 (원장 비소진)', async () => {
      const { service } = makeService({
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
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-drop-guard', skuId, qty: 2, reservedQty: 0, shippedQty: 0 },
        ],
        shipments: [],
      });

      await expect(service.ship('fo-drop-guard')).resolves.toBeDefined();
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
        fulfillmentOrderItems: [
          { id: 'foi-1', fulfillmentOrderId: 'fo-drop-forwarded', skuId, qty: 2, reservedQty: 0, shippedQty: 0 },
        ],
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

  it('ship(drop_ship)은 FulfillmentShipped outbox 이벤트를 발행한다', async () => {
    const { service, outbox } = makeService({
      fulfillmentOrders: [
        {
          id: 'fo-ship-1',
          salesOrderId,
          warehouseId,
          status: 'ready',
          fulfillmentMode: 'drop_ship',
          directShipStatus: 'forwarded',
        },
      ],
      fulfillmentOrderItems: [
        { id: 'foi-ship-1', fulfillmentOrderId: 'fo-ship-1', skuId, qty: 3, reservedQty: 0, shippedQty: 0 },
      ],
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

  it('legacy markDelivered는 FO 이벤트만 발행하고 attempt-owned shipment tracking을 만들지 않는다', async () => {
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

  describe('발생원 예약 sweep (작업 11 P1-3)', () => {
    it('ship(drop_ship) 이 잔존 예약 방어 sweep 을 같은 tx 로 호출한다', async () => {
      const { service, reservationLifecycle } = makeService({
        fulfillmentOrders: [
          {
            id: 'fo-ship-1',
            salesOrderId,
            warehouseId,
            status: 'ready',
            fulfillmentMode: 'drop_ship',
            directShipStatus: 'forwarded',
          },
        ],
        fulfillmentOrderItems: [
          { id: 'foi-ship-1', fulfillmentOrderId: 'fo-ship-1', skuId, qty: 3, reservedQty: 0, shippedQty: 0 },
        ],
      });

      await service.ship('fo-ship-1');

      expect(reservationLifecycle.releaseLeftoverReservations).toHaveBeenCalledWith(
        'fo-ship-1',
        'reconcile: drop_ship invariant sweep',
        expect.anything(),
      );
    });

    it('markDelivered 가 잔존 예약 방어 sweep 을 같은 tx 로 호출한다', async () => {
      const { service, reservationLifecycle } = makeService({
        fulfillmentOrders: [{ id: 'fo-delivered-1', salesOrderId, warehouseId, status: 'shipped' }],
        shipments: [{ id: 'shipment-2', fulfillmentOrderId: 'fo-delivered-1', trackingNo: 'TRK-002', carrier: 'CJ' }],
      });

      await service.markDelivered('fo-delivered-1');

      expect(reservationLifecycle.releaseLeftoverReservations).toHaveBeenCalledWith(
        'fo-delivered-1',
        'reconcile: FO delivered leftover',
        expect.anything(),
      );
    });
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

    it('invoiced 상태에서 ship이 더 이상 광고되지 않는다 (라우트 은퇴)', async () => {
      const { service, tx } = makeFoDetail('invoiced');
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).not.toContain('ship');
    });

    it('ready 상태에서 ship/split/reserve/unreserve/transfer 없이 cancel만 있다 (수동 예약 라우트 은퇴)', async () => {
      const { service, tx } = makeFoDetail('ready');
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).not.toContain('ship');
      expect(detail?.adminAvailableActions).not.toContain('split');
      expect(detail?.adminAvailableActions).not.toContain('reserve');
      expect(detail?.adminAvailableActions).not.toContain('unreserve');
      expect(detail?.adminAvailableActions).not.toContain('transferReservation');
      expect(detail?.adminAvailableActions).toEqual(['cancel']);
      expect(detail?.blockedReasons).toHaveLength(0);
    });

    it('shipped item이 있으면 SHIPPED_EVIDENCE를 추가한다 (cancel 은 유지)', async () => {
      const { service, tx } = makeFoDetail('ready', { shippedQty: 1 });
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).toContain('cancel');
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

  describe('computeAdminAvailableActions (drop_ship 가드)', () => {
    it('drop_ship non-terminal FO는 cancel/forwardDropShip을 광고한다', () => {
      const { service } = makeService();
      const actions = (service as any)['computeAdminAvailableActions']({
        status: 'created',
        fulfillmentMode: 'drop_ship',
        directShipStatus: null,
      });
      expect(actions).toContain('cancel');
      expect(actions).toContain('forwardDropShip');
    });

    it('null-mode(in_house 기본) FO는 drop_ship 액션을 광고하지 않는다 (nullable mode 회귀)', () => {
      const { service } = makeService();
      const actions = (service as any)['computeAdminAvailableActions']({
        status: 'created',
        fulfillmentMode: null,
        directShipStatus: null,
      });
      expect(actions).toContain('cancel');
      expect(actions).not.toContain('forwardDropShip');
      expect(actions).not.toContain('completeDropShip');
    });
  });
});
