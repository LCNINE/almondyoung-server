import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { PickableShipmentFixture, seedPickableShipment } from './__support__/logistics-fixtures';
import { seedBoxOverSameStock, seedReturnBin } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('되돌림 적치 (스펙 §8, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 하나뿐인 배치를 시작하고, 전부 집고, 빼고, 바구니에 넣는다 — 배치는 파생 canceled, 세션은 바구니 때문에 active. */
  async function intoBin(tx: DbTx, wiring: ReturnType<typeof assembleOutbound>, box: PickableShipmentFixture, bin: { barcode: string }) {
    const run = await wiring.picking.start(
      { batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: box.actorId,
        quantity: box.qty,
        from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: box.skuId,
          sourceLocationId: box.locationId,
          custodyType: 'WORKER',
          custodyRef: box.actorId,
          shipmentLineId: box.shipmentLineId,
        },
      },
      tx,
    );
    await wiring.batches.excludeShipment(box.batchId, box.shipmentId, { reason: 'x' }, `x-${randomUUID()}`, actor, tx);
    await wiring.returns.removeToReturnBin(
      box.shipmentId,
      { barcode: box.barcode, returnBinBarcode: bin.barcode, quantity: box.qty },
      actor,
      `r-${randomUUID()}`,
      tx,
    );
    return run.sessionId;
  }

  const sessionOf = async (tx: DbTx, id: string) =>
    (await tx.select().from(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.id, id)))[0];

  it('두 배치의 물건이 섞인 바구니 — 세션 id 순으로 빠지고, 비는 세션은 settled, 적치한 만큼 일반 가용이 는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await seedPickableShipment(tx, 2);
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 10 })
        .where(and(eq(wmsTables.stockLedgers.skuId, a.skuId), eq(wmsTables.stockLedgers.locationId, a.locationId)));
      const b = await seedBoxOverSameStock(tx, a, 1); // 자기 배치에 든다
      const wiring = assembleOutbound(tx);
      const bin = await seedReturnBin(tx, a.warehouseId, a.actorId);
      const sessionA = await intoBin(tx, wiring, a, bin);
      const sessionB = await intoBin(tx, wiring, b, bin);
      // 빈 시작된 배치의 세션은 바구니 때문에 아직 active 다(스펙 §8 — 세션은 바구니까지 비어야 닫힌다).
      expect((await sessionOf(tx, sessionA)).status).toBe('active');
      const listed = await wiring.batches.listBatches({ warehouseId: a.warehouseId }, tx);
      expect(listed.find((batch) => batch.id === a.batchId)?.status).toBe('canceled');
      const guard = new BatchControlledStockGuard();
      const before = await guard.getAvailability(
        { skuId: a.skuId, warehouseId: a.warehouseId, sourceLocationId: a.locationId },
        tx,
      );

      const [location] = await tx.select().from(wmsTables.locations).where(eq(wmsTables.locations.id, a.locationId));
      const result = await wiring.returnBins.putaway(
        bin.barcode,
        { warehouseId: a.warehouseId, barcode: a.barcode, locationCode: location.code, quantity: 3 },
        { id: a.actorId },
        `p-${randomUUID()}`,
        tx,
      );

      expect(result).toMatchObject({ putAwayQty: 3, items: [] });
      expect((await sessionOf(tx, sessionA)).status).toBe('settled');
      expect((await sessionOf(tx, sessionB)).status).toBe('settled');
      expect((await sessionOf(tx, sessionA)).returnedQty).toBe(2);
      const after = await guard.getAvailability(
        { skuId: a.skuId, warehouseId: a.warehouseId, sourceLocationId: a.locationId },
        tx,
      );
      expect(after.generallyAvailableQty).toBe(before.generallyAvailableQty + 3);
      await expect(wiring.recovery.reconcile(sessionA, tx)).resolves.toMatchObject({ healthy: true });
      await expect(wiring.recovery.reconcile(sessionB, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('원래 로케이션이 아니면 RETURN_LOCATION_MISMATCH 와 원래 로케이션 목록, 바구니에 없으면 RETURN_BIN_ITEM_NOT_FOUND, 많으면 RETURN_BIN_ITEM_SHORT', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await seedPickableShipment(tx, 2);
      const wiring = assembleOutbound(tx);
      const bin = await seedReturnBin(tx, a.warehouseId, a.actorId);
      await intoBin(tx, wiring, a, bin);
      const [location] = await tx.select().from(wmsTables.locations).where(eq(wmsTables.locations.id, a.locationId));
      const put = (input: { barcode: string; locationCode: string; quantity: number }, trx: DbTx) =>
        wiring.returnBins.putaway(bin.barcode, { warehouseId: a.warehouseId, ...input }, { id: a.actorId }, `p-${randomUUID()}`, trx);

      await expect(
        tx.transaction((trx) => put({ barcode: a.barcode, locationCode: 'NOT-HERE', quantity: 1 }, trx)),
      ).rejects.toMatchObject({
        response: { code: 'RETURN_LOCATION_MISMATCH', errors: [{ locationCode: location.code, qty: 2 }] },
      });
      const other = await seedPickableShipment(tx, 1);
      await expect(
        tx.transaction((trx) => put({ barcode: other.barcode, locationCode: location.code, quantity: 1 }, trx)),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_ITEM_NOT_FOUND' } });
      await expect(
        tx.transaction((trx) => put({ barcode: a.barcode, locationCode: location.code, quantity: 3 }, trx)),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_ITEM_SHORT' } });
    });
  });
});
