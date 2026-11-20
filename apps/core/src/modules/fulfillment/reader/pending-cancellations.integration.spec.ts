import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { hasCancelWaitingBoxSql, loadPendingCancellations } from './pending-cancellations';
import { inRollbackTx, makeDb } from '../services/__support__';
import { PickableShipmentFixture } from '../services/__support__/logistics-fixtures';
import { seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { assembleOutbound } from '../services/__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('상자가 기다리는 취소', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function cancelOne(wiring: ReturnType<typeof assembleOutbound>, box: PickableShipmentFixture, tx: DbTx) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
    return wiring.planning.cancelOutstanding(
      box.shipmentId,
      {
        expectedManifestVersion: shipment.manifestVersion,
        reason: '고객 취소',
        lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: 1 }],
      },
      `c-${randomUUID()}`,
      actor,
      null,
      tx,
    );
  }

  async function waiting(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const result = await cancelOne(wiring, first, tx);
    expect(result.operationStatus).toBe('pending');
    const [sku] = await tx
      .select({ name: wmsTables.skus.name })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
      .where(eq(wmsTables.shipmentLines.id, first.shipmentLineId));
    return { first, second, wiring, skuName: sku.name };
  }

  it('상자마다 기다리는 취소의 상품명과 수량을 읽고, 기다리지 않는 상자는 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, skuName } = await waiting(tx);

      const found = await loadPendingCancellations(tx, [first.shipmentId, second.shipmentId]);

      expect([...found.keys()]).toEqual([first.shipmentId]);
      expect(found.get(first.shipmentId)).toMatchObject({
        operationId: expect.any(String),
        lines: [{ shipmentLineId: first.shipmentLineId, skuName, qty: 1 }],
      });
    });
  });

  it('상자 상세는 기다리는 취소를 싣고, 다른 상자는 null 이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, skuName } = await waiting(tx);

      const waitingDetail = await wiring.planning.getShipmentDetail(first.shipmentId, tx);
      const otherDetail = await wiring.planning.getShipmentDetail(second.shipmentId, tx);

      expect(waitingDetail.pendingCancellation?.lines).toEqual([
        expect.objectContaining({ shipmentLineId: first.shipmentLineId, skuName, qty: 1 }),
      ]);
      expect(otherDetail.pendingCancellation).toBeNull();
    });
  });

  it('배치 상세는 그 취소를 기다리는 작업 항목에만 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring } = await waiting(tx);

      const batch = await wiring.batches.getBatch(first.batchId, tx);
      const byShipment = new Map(batch.workItems.map((item) => [item.shipmentId, item]));

      expect(byShipment.get(first.shipmentId)?.pendingCancellation?.lines).toEqual([
        expect.objectContaining({ shipmentLineId: first.shipmentLineId, qty: 1 }),
      ]);
      expect(byShipment.get(second.shipmentId)?.pendingCancellation).toBeNull();
    });
  });

  it('출고주문 조회에 붙인 판정은 취소를 기다리는 상자가 든 출고주문만 참이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await waiting(tx);
      const orderOf = async (shipmentLineId: string) => {
        const [row] = await tx
          .select({ id: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
          .from(wmsTables.shipmentLines)
          .innerJoin(
            wmsTables.fulfillmentOrderItems,
            eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
          )
          .where(eq(wmsTables.shipmentLines.id, shipmentLineId));
        return row.id;
      };
      const flagOf = async (fulfillmentOrderId: string) => {
        const [row] = await tx
          .select({ id: wmsTables.fulfillmentOrders.id, waiting: hasCancelWaitingBoxSql() })
          .from(wmsTables.fulfillmentOrders)
          .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
        return row.waiting;
      };

      const waitingOrder = await orderOf(first.shipmentLineId);
      const otherOrder = await orderOf(second.shipmentLineId);

      expect(waitingOrder).not.toBe(otherOrder);
      expect(await flagOf(waitingOrder)).toBe(true);
      expect(await flagOf(otherOrder)).toBe(false);
    });
  });
});
