import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { seedReturnBin, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('박스에서 되돌림 바구니로 (스펙 §8, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 첫 박스(수량 2)를 custody 로 전부 집고 뺀다 — withdrawing, 뺄 몫 2. */
  async function withdrawnPicked(tx: DbTx, custody: 'WORKER' | 'PACKING' | 'PACKED' = 'PACKING') {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: first.actorId,
        quantity: 2,
        from: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: first.skuId,
          sourceLocationId: first.locationId,
          custodyType: custody === 'WORKER' ? 'WORKER' : 'PACKING',
          custodyRef: custody === 'WORKER' ? first.actorId : `work-item:${first.workItemId}`,
          shipmentLineId: first.shipmentLineId,
        },
      },
      tx,
    );
    if (custody === 'PACKED') {
      // 검수까지 끝난 모양 — PACKING → PACKED 와 inspected_qty 를 같이 올린다(검수 경로와 같다).
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: first.actorId,
          quantity: 2,
          from: {
            skuId: first.skuId,
            sourceLocationId: first.locationId,
            custodyType: 'PACKING',
            custodyRef: `work-item:${first.workItemId}`,
            shipmentLineId: first.shipmentLineId,
          },
          to: {
            skuId: first.skuId,
            sourceLocationId: first.locationId,
            custodyType: 'PACKED',
            custodyRef: `work-item:${first.workItemId}`,
            shipmentLineId: first.shipmentLineId,
          },
        },
        tx,
      );
      await tx
        .update(wmsTables.shipmentLines)
        .set({ inspectedQty: 2 })
        .where(eq(wmsTables.shipmentLines.id, first.shipmentLineId));
    }
    await wiring.batches.excludeShipment(
      first.batchId,
      first.shipmentId,
      { reason: '고객 요청' },
      `x-${randomUUID()}`,
      actor,
      tx,
    );
    const bin = await seedReturnBin(tx, first.warehouseId, first.actorId);
    return { first, second, wiring, sessionId: run.sessionId, bin };
  }

  const remove = (
    wiring: ReturnType<typeof assembleOutbound>,
    shipmentId: string,
    input: { barcode: string; returnBinBarcode: string; quantity?: number },
    tx: DbTx,
    key = `r-${randomUUID()}`,
  ) => wiring.returns.removeToReturnBin(shipmentId, { quantity: 1, ...input }, actor, key, tx);

  it('상품을 스캔할 때마다 1 개씩 바구니로 — 마지막 한 개에서 excluded, 박스는 planned', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId, bin } = await withdrawnPicked(tx);
      const firstScan = await remove(
        wiring,
        first.shipmentId,
        { barcode: first.barcode, returnBinBarcode: bin.barcode },
        tx,
      );
      expect(firstScan).toMatchObject({ removedQty: 1, exited: false });
      expect(firstScan.removals).toEqual([expect.objectContaining({ boxQty: 1, cartQty: 0 })]);
      // 화면의 최근 목록이 바코드 숫자 대신 상품 이름을 쓰게 — 마지막 한 개로 removals 가 비어도 실린다(아래 last)
      const [sku] = await tx
        .select({ name: wmsTables.skus.name })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, first.skuId));
      expect(firstScan.removedSkuName).toBe(sku.name);

      const last = await remove(
        wiring,
        first.shipmentId,
        { barcode: first.barcode, returnBinBarcode: bin.barcode },
        tx,
      );
      expect(last).toMatchObject({
        removedQty: 1,
        exited: true,
        exitTo: 'draft',
        removals: [],
        removedSkuName: sku.name,
      });

      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, first.workItemId));
      expect(item.status).toBe('excluded');
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, first.shipmentId));
      expect(shipment.status).toBe('planned');
      const pending = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'RETURN_PENDING'),
          ),
        );
      expect(pending.map((b) => [b.custodyRef, b.qty])).toEqual([[bin.barcode, 2]]);
      // 바구니의 물건은 아직 선반에 없다 — 일반 가용으로 돌아가지 않는다.
      const availability = await new BatchControlledStockGuard().getAvailability(
        { skuId: first.skuId, warehouseId: first.warehouseId, sourceLocationId: first.locationId },
        tx,
      );
      expect(availability.batchControlledQty).toBe(3); // 바구니 2 + 둘째 박스 AT_SOURCE 1
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('검수까지 끝난(PACKED) 상품을 빼면 inspected_qty 도 준다 — 다 빼면 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, bin } = await withdrawnPicked(tx, 'PACKED');
      await remove(
        wiring,
        first.shipmentId,
        { barcode: first.barcode, returnBinBarcode: bin.barcode, quantity: 2 },
        tx,
      );
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, first.shipmentLineId));
      expect(line.inspectedQty).toBe(0);
    });
  });

  it('박스에 없는 상품이거나 뺄 몫보다 많으면 REMOVAL_NOT_PENDING 이고 아무것도 바뀌지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, bin } = await withdrawnPicked(tx, 'WORKER');
      await expect(
        tx.transaction((trx) =>
          remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode, quantity: 3 }, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'REMOVAL_NOT_PENDING' } });
      // 빼는 중이 아닌 박스
      await expect(
        tx.transaction((trx) =>
          remove(wiring, second.shipmentId, { barcode: second.barcode, returnBinBarcode: bin.barcode }, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_NOT_WITHDRAWING' } });
      // 등록 안 된 바구니
      await expect(
        tx.transaction((trx) =>
          remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: 'RB-none' }, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_UNKNOWN' } });
      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      expect(allocation.qty).toBe(2);
    });
  });

  it('같은 멱등 키로 다시 보내면 한 번만 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, bin } = await withdrawnPicked(tx);
      const key = `r-${randomUUID()}`;
      await remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode }, tx, key);
      await remove(wiring, first.shipmentId, { barcode: first.barcode, returnBinBarcode: bin.barcode }, tx, key);
      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      expect(allocation.qty).toBe(1);
    });
  });

  it('전체 취소로 빼는 박스(E10)는 마지막 몫을 넣는 스캔에서 송장 무효·예약 해제·박스 canceled·취소 완료까지 끝난다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      const wiring = assembleOutbound(tx);
      const run = await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: second.actorId,
          quantity: 1,
          from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: second.skuId,
            sourceLocationId: second.locationId,
            custodyType: 'PACKING',
            custodyRef: `work-item:${second.workItemId}`,
            shipmentLineId: second.shipmentLineId,
          },
        },
        tx,
      );
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, second.shipmentId));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, second.shipmentLineId));
      const cancellation = await wiring.planning.cancelOutstanding(
        second.shipmentId,
        {
          expectedManifestVersion: shipment.manifestVersion,
          reason: '고객 취소',
          lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: line.qty }],
        },
        `c-${randomUUID()}`,
        actor,
        tx,
      );
      expect(cancellation.operationStatus).toBe('pending');
      const bin = await seedReturnBin(tx, second.warehouseId, second.actorId);

      const last = await remove(
        wiring,
        second.shipmentId,
        { barcode: second.barcode, returnBinBarcode: bin.barcode },
        tx,
      );

      expect(last).toMatchObject({ exited: true, exitTo: 'canceled', waitingOperationId: cancellation.operationId });
      const [after] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(after.status).toBe('canceled');
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('voided');
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, cancellation.operationId));
      expect(operation.status).toBe('completed');
      const reservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, second.shipmentLineId));
      expect(reservations.filter((reservation) => reservation.status === 'confirmed')).toEqual([]);
      await expect(wiring.recovery.reconcile(run.sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('같은 SKU 가 두 로케이션에서 배정됐으면 바구니 보관도 로케이션별로 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      // 박스 수량 2 를 한 로케이션이 다 못 채우게(각 1) 두면 배정 규칙(E8)이 두 로케이션으로 나눈다.
      const first = await seedPickableShipment(tx, 2);
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 1 })
        .where(
          and(eq(wmsTables.stockLedgers.skuId, first.skuId), eq(wmsTables.stockLedgers.locationId, first.locationId)),
        );
      const [other] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: first.warehouseId, code: `Z-${randomUUID().slice(0, 6)}`, locationType: 'zone' })
        .returning();
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: first.skuId,
        warehouseId: first.warehouseId,
        locationId: other.id,
        stockState: 'ON_HAND',
        qty: 1,
      });
      const wiring = assembleOutbound(tx);
      const run = await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      expect(allocations.map((allocation) => allocation.qty)).toEqual([1, 1]);
      for (const allocation of allocations) {
        await wiring.sessions.moveCustody(
          {
            sessionId: run.sessionId,
            idempotencyKey: `m-${randomUUID()}`,
            actorId: first.actorId,
            quantity: allocation.qty,
            from: { skuId: first.skuId, sourceLocationId: allocation.sourceLocationId, custodyType: 'AT_SOURCE' },
            to: {
              skuId: first.skuId,
              sourceLocationId: allocation.sourceLocationId,
              custodyType: 'WORKER',
              custodyRef: first.actorId,
              shipmentLineId: first.shipmentLineId,
            },
          },
          tx,
        );
      }
      await wiring.batches.excludeShipment(
        first.batchId,
        first.shipmentId,
        { reason: 'x' },
        `x-${randomUUID()}`,
        actor,
        tx,
      );
      const bin = await seedReturnBin(tx, first.warehouseId, first.actorId);
      await remove(
        wiring,
        first.shipmentId,
        { barcode: first.barcode, returnBinBarcode: bin.barcode, quantity: 2 },
        tx,
      );
      const found = await wiring.returnBins.lookup(bin.barcode, first.warehouseId, tx);
      expect(found.items.map((item) => [item.sourceLocationId, item.qty]).sort()).toEqual(
        allocations.map((allocation) => [allocation.sourceLocationId, 1]).sort(),
      );
      await expect(wiring.recovery.reconcile(run.sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });
});
