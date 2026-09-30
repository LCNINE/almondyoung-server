import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('세션 — 되돌림 바구니 이벤트 (PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function pickedBox(tx: DbTx) {
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
          custodyType: 'WORKER',
          custodyRef: f.actorId,
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
    return { f, wiring, sessionId: run.sessionId, allocation, bin: { id: bin.id, barcode: bin.barcode } };
  }

  const balancesOf = (tx: DbTx, sessionId: string) =>
    tx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId));

  it('박스 보관 1 을 바구니로 — 로케이션은 그대로, 줄은 떨어지고, 세션은 active', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, allocation, bin } = await pickedBox(tx);
      const operationId = randomUUID();
      await wiring.sessions.removeToReturnBin(
        {
          sessionId,
          operationId,
          actorId: f.actorId,
          workItemId: f.workItemId,
          allocationId: allocation.id,
          shipmentLineId: f.shipmentLineId,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          quantity: 1,
          from: { custodyType: 'WORKER', custodyRef: f.actorId, shipmentLineId: f.shipmentLineId },
          returnBin: bin,
        },
        tx,
      );

      const balances = await balancesOf(tx, sessionId);
      expect(balances.find((b) => b.custodyType === 'WORKER')?.qty).toBe(1);
      expect(balances.find((b) => b.custodyType === 'RETURN_PENDING')).toMatchObject({
        qty: 1,
        custodyRef: bin.barcode,
        sourceLocationId: f.locationId,
        shipmentLineId: null,
      });
      const [event] = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'REMOVE_TO_RETURN_BIN'),
          ),
        );
      expect(event.payload).toMatchObject({
        operationId,
        workItemId: f.workItemId,
        allocationId: allocation.id,
        shipmentLineId: f.shipmentLineId,
        returnBinId: bin.id,
      });
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session.status).toBe('active');
      // 바구니의 물건도 세션 통제분이다 — 아직 선반에 없다.
      const availability = await new BatchControlledStockGuard().getAvailability(
        { skuId: f.skuId, warehouseId: f.warehouseId, sourceLocationId: f.locationId },
        tx,
      );
      expect(availability.batchControlledQty).toBe(2);
    });
  });

  it('같은 명령·배정·보관으로 다시 보내면 한 번이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, allocation, bin } = await pickedBox(tx);
      const input = {
        sessionId,
        operationId: randomUUID(),
        actorId: f.actorId,
        workItemId: f.workItemId,
        allocationId: allocation.id,
        shipmentLineId: f.shipmentLineId,
        skuId: f.skuId,
        sourceLocationId: f.locationId,
        quantity: 1,
        from: { custodyType: 'WORKER' as const, custodyRef: f.actorId, shipmentLineId: f.shipmentLineId },
        returnBin: bin,
      };
      await wiring.sessions.removeToReturnBin(input, tx);
      const replay = await wiring.sessions.removeToReturnBin(input, tx);
      expect(replay.replayed).toBe(true);
      const balances = await balancesOf(tx, sessionId);
      expect(balances.find((b) => b.custodyType === 'RETURN_PENDING')?.qty).toBe(1);
    });
  });

  it('되돌림 적치는 바구니 보관을 없애고 returned_qty 에 더한다 — 다 비면 settled', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, allocation, bin } = await pickedBox(tx);
      await wiring.sessions.removeToReturnBin(
        {
          sessionId,
          operationId: randomUUID(),
          actorId: f.actorId,
          workItemId: f.workItemId,
          allocationId: allocation.id,
          shipmentLineId: f.shipmentLineId,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          quantity: 2,
          from: { custodyType: 'WORKER', custodyRef: f.actorId, shipmentLineId: f.shipmentLineId },
          returnBin: bin,
        },
        tx,
      );
      await wiring.sessions.putawayReturn(
        {
          sessionId,
          operationId: randomUUID(),
          actorId: f.actorId,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          quantity: 2,
          returnBin: bin,
        },
        tx,
      );
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session).toMatchObject({ status: 'settled', returnedQty: 2, handedInQty: 2 });
    });
  });

  it('일반 보관 이동으로는 바구니에 넣거나 뺄 수 없다 — 배정 감소 없이 바구니가 생기면 안 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, bin } = await pickedBox(tx);
      await expect(
        wiring.sessions.moveCustody(
          {
            sessionId,
            idempotencyKey: `m-${randomUUID()}`,
            actorId: f.actorId,
            quantity: 1,
            from: {
              skuId: f.skuId,
              sourceLocationId: f.locationId,
              custodyType: 'WORKER',
              custodyRef: f.actorId,
              shipmentLineId: f.shipmentLineId,
            },
            to: { skuId: f.skuId, sourceLocationId: f.locationId, custodyType: 'RETURN_PENDING', custodyRef: bin.barcode },
          },
          tx,
        ),
      ).rejects.toThrow(/removeToReturnBin/);
    });
  });

  it('AT_SOURCE 에서는 바구니로 뺄 수 없다 — 집지 않은 몫은 HAND_BACK 이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, wiring, sessionId, allocation, bin } = await pickedBox(tx);
      await expect(
        wiring.sessions.removeToReturnBin(
          {
            sessionId,
            operationId: randomUUID(),
            actorId: f.actorId,
            workItemId: f.workItemId,
            allocationId: allocation.id,
            shipmentLineId: f.shipmentLineId,
            skuId: f.skuId,
            sourceLocationId: f.locationId,
            quantity: 1,
            from: { custodyType: 'AT_SOURCE', custodyRef: null, shipmentLineId: null },
            returnBin: bin,
          },
          tx,
        ),
      ).rejects.toThrow(/box custody or a bulk cart/);
    });
  });
});
