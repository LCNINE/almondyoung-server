import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentWaybillReader } from './shipment-waybill.reader';
import { inRollbackTx, makeDb, seedPickableShipment } from '../services/__support__';
import { startedShortPickBox } from '../services/__support__/short-pick-fixtures';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
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
        typeof before.recipientSnapshot === 'object' && before.recipientSnapshot !== null ? before.recipientSnapshot : {};
      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: { ...snapshot, deliveryNote: '문 앞' } })
        .where(eq(wmsTables.shipments.id, box.shipmentId));
      const [location] = await tx.select().from(wmsTables.locations).where(eq(wmsTables.locations.id, box.locationId));
      const [line] = await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
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
          allocations: [{ sourceLocationId: box.locationId, locationCode: location.code, qty: 3 }],
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
