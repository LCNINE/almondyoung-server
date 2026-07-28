import { and, eq } from 'drizzle-orm';
import { wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from './index';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('seedPickableShipment', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('아직 피킹 전인 work item 과 발급된 운송장을 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx);

      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId))
        .limit(1);
      expect(workItem.status).toBe('queued');
      expect(workItem.pickerId).toBeNull();
      expect(workItem.leaseVersion).toBe(0);

      const plans = await tx
        .select()
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.batchId, fixture.batchId));
      expect(plans).toHaveLength(0);

      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.shipmentLineId))
        .limit(1);
      expect(line.inspectedQty).toBe(0);
      expect(line.qty).toBe(fixture.qty);

      const [reservation] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.shipmentLineId, fixture.shipmentLineId),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        )
        .limit(1);
      expect(reservation.quantity).toBe(fixture.qty);

      const [waybill] = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.id, fixture.waybillId))
        .limit(1);
      expect(waybill.status).toBe('registered');
      expect(waybill.trackingNo).toBe(fixture.trackingNo);
    });
  });
});
