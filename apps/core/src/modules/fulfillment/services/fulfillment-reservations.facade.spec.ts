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
      firstItemQty?: number;
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
          qty: options.firstItemQty ?? 1,
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

    // select 체인 mock: where/orderBy/limit 어디서 끊겨도 awaitable, .for('update')는 즉시 rows 반환
    const makeChain = (rowsArr: any[]) => {
      const chain: any = {
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        for: () => rowsArr,
        then: (resolve: any, reject: any) => Promise.resolve(rowsArr).then(resolve, reject),
      };
      return chain;
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
      select: jest.fn(() => ({
        from: (table: unknown) => {
          if (table === wmsTables.fulfillmentOrderItems) return makeChain([state.items[0]]);
          if (table === wmsTables.fulfillmentOrders) return makeChain([state.fo]);
          if (table === wmsTables.stockReservations) {
            return makeChain(
              (options.reservations ?? []).map((r) => ({
                targetType: 'FULFILLMENT_ORDER',
                targetId: state.fo.id,
                fulfillmentOrderItemId: state.items[0].id,
                warehouseId,
                status: 'confirmed',
                createdAt: new Date('2026-01-01'),
                ...r,
              })),
            );
          }
          return makeChain([]);
        },
      })),
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

    it('quantity가 0 이하면 BadRequestException을 던진다', async () => {
      const { facade, tx, unified } = makeFacade();

      await expect(
        facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 0 }, tx),
      ).rejects.toThrow(BadRequestException);
      expect(unified.reserveStock).not.toHaveBeenCalled();
    });

    it('FOI 부족분(qty - reservedQty)을 초과하는 over-reserve는 BadRequestException을 던진다', async () => {
      // qty=2, reservedQty=1 → 부족분 1인데 2개 예약 시도
      const { facade, tx, unified } = makeFacade({ firstItemQty: 2, firstItemReservedQty: 1 });

      await expect(
        facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 2 }, tx),
      ).rejects.toThrow(BadRequestException);
      expect(unified.reserveStock).not.toHaveBeenCalled();
    });

    it('FOI 부족분 이내의 reserve는 성공한다', async () => {
      const { facade, tx, unified } = makeFacade({ firstItemQty: 3, firstItemReservedQty: 1 });

      await facade.reserve(fulfillmentOrderId, { fulfillmentOrderItemId, quantity: 2 }, tx);

      expect(unified.reserveStock).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2 }), tx);
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
    // ─────────────────────────────────────────────────────────────
    // 헬퍼 IDs
    // ─────────────────────────────────────────────────────────────
    const fromFoiId = 'from-foi-0000-0000-0000-000000000000';
    const toFoiId = 'to-foi-0000-0000-0000-000000000000';
    const toFoId = 'to-fo-00-0000-0000-0000-000000000000';
    const otherWarehouseId = 'wh-other-0000-0000-0000-000000000000';

    /**
     * transferReservation 전용 tx 목업.
     * select().from().where().orderBy().for('update') 체인과
     * insert(stockReservations).values()를 지원한다.
     */
    function makeTransferTx(opts: {
      fromFoi: { id: string; fulfillmentOrderId: string; skuId: string; qty: number; reservedQty: number };
      toFoi: { id: string; fulfillmentOrderId: string; skuId: string; qty: number; reservedQty: number };
      fromFo: { id: string; status: string; warehouseId: string; totalReservedQty: number };
      toFo: { id: string; status: string; warehouseId: string; totalReservedQty: number };
      fromReservations?: Array<{ id: string; quantity: number }>;
    }) {
      const fromRes = (opts.fromReservations ?? [{ id: 'res-1', quantity: opts.fromFoi.reservedQty }]).map((r) => ({
        ...r,
        targetType: 'FULFILLMENT_ORDER',
        targetId: opts.fromFo.id,
        fulfillmentOrderItemId: opts.fromFoi.id,
        skuId: opts.fromFoi.skuId,
        warehouseId: opts.fromFo.warehouseId,
        status: 'confirmed',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      }));

      const captured = {
        reservationUpdates: [] as Array<Record<string, any>>,
        insertedReservations: [] as Array<Record<string, any>>,
        foiUpdateSets: [] as Array<Record<string, any>>,
        foUpdateSets: [] as Array<Record<string, any>>,
        /** select 대상 테이블 순서 — 잠금 순서 컨벤션(FO → FOI → reservation) 검증용 */
        selectTables: [] as string[],
      };

      let foQueryIdx = 0;

      const tx: any = {
        query: {
          fulfillmentOrderItems: {
            findMany: jest.fn().mockReturnValue([opts.fromFoi, opts.toFoi]),
          },
          fulfillmentOrders: {
            // refreshReservationStatus 재조회: 첫 호출=fromFo, 둘째=toFo
            findFirst: jest.fn().mockImplementation(() => {
              return foQueryIdx++ === 0 ? opts.fromFo : opts.toFo;
            }),
          },
        },
        select: jest.fn().mockReturnValue({
          // FOI select → from/to FOI, FO 잠금 select → from/to FO, reservation select → confirmed row
          from: jest.fn((table: unknown) => {
            const rows =
              table === wmsTables.fulfillmentOrderItems
                ? [opts.fromFoi, opts.toFoi]
                : table === wmsTables.fulfillmentOrders
                  ? opts.fromFo.id === opts.toFo.id
                    ? [opts.fromFo]
                    : [opts.fromFo, opts.toFo]
                  : fromRes;
            captured.selectTables.push(
              table === wmsTables.fulfillmentOrderItems
                ? 'foi'
                : table === wmsTables.fulfillmentOrders
                  ? 'fo'
                  : 'reservation',
            );
            const chain: any = {
              where: () => chain,
              orderBy: () => chain,
              limit: () => chain,
              for: () => rows,
              then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
            };
            return chain;
          }),
        }),
        update: jest.fn((table: unknown) => ({
          set: (set: Record<string, any>) => ({
            where: (_where: unknown) => {
              if (table === wmsTables.stockReservations) {
                captured.reservationUpdates.push(set);
              } else if (table === wmsTables.fulfillmentOrderItems) {
                captured.foiUpdateSets.push(set);
              } else if (table === wmsTables.fulfillmentOrders) {
                captured.foUpdateSets.push(set);
              }
              return [];
            },
          }),
        })),
        insert: jest.fn((table: unknown) => ({
          values: (value: Record<string, any>) => {
            if (table === wmsTables.stockReservations) {
              captured.insertedReservations.push(value);
            }
            return [];
          },
        })),
      };

      const unified = { reserveStock: jest.fn(), getReservationsByTarget: jest.fn(), releaseReservation: jest.fn() };
      const productSellableQuantity = { recalculateAndPublishForSku: jest.fn().mockResolvedValue(undefined) };
      const policies = { getVariantPolicy: jest.fn().mockResolvedValue({ inventoryManagement: true }) };
      const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

      const facade = new FulfillmentReservationsFacade(
        {} as any,
        unified as any,
        productSellableQuantity as any,
        policies as any,
        outbox as any,
      );

      return { facade, tx, captured, unified };
    }

    // ─────────────────────────────────────────────────────────────
    // 기본 검증 실패 케이스
    // ─────────────────────────────────────────────────────────────

    it('from FOI와 to FOI의 SKU가 다르면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId: otherSkuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('from FOI가 URL FO에 속하지 않으면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId: otherFulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: otherFulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('출처와 대상 FOI가 동일하면 BadRequestException을 던진다 (self-transfer 차단)', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 5, reservedQty: 3 },
        toFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 5, reservedQty: 3 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 3 },
        toFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 3 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: fromFoiId, quantity: 2 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);

      // 어떤 쓰기도 발생하지 않아야 한다
      expect(captured.reservationUpdates).toHaveLength(0);
      expect(captured.insertedReservations).toHaveLength(0);
      expect(captured.foiUpdateSets).toHaveLength(0);
    });

    // ─────────────────────────────────────────────────────────────
    // 신규: 성공 케이스
    // ─────────────────────────────────────────────────────────────

    it('cross-FO 이전 성공: reserveStock 미호출, 새 reservation row 삽입', async () => {
      const { facade, tx, captured, unified } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await facade.transferReservation(
        fulfillmentOrderId,
        { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
        tx,
      );

      expect(unified.reserveStock).not.toHaveBeenCalled();
      expect(captured.insertedReservations).toHaveLength(1);
      expect(captured.insertedReservations[0]).toMatchObject({
        targetType: 'FULFILLMENT_ORDER',
        targetId: toFoId,
        fulfillmentOrderItemId: toFoiId,
        skuId,
        warehouseId,
        quantity: 1,
        status: 'confirmed',
      });
    });

    it('잠금 순서 컨벤션을 지킨다: FOI 사전조회 → FO 잠금 → FOI 잠금 → reservation 잠금', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await facade.transferReservation(
        fulfillmentOrderId,
        { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
        tx,
      );

      expect(captured.selectTables).toEqual(['foi', 'fo', 'foi', 'reservation']);
    });

    it('same-FO 이전 성공: 같은 FO 내 FOI 간 이전, totalReservedQty 직접 변경 없음', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
      });

      await facade.transferReservation(
        fulfillmentOrderId,
        { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
        tx,
      );

      // same-FO이면 totalReservedQty 직접 수정(±) 없음 — refreshReservationStatus 의 FO update만 발생
      const explicitTotalUpdates = captured.foUpdateSets.filter(
        (s) => 'totalReservedQty' in s && !('status' in s),
      );
      expect(explicitTotalUpdates).toHaveLength(0);
      expect(captured.insertedReservations).toHaveLength(1);
    });

    it('from reservedQty가 정확히 0이 되는 전체 이전 성공', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
        fromReservations: [{ id: 'res-1', quantity: 2 }],
      });

      await facade.transferReservation(
        fulfillmentOrderId,
        { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 2 },
        tx,
      );

      // 예약 row 전체 해제: status=released
      expect(captured.reservationUpdates[0]).toMatchObject({ status: 'released' });
      // 신규 row는 quantity=2
      expect(captured.insertedReservations[0]).toMatchObject({ quantity: 2 });
    });

    // ─────────────────────────────────────────────────────────────
    // 신규: 실패 케이스
    // ─────────────────────────────────────────────────────────────

    it('quantity=0이면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 0 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('다른 warehouse면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId: otherWarehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('from.reservedQty 부족하면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 1 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 1 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 2 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('to 부족분이 0이면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 2 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 2 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('이전량이 to 부족분 초과하면 BadRequestException을 던진다', async () => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 5, reservedQty: 5 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 1 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 5 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 1 },
      });

      // to 부족분=1, 이전량=2
      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 2 },
          tx,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // ─────────────────────────────────────────────────────────────
    // 신규: 작업 중 상태 차단 (allocated 이후 전부)
    // ─────────────────────────────────────────────────────────────

    it.each([
      'pending', 'allocated', 'picking', 'picked',
      'inspecting', 'inspected', 'invoiced',
      'labeled', 'shipped', 'completed', 'canceled', 'forwarded',
    ])('from FO 상태 %s이면 ConflictException을 던진다', async (blockedStatus) => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: blockedStatus, warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      'pending', 'allocated', 'picking', 'picked',
      'inspecting', 'inspected', 'invoiced',
      'labeled', 'shipped', 'completed', 'canceled', 'forwarded',
    ])('to FO 상태 %s이면 ConflictException을 던진다', async (blockedStatus) => {
      const { facade, tx } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: blockedStatus, warehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(ConflictException);
    });

    // ─────────────────────────────────────────────────────────────
    // 신규: 수량 정합성
    // ─────────────────────────────────────────────────────────────

    it('이전 후 from/to reservedQty 업데이트가 정합성을 유지한다', async () => {
      const fromInitialReservedQty = 3;
      const toInitialReservedQty = 0;
      const transferQty = 2;

      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 5, reservedQty: fromInitialReservedQty },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 5, reservedQty: toInitialReservedQty },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: fromInitialReservedQty },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: toInitialReservedQty },
        fromReservations: [{ id: 'res-1', quantity: 3 }],
      });

      await facade.transferReservation(
        fulfillmentOrderId,
        { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: transferQty },
        tx,
      );

      // FOI reservedQty 변경량 검증
      const fromFoiUpdate = captured.foiUpdateSets[0];
      const toFoiUpdate = captured.foiUpdateSets[1];
      expect(fromFoiUpdate.reservedQty).toBe(fromInitialReservedQty - transferQty);
      expect(toFoiUpdate.reservedQty).toBe(toInitialReservedQty + transferQty);

      // 삽입된 새 reservation 수량 = 이전량 — confirmed row 합계 보존 법칙
      expect(captured.insertedReservations[0].quantity).toBe(transferQty);
    });

    it('cross-FO 이전 시 양쪽 FO의 refreshReservationStatus가 실행되어 totalReservedQty가 재계산된다', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
        fromReservations: [{ id: 'res-1', quantity: 2 }],
      });

      await facade.transferReservation(
        fulfillmentOrderId,
        { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
        tx,
      );

      // 수동 ± 갱신 없이 refresh가 from/to FO 각각 item 합계 기반으로 totalReservedQty를 set
      expect(captured.foUpdateSets).toHaveLength(2);
      expect(captured.foUpdateSets[0]).toHaveProperty('totalReservedQty');
      expect(captured.foUpdateSets[1]).toHaveProperty('totalReservedQty');
    });

    it('가용재고가 없는 deadlock 상황에서도 기존 예약 이동은 성공한다', async () => {
      // reserveStock은 가용재고 0이면 ConflictException을 던지도록 설정
      const { facade, tx, captured, unified } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'unfulfillable', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'unfulfillable', warehouseId, totalReservedQty: 0 },
        fromReservations: [{ id: 'res-1', quantity: 2 }],
      });
      unified.reserveStock.mockRejectedValue(new ConflictException('Insufficient stock'));

      // 새 구현은 reserveStock을 호출하지 않으므로 예외 없이 성공해야 함
      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 2 },
          tx,
        ),
      ).resolves.not.toThrow();

      expect(unified.reserveStock).not.toHaveBeenCalled();
      expect(captured.insertedReservations).toHaveLength(1);
    });
  });
});
