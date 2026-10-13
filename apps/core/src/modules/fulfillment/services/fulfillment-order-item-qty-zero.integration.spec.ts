import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedHolder, seedSalesOrder, seedSku, seedWarehouseWithZone } from './__support__';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('FO 항목 qty 0 (#1063 스펙 §6.3)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  async function seedFo(tx: DbTx) {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
    const [fo] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId, warehouseId, status: 'created' })
      .returning();
    return { fo, skuId, salesOrderId, lineId: lineIds[0] };
  }

  it('DB 가 qty 0 을 받고 음수는 거절하며, 불변식 검사가 qty 0 항목을 통과시킨다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { fo, skuId, salesOrderId, lineId } = await seedFo(tx);
      await tx.insert(wmsTables.fulfillmentOrderItems).values({
        fulfillmentOrderId: fo.id,
        salesOrderId,
        salesOrderLineId: lineId,
        skuId,
        qty: 0,
      });
      await expect(new FulfillmentInvariantService().assertFulfillmentOrders([fo.id], tx)).resolves.toBeUndefined();
    });
    await inRollbackTx(db, async (tx) => {
      const { fo, skuId } = await seedFo(tx);
      // drizzle 이 pg 오류를 «Failed query» 로 감싸므로 제약 이름은 cause 에서 읽는다
      const failure = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: fo.id, skuId, qty: -1 })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(failure).toMatchObject({ cause: { constraint_name: 'ck_fulfillment_order_items_qty_nonnegative' } });
    });
  });
});
