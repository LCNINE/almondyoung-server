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
      fromFo: {
        id: string;
        status: string;
        warehouseId: string;
        totalReservedQty: number;
        fulfillmentMode?: string | null;
      };
      toFo: {
        id: string;
        status: string;
        warehouseId: string;
        totalReservedQty: number;
        fulfillmentMode?: string | null;
      };
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

      const policies = { getVariantPolicy: jest.fn().mockResolvedValue({ inventoryManagement: true }) };

      const dbMock2 = {
        run: jest.fn((fn: (t: any) => any, aTx?: any) => fn(aTx ?? tx)),
        db: tx,
      };
      const facade = new FulfillmentReservationsFacade(
        dbMock2 as any,
        policies as any,
        { assertV2MutationAllowed: jest.fn() } as any,
      );

      return { facade, tx, captured };
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

    it('cross-FO 이전 성공: 새 reservation row 삽입', async () => {
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

    // ─────────────────────────────────────────────────────────────
    // 신규: drop_ship 가드 (from·to 양방향)
    // ─────────────────────────────────────────────────────────────

    it('fromFo가 drop_ship이면 예약 이전이 ConflictException으로 차단된다 (타사 재고 불변식)', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: {
          id: fulfillmentOrderId,
          status: 'ready',
          warehouseId,
          totalReservedQty: 2,
          fulfillmentMode: 'drop_ship',
        },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0 },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(ConflictException);
      expect(captured.insertedReservations).toHaveLength(0);
      expect(captured.reservationUpdates).toHaveLength(0);
    });

    it('toFo가 drop_ship이면 예약 주입이 ConflictException으로 차단된다 (타사 재고 불변식)', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'ready', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'created', warehouseId, totalReservedQty: 0, fulfillmentMode: 'drop_ship' },
      });

      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(ConflictException);
      expect(captured.insertedReservations).toHaveLength(0);
      expect(captured.reservationUpdates).toHaveLength(0);
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

    it('가용재고 조회 없이 기존 confirmed 예약 이동만으로 성공한다', async () => {
      const { facade, tx, captured } = makeTransferTx({
        fromFoi: { id: fromFoiId, fulfillmentOrderId, skuId, qty: 2, reservedQty: 2 },
        toFoi: { id: toFoiId, fulfillmentOrderId: toFoId, skuId, qty: 2, reservedQty: 0 },
        fromFo: { id: fulfillmentOrderId, status: 'unfulfillable', warehouseId, totalReservedQty: 2 },
        toFo: { id: toFoId, status: 'unfulfillable', warehouseId, totalReservedQty: 0 },
        fromReservations: [{ id: 'res-1', quantity: 2 }],
      });

      // transfer 는 가용재고 재확인 없이 기존 confirmed row 를 직접 이동하므로 재고 0 이어도 성공한다
      await expect(
        facade.transferReservation(
          fulfillmentOrderId,
          { fromFulfillmentOrderItemId: fromFoiId, toFulfillmentOrderItemId: toFoiId, quantity: 2 },
          tx,
        ),
      ).resolves.not.toThrow();

      expect(captured.insertedReservations).toHaveLength(1);
    });
  });
});
