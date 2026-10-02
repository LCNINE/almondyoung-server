import { randomUUID } from 'crypto';
import { eq, sql as dsql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('세션 복구 — 되돌림 바구니 (PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function removedOne(tx: DbTx) {
    const f = await seedPickableShipment(tx, 2);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: f.batchId, actorId: f.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: f.actorId,
        quantity: 2,
        from: { skuId: f.skuId, sourceLocationId: f.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          custodyType: 'PACKING',
          custodyRef: `work-item:${f.workItemId}`,
          shipmentLineId: f.shipmentLineId,
        },
      },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, f.workItemId));
    const [bin] = await tx
      .insert(wmsTables.returnBins)
      .values({ warehouseId: f.warehouseId, barcode: `RB-${randomUUID().slice(0, 8)}`, registeredBy: f.actorId })
      .returning();
    await wiring.sessions.removeToReturnBin(
      {
        sessionId: run.sessionId,
        operationId: randomUUID(),
        actorId: f.actorId,
        workItemId: f.workItemId,
        allocationId: allocation.id,
        shipmentLineId: f.shipmentLineId,
        skuId: f.skuId,
        sourceLocationId: f.locationId,
        quantity: 1,
        from: { custodyType: 'PACKING', custodyRef: `work-item:${f.workItemId}`, shipmentLineId: f.shipmentLineId },
        returnBin: { id: bin.id, barcode: bin.barcode },
      },
      tx,
    );
    await tx
      .update(wmsTables.pickingSourceAllocations)
      .set({ qty: dsql`${wmsTables.pickingSourceAllocations.qty} - 1` })
      .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
    return { f, wiring, sessionId: run.sessionId, allocation, bin: { id: bin.id, barcode: bin.barcode } };
  }

  it('바구니로 빼고 배정을 줄인 세션은 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId } = await removedOne(tx);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('되돌림 적치까지 해도 healthy — 적치는 returned_qty 로 재생된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, bin } = await removedOne(tx);
      await wiring.sessions.putawayReturn(
        {
          sessionId,
          operationId: randomUUID(),
          actorId: f.actorId,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          quantity: 1,
          returnBin: bin,
        },
        tx,
      );
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('이벤트 없이 배정만 줄면 그 배정이 어긋났다고 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId, allocation } = await removedOne(tx);
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 0 })
        .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
      const result = await wiring.recovery.reconcile(sessionId, tx);
      expect(result.healthy).toBe(false);
      expect(result.issues.join('\n')).toMatch(/hand-in 2 − hand-back 0 − removed 1/);
    });
  });
});
