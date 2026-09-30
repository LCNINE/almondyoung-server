import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from './__support__';
import { seedBoxOverSameStock, seedLooseBox, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('합류 후보 조회 (스펙 §7 앱 「이 배치에 넣기」)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function fixture(tx: DbTx) {
    const { first } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const loose = await seedLooseBox(tx, first, 2);
    const [order] = await tx
      .select({ id: wmsTables.salesOrders.id, channelOrderId: wmsTables.salesOrders.channelOrderId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .where(eq(wmsTables.shipmentLines.shipmentId, loose.shipmentId));
    return { first, loose, wiring, order };
  }

  it('표시 주문번호·채널 주문번호·송장번호로 같은 박스를 찾는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring, order } = await fixture(tx);
      const displayNo = `D${Date.now()}`;
      await tx
        .update(wmsTables.salesOrders)
        .set({ displayOrderNo: displayNo })
        .where(eq(wmsTables.salesOrders.id, order.id));
      for (const code of [displayNo, order.channelOrderId, loose.trackingNo]) {
        const found = await wiring.batches.findJoinCandidates(first.batchId, code, tx);
        expect(found).toEqual([
          expect.objectContaining({
            shipmentId: loose.shipmentId,
            orderNos: [displayNo],
            totalQty: 2,
            issue: null,
            waybillIssue: null,
            waybill: expect.objectContaining({ trackingNo: loose.trackingNo, printable: false }),
          }),
        ]);
      }
    });
  });

  it('다른 배치에 있는 박스는 issue=SHIPMENT_ACTIVE_WORK_ITEM', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await fixture(tx);
      const elsewhere = await seedBoxOverSameStock(tx, first, 1);
      const [found] = await wiring.batches.findJoinCandidates(first.batchId, elsewhere.trackingNo, tx);
      expect(found).toMatchObject({ shipmentId: elsewhere.shipmentId, issue: 'SHIPMENT_ACTIVE_WORK_ITEM' });
    });
  });

  it('이 배치에 이미 들어 있는 박스는 issue=ALREADY_IN_THIS_BATCH — 합류한 뒤 다시 찾아도(응답을 잃은 재시도)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring } = await fixture(tx);
      const [original] = await wiring.batches.findJoinCandidates(first.batchId, first.trackingNo, tx);
      expect(original).toMatchObject({ shipmentId: first.shipmentId, issue: 'ALREADY_IN_THIS_BATCH' });

      await wiring.batches.addShipment(
        first.batchId,
        loose.shipmentId,
        `j-${randomUUID()}`,
        { id: first.actorId, roles: ['master'] },
        tx,
      );
      const [rejoined] = await wiring.batches.findJoinCandidates(first.batchId, loose.trackingNo, tx);
      expect(rejoined).toMatchObject({ shipmentId: loose.shipmentId, issue: 'ALREADY_IN_THIS_BATCH' });
    });
  });

  it('송장이 없으면 waybill=null 이고 막는 사유가 없다 — 앱이 발급한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring, order } = await fixture(tx);
      await tx.delete(wmsTables.waybills).where(eq(wmsTables.waybills.id, loose.waybillId));
      const [found] = await wiring.batches.findJoinCandidates(first.batchId, order.channelOrderId, tx);
      expect(found).toMatchObject({ waybill: null, issue: null, waybillIssue: null });
    });
  });

  it('수령인이 바뀐 송장은 waybillIssue=WAYBILL_STALE', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring } = await fixture(tx);
      await tx
        .update(wmsTables.waybills)
        .set({ recipientHash: 'c'.repeat(64) })
        .where(eq(wmsTables.waybills.id, loose.waybillId));
      const [found] = await wiring.batches.findJoinCandidates(first.batchId, loose.trackingNo, tx);
      expect(found.waybillIssue).toBe('WAYBILL_STALE');
    });
  });

  it('다른 창고의 박스는 찾지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await fixture(tx);
      const other = await seedPickableShipment(tx, 1);
      await expect(wiring.batches.findJoinCandidates(first.batchId, other.trackingNo, tx)).resolves.toEqual([]);
    });
  });
});
