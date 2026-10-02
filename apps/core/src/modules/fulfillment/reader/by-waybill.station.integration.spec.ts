import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentWaybillReader } from './shipment-waybill.reader';
import { inRollbackTx, makeDb, seedPickableShipment } from '../services/__support__';
import { startedShortPickBox } from '../services/__support__/short-pick-fixtures';
import { ambientDbService, startBatchFor } from '../services/__support__/simple-outbound-wiring';
import { assembleLabels } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('송장 스캔 — 스테이션 필드 (스펙 A5)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
  const readerFor = (tx: DbTx) => {
    const dbService = ambientDbService(tx);
    return new ShipmentWaybillReader(dbService, assembleLabels(dbService).states);
  };

  it('시작된 박스는 배송메모·줄별 배정·결품 버전을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, sessionId } = await startedShortPickBox(tx, 0);
      const [before] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      const snapshot =
        typeof before.recipientSnapshot === 'object' && before.recipientSnapshot !== null
          ? before.recipientSnapshot
          : {};
      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: { ...snapshot, deliveryNote: '문 앞' } })
        .where(eq(wmsTables.shipments.id, box.shipmentId));
      const [location] = await tx.select().from(wmsTables.locations).where(eq(wmsTables.locations.id, box.locationId));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));

      const found = await readerFor(tx).byTrackingNo(box.trackingNo);

      expect(found.deliveryNote).toBe('문 앞');
      expect(found.lines).toEqual([
        expect.objectContaining({
          shipmentLineId: box.shipmentLineId,
          lineVersion: line.lineVersion,
          allocations: [{ sourceLocationId: box.locationId, locationCode: location.code, qty: 3, pickedQty: 0 }],
        }),
      ]);
      expect(found.shortPickContext).toEqual({
        workItemLeaseVersion: workItem.leaseVersion,
        sessionId,
        sessionVersion: session.version,
        manifestVersion: shipment.manifestVersion,
      });
    });
  });

  it('줄별 배정은 DB 콜레이션이 아니라 코드 포인트 순(인쇄된 송장 순서)으로 나온다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 3);
      // en_US 콜레이션은 '-' 를 무시해 'ZB-10-…' < 'ZB-1-1-…' 로 센다. 코드 포인트 순('-' < '0')은 반대다.
      const suffix = randomUUID();
      await tx
        .update(wmsTables.locations)
        .set({ code: `ZB-10-${suffix}` })
        .where(eq(wmsTables.locations.id, box.locationId));
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 2 })
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
      await startBatchFor(tx, box);

      const found = await readerFor(tx).byTrackingNo(box.trackingNo);

      expect(found.lines[0].allocations.map((allocation) => allocation.locationCode)).toEqual([
        `ZB-1-1-${suffix}`,
        `ZB-10-${suffix}`,
      ]);
    });
  });

  it('위치별 pickedQty 는 코드 순이 아니라 실제 귀속(LINE_ATTRIBUTED 보관)을 따른다 — AT_SOURCE 는 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 3);
      const suffix = randomUUID();
      await tx
        .update(wmsTables.locations)
        .set({ code: `ZB-10-${suffix}` })
        .where(eq(wmsTables.locations.id, box.locationId));
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 2 })
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
      await startBatchFor(tx, box);
      const [{ sessionId }] = await tx
        .select({ sessionId: wmsTables.batchInventorySessions.id })
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, box.batchId));
      // 코드 순으로는 앞(front) 인 위치가 아니라 뒤(box.locationId) 위치에 2개가 귀속됐다
      await tx.insert(wmsTables.batchInventorySessionBalances).values({
        sessionId,
        skuId: box.skuId,
        sourceLocationId: box.locationId,
        custodyType: 'WORKER',
        custodyRef: randomUUID(),
        shipmentLineId: box.shipmentLineId,
        qty: 2,
      });

      const found = await readerFor(tx).byTrackingNo(box.trackingNo);

      expect(found.lines[0].allocations.map((a) => [a.locationCode, a.qty, a.pickedQty])).toEqual([
        [`ZB-1-1-${suffix}`, 1, 0],
        [`ZB-10-${suffix}`, 2, 2],
      ]);
    });
  });

  it('시작 전 배치의 박스는 배정·결품 버전이 비어 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const found = await readerFor(tx).byTrackingNo(box.trackingNo);
      expect(found.lines.every((line) => line.allocations.length === 0)).toBe(true);
      expect(found.shortPickContext).toBeNull();
      expect(found.deliveryNote).toBeNull();
    });
  });
});
