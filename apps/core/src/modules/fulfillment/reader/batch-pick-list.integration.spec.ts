import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchPickListReader } from './batch-pick-list';
import { inRollbackTx, makeDb, seedPickableShipment, seedShipmentForExistingStock } from '../services/__support__';
import { ambientDbService, startBatchFor } from '../services/__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('배치 피킹 목록', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
  const readerFor = (tx: DbTx) => new BatchPickListReader(ambientDbService(tx));

  /** 같은 SKU 를 두 위치(앞 1개·뒤 나머지)에 두고, 두 상자(각 2개)를 한 배치로 묶는다 */
  async function twoBoxBatch(tx: DbTx) {
    const box = await seedPickableShipment(tx, 2);
    const [shipment] = await tx
      .select({ shippingProfileId: wmsTables.shipments.shippingProfileId })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, box.shipmentId));
    const sibling = await seedShipmentForExistingStock(
      tx,
      { ...box, deliveryProfileId: shipment.shippingProfileId ?? '' },
      2,
    );
    await tx
      .update(wmsTables.outboundBatchWorkItems)
      .set({ batchId: box.batchId })
      .where(eq(wmsTables.outboundBatchWorkItems.id, sibling.workItemId));
    const suffix = randomUUID();
    await tx
      .update(wmsTables.locations)
      .set({ code: `ZB-10-${suffix}` })
      .where(eq(wmsTables.locations.id, box.locationId));
    await tx
      .update(wmsTables.stockLedgers)
      .set({ qty: 3 })
      .where(and(eq(wmsTables.stockLedgers.skuId, box.skuId), eq(wmsTables.stockLedgers.locationId, box.locationId)));
    const [front] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: box.warehouseId, code: `ZB-1-1-${suffix}`, locationType: 'zone' })
      .returning();
    await tx.insert(wmsTables.stockLedgers).values({
      skuId: box.skuId,
      warehouseId: box.warehouseId,
      locationId: front.id,
      stockState: 'ON_HAND',
      qty: 1,
    });
    return { box, sibling, suffix, frontId: front.id };
  }

  it('시작 전 배치는 배정이 없어 빈 목록이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const list = await readerFor(tx).forBatch(box.batchId);
      expect(list).toMatchObject({ batchId: box.batchId, startedAt: null, boxes: 0, rows: [] });
    });
  });

  it('위치·상품별로 합쳐 위치 코드(코드 포인트) 순으로 내고, 상자 수를 센다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, suffix } = await twoBoxBatch(tx);
      await startBatchFor(tx, box);

      const list = await readerFor(tx).forBatch(box.batchId);

      expect(list.boxes).toBe(2);
      expect(list.rows.map((row) => [row.locationCode, row.skuCode, row.qty, row.pickedQty, row.boxes])).toEqual([
        [`ZB-1-1-${suffix}`, box.skuCode, 1, 0, 1],
        [`ZB-10-${suffix}`, box.skuCode, 3, 0, 2],
      ]);
      expect(list.rows[0].skuName).toBe('Simple SKU');
    });
  });

  it('집은 수량은 그 (줄, 위치)에 귀속된 보관으로, 같은 상품의 다른 위치에는 붙지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, suffix } = await twoBoxBatch(tx);
      await startBatchFor(tx, box);
      const [{ sessionId }] = await tx
        .select({ sessionId: wmsTables.batchInventorySessions.id })
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, box.batchId));
      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(
          and(
            eq(wmsTables.pickingSourceAllocations.workItemId, box.workItemId),
            eq(wmsTables.pickingSourceAllocations.sourceLocationId, box.locationId),
          ),
        );
      await tx.insert(wmsTables.batchInventorySessionBalances).values({
        sessionId,
        skuId: box.skuId,
        sourceLocationId: box.locationId,
        custodyType: 'WORKER',
        custodyRef: randomUUID(),
        shipmentLineId: box.shipmentLineId,
        qty: allocation.qty,
      });
      const list = await readerFor(tx).forBatch(box.batchId);

      const back = list.rows.find((row) => row.locationCode === `ZB-10-${suffix}`);
      expect(back).toMatchObject({ qty: 3, pickedQty: allocation.qty });
      expect(list.rows.find((row) => row.locationCode === `ZB-1-1-${suffix}`)).toMatchObject({ pickedQty: 0 });
    });
  });

  it('끝난·빠지는 중인 상자는 목록에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, sibling, suffix } = await twoBoxBatch(tx);
      await startBatchFor(tx, box);
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'withdrawing', exitTo: 'draft' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, sibling.workItemId));

      const list = await readerFor(tx).forBatch(box.batchId);

      expect(list.boxes).toBe(1);
      expect(list.rows.every((row) => row.boxes === 1)).toBe(true);
      expect(list.rows.reduce((sum, row) => sum + row.qty, 0)).toBe(2);
      expect(list.rows.map((row) => row.locationCode)).toEqual(
        expect.arrayContaining([expect.stringContaining(suffix)]),
      );
    });
  });

  it('시스템 위치에 배정된 재고는 송장처럼 상품의 선반 위치로 적는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await tx
        .update(wmsTables.locations)
        .set({ isSystem: true, systemRole: 'inbound_default' })
        .where(eq(wmsTables.locations.id, box.locationId));
      await tx.insert(wmsTables.skuShelfPositions).values({ skuId: box.skuId, positionCode: `SHELF-${randomUUID()}` });
      const [position] = await tx
        .select()
        .from(wmsTables.skuShelfPositions)
        .where(eq(wmsTables.skuShelfPositions.skuId, box.skuId));
      await startBatchFor(tx, box);

      const list = await readerFor(tx).forBatch(box.batchId);

      expect(list.rows.map((row) => row.locationCode)).toEqual([position.positionCode]);
    });
  });

  it('없는 배치는 404', async () => {
    await inRollbackTx(db, async (tx) => {
      await expect(readerFor(tx).forBatch(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
