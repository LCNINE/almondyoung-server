import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { seedOrder, seedWorld } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedComponentSku, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { recallParcel, seedSupplierShare } from '../line-quantities/__support__/shipment-facts.fixtures';
import { readParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';
import { readReturnEligibility } from './return-eligibility.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const ORDER_ID = 'order_test_1';
const ITEM_ID = 'ordli_1';

/** 픽스처 주문을 Medusa 주문처럼 보이게 한다 — 채널·주문 id·줄 id 만 바꾼다. */
async function asMedusa(
  tx: DbTx,
  order: { salesOrderId: string; lineId: string },
  channel: 'medusa' | 'naver' = 'medusa',
) {
  await tx
    .update(wmsTables.salesOrders)
    .set({ salesChannel: channel, channelOrderId: ORDER_ID })
    .where(eq(wmsTables.salesOrders.id, order.salesOrderId));
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ channelOrderItemId: ITEM_ID })
    .where(eq(wmsTables.salesOrderLines.id, order.lineId));
}

describeIfDb('readReturnEligibility', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('배송완료 소포 둘(1+1) → deliveredUnits 2, lastDeliveredAt 은 readParcelClaimEligibility 의 최댓값', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 1 } }, { qtyBySku: { [w.skuId]: 1 } }],
      });
      await asMedusa(tx, line);

      const parcels = await readParcelClaimEligibility(tx, line.salesOrderId);
      const max = new Date(Math.max(...parcels.map((p) => p.deliveredAt.getTime()))).toISOString();
      expect(parcels).toHaveLength(2);
      expect(await readReturnEligibility(tx, ORDER_ID)).toEqual({
        found: true,
        lines: [{ channelOrderItemId: ITEM_ID, deliveredUnits: 2, lastDeliveredAt: max }],
      });
    });
  });

  it('세트의 한 구성품만 배송완료면 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const skuB = await seedComponentSku(tx, w);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 1 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 1 } }],
      });
      await asMedusa(tx, line);

      const result = await readReturnEligibility(tx, ORDER_ID);
      expect(result.lines[0].deliveredUnits).toBe(0);
    });
  });

  it('배송 안 된 소포(delivered: false)는 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 2 }, delivered: false }],
      });
      await asMedusa(tx, line);

      expect(await readReturnEligibility(tx, ORDER_ID)).toEqual({
        found: true,
        lines: [{ channelOrderItemId: ITEM_ID, deliveredUnits: 0, lastDeliveredAt: null }],
      });
    });
  });

  it('회수된 소포(recallParcel)는 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 2 } }],
      });
      await asMedusa(tx, line);
      await recallParcel(tx, {
        dispatchAttemptId: line.parcels[0].dispatchAttemptId,
        lines: [{ foItemId: line.foItemIdBySku.get(w.skuId) ?? '', qty: 2 }],
      });

      expect(await readReturnEligibility(tx, ORDER_ID)).toEqual({
        found: true,
        lines: [{ channelOrderItemId: ITEM_ID, deliveredUnits: 0, lastDeliveredAt: null }],
      });
    });
  });

  it('입점사 상자(seedSupplierShare)만 있는 줄 → 0 (직배는 배송완료 추적이 없다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedOrder(tx, { quantity: 1 });
      await asMedusa(tx, line);
      await seedSupplierShare(tx, w, line, { stage: 'shipped', qty: 1 });

      const result = await readReturnEligibility(tx, ORDER_ID);
      expect(result.lines).toEqual([{ channelOrderItemId: ITEM_ID, deliveredUnits: 0, lastDeliveredAt: null }]);
    });
  });

  it('다른 채널(naver) 주문은 found false', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 1 } }],
      });
      await asMedusa(tx, line, 'naver');

      expect(await readReturnEligibility(tx, ORDER_ID)).toEqual({ found: false, lines: [] });
    });
  });

  it('없는 주문 → { found: false, lines: [] }', async () => {
    await inRollbackTx(db, async (tx) => {
      expect(await readReturnEligibility(tx, 'order_does_not_exist')).toEqual({ found: false, lines: [] });
    });
  });
});
