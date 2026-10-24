import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { seedFo } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedCancellableOrder, wireCancellation } from '../cancellation-record/__support__/cancellation-scenarios';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 넘긴 직배 주문의 상자 전 취소는 업체에 알릴 대기 행을 같은 트랜잭션에 남긴다(K7 PR5, D5). */
describeIfDb('SalesOrdersService 취소 — 직배 파트너 대기 행 (K7 PR5)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  const command = (key?: string) =>
    key ? { actorId: 'tester', actorRoles: ['admin'], idempotencyKey: key } : undefined;

  async function seedForwarded(tx: DbTx, quantity: number, dropShip: 'forwarded' | 'pending') {
    const w = wireCancellation(tx);
    const o = await seedCancellableOrder(tx, w, quantity);
    const [sku] = await tx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, o.skuId));
    await seedFo(
      tx,
      { warehouseId: o.warehouseId, skuId: o.skuId, holderId: sku.holderId as string },
      { salesOrderId: o.salesOrderId, lineId: o.lineId },
      { qty: quantity, dropShip, status: 'created' },
    );
    return { w, o };
  }
  const notices = (tx: DbTx, salesOrderId: string) =>
    tx
      .select()
      .from(wmsTables.directShipCancelNotices)
      .where(eq(wmsTables.directShipCancelNotices.salesOrderId, salesOrderId));

  it('넘긴 직배 주문 전체 취소 — 행의 취소 id 가 취소 행 id 와 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, o } = await seedForwarded(tx, 2, 'forwarded');

      await w.salesOrders.cancel(o.salesOrderId, { reasonCode: 'customer_request', cancelledBy: 'admin' }, tx);

      const [cancellation] = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, o.salesOrderId));
      expect(await notices(tx, o.salesOrderId)).toEqual([
        expect.objectContaining({
          orderCancellationId: cancellation.id,
          canceledQty: 2,
          cancellationScope: 'full',
          notifiedAt: null,
        }),
      ]);
    });
  });

  it('부분 취소 두 번은 행 둘, 각 감소분', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, o } = await seedForwarded(tx, 3, 'forwarded');
      const lines = [{ salesOrderLineId: o.lineId, quantity: 1 }];

      await w.salesOrders.cancel(o.salesOrderId, { lines, cancelledBy: 'admin' }, tx);
      await w.salesOrders.cancel(o.salesOrderId, { lines, cancelledBy: 'admin' }, tx);

      const rows = await notices(tx, o.salesOrderId);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.canceledQty)).toEqual([1, 1]);
      expect(rows.every((r) => r.cancellationScope === 'partial')).toBe(true);
      expect(new Set(rows.map((r) => r.orderCancellationId)).size).toBe(2);
    });
  });

  it('같은 멱등 키로 다시 온 부분 취소는 행을 늘리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, o } = await seedForwarded(tx, 3, 'forwarded');
      const options = {
        lines: [{ salesOrderLineId: o.lineId, quantity: 1 }],
        cancelledBy: 'admin',
        fulfillmentCommandContext: command(`key-${randomUUID()}`),
      };

      await w.salesOrders.cancel(o.salesOrderId, options, tx);
      await w.salesOrders.cancel(o.salesOrderId, options, tx);

      expect(await notices(tx, o.salesOrderId)).toHaveLength(1);
    });
  });

  it('넘기기 전 직배 주문 취소는 행이 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, o } = await seedForwarded(tx, 2, 'pending');

      await w.salesOrders.cancel(o.salesOrderId, { reasonCode: 'customer_request', cancelledBy: 'admin' }, tx);

      expect(await notices(tx, o.salesOrderId)).toEqual([]);
      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, o.salesOrderId));
      expect(cancellations).toHaveLength(1);
    });
  });
});
