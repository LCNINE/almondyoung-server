import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('되돌림 바구니 등록·조회 (PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('등록은 멱등이다 — 같은 창고의 같은 바코드면 같은 바구니', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const { returnBins } = assembleOutbound(tx);
      const barcode = `RB-${randomUUID().slice(0, 8)}`;
      const first = await returnBins.register(
        { warehouseId: f.warehouseId, barcode: ` ${barcode} ` },
        { id: f.actorId },
        tx,
      );
      const second = await returnBins.register({ warehouseId: f.warehouseId, barcode }, { id: f.actorId }, tx);
      expect(second).toEqual(first);
      expect(first).toMatchObject({ barcode, warehouseId: f.warehouseId });
    });
  });

  it('RB- 가 아니면 400, 다른 창고면 RETURN_BIN_WAREHOUSE_MISMATCH, 폐기됐으면 RETURN_BIN_UNKNOWN', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const other = await seedPickableShipment(tx, 1);
      const { returnBins } = assembleOutbound(tx);
      await expect(
        returnBins.register({ warehouseId: f.warehouseId, barcode: 'TOTE-1' }, { id: f.actorId }, tx),
      ).rejects.toMatchObject({ status: 400 });
      const barcode = `RB-${randomUUID().slice(0, 8)}`;
      await returnBins.register({ warehouseId: f.warehouseId, barcode }, { id: f.actorId }, tx);
      await expect(
        tx.transaction((trx) =>
          returnBins.register({ warehouseId: other.warehouseId, barcode }, { id: f.actorId }, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_WAREHOUSE_MISMATCH' } });
      await tx
        .update(wmsTables.returnBins)
        .set({ retiredAt: new Date() })
        .where(eq(wmsTables.returnBins.barcode, barcode));
      await expect(
        tx.transaction((trx) => returnBins.register({ warehouseId: f.warehouseId, barcode }, { id: f.actorId }, trx)),
      ).rejects.toMatchObject({ response: { code: 'RETURN_BIN_UNKNOWN' } });
    });
  });

  it('조회는 바구니와 남은 물건(여러 세션 합)을 준다. 없으면 404 RETURN_BIN_UNKNOWN', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const { returnBins } = assembleOutbound(tx);
      const bin = await returnBins.register(
        { warehouseId: f.warehouseId, barcode: `RB-${randomUUID().slice(0, 8)}` },
        { id: f.actorId },
        tx,
      );
      for (const qty of [1, 2]) {
        const [session] = await tx
          .insert(wmsTables.batchInventorySessions)
          .values({ batchId: f.batchId, handedInQty: qty, status: qty === 1 ? 'active' : 'settled' })
          .returning();
        await tx.insert(wmsTables.batchInventorySessionBalances).values({
          sessionId: session.id,
          skuId: f.skuId,
          sourceLocationId: f.locationId,
          custodyType: 'RETURN_PENDING',
          custodyRef: bin.barcode,
          qty,
        });
      }
      const found = await returnBins.lookup(bin.barcode, f.warehouseId, tx);
      // settled 세션의 행은 세지 않는다(그 세션은 이미 닫혔다 — 실제로는 보관이 0 이다).
      expect(found.items).toEqual([
        expect.objectContaining({ skuId: f.skuId, sourceLocationId: f.locationId, qty: 1, skuCode: f.skuCode }),
      ]);
      await expect(returnBins.lookup('RB-none', f.warehouseId, tx)).rejects.toMatchObject({
        status: 404,
        response: { code: 'RETURN_BIN_UNKNOWN' },
      });
    });
  });
});
