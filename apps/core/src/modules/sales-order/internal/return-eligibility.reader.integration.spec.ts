import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { seedOrder, seedWorld } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import {
  insertCustomerReturn,
  seedComponentSku,
  seedDeliveredLine,
} from '../line-quantities/__support__/claim-facts.fixtures';
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
        lines: [{ channelOrderItemId: ITEM_ID, deliveredUnits: 2, lastDeliveredAt: max, exchangeable: true }],
        customerReturns: [],
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
        lines: [{ channelOrderItemId: ITEM_ID, deliveredUnits: 0, lastDeliveredAt: null, exchangeable: true }],
        customerReturns: [],
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
        lines: [{ channelOrderItemId: ITEM_ID, deliveredUnits: 0, lastDeliveredAt: null, exchangeable: true }],
        customerReturns: [],
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
      expect(result.lines).toEqual([
        { channelOrderItemId: ITEM_ID, deliveredUnits: 0, lastDeliveredAt: null, exchangeable: true },
      ]);
    });
  });

  it('인쇄 줄 + 일반 줄 주문 → 줄마다 exchangeable [false, true], 인쇄 줄의 deliveredUnits 는 그대로 (K8 PR11b N1)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const normal = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 1 } }],
      });
      await asMedusa(tx, normal);
      // 같은 주문의 인쇄 줄 — 인쇄는 외주라 소포가 없다
      const [source] = await tx
        .select({ variantId: wmsTables.salesOrderLines.variantId })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, normal.lineId));
      await tx.insert(wmsTables.salesOrderLines).values({
        salesOrderId: normal.salesOrderId,
        variantId: source.variantId,
        productName: '인쇄 상품',
        quantity: 1,
        unitPrice: 1000,
        channelOrderItemId: 'ordli_0_print',
        almondDesignId: randomUUID(),
      });

      const result = await readReturnEligibility(tx, ORDER_ID);
      const lines = [...result.lines].sort((a, b) => a.channelOrderItemId.localeCompare(b.channelOrderItemId));
      expect(lines.map((line) => line.channelOrderItemId)).toEqual(['ordli_0_print', ITEM_ID]);
      expect(lines.map((line) => line.exchangeable)).toEqual([false, true]);
      expect(lines[1].deliveredUnits).toBe(1);
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

      expect(await readReturnEligibility(tx, ORDER_ID)).toEqual({ found: false, lines: [], customerReturns: [] });
    });
  });

  it('없는 주문 → { found: false, lines: [], customerReturns: [] }', async () => {
    await inRollbackTx(db, async (tx) => {
      expect(await readReturnEligibility(tx, 'order_does_not_exist')).toEqual({
        found: false,
        lines: [],
        customerReturns: [],
      });
    });
  });

  it('자격 응답에 반품 예정 기록의 상태를 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 2 } }],
      });
      await asMedusa(tx, line);
      const expected = await insertCustomerReturn(tx, {
        salesOrderId: line.salesOrderId,
        status: 'expected',
        lines: [{ salesOrderLineId: line.lineId, quantity: 1 }],
      });
      const arrived = await insertCustomerReturn(tx, {
        salesOrderId: line.salesOrderId,
        status: 'arrived',
        lines: [{ salesOrderLineId: line.lineId, quantity: 1 }],
      });

      await tx
        .update(wmsTables.customerReturns)
        .set({ requestedAt: new Date(Date.now() + 3_600_000) })
        .where(eq(wmsTables.customerReturns.id, arrived.customerReturnId));

      const result = await readReturnEligibility(tx, ORDER_ID);
      const idOf = async (id: string) =>
        (
          await tx
            .select({ c: wmsTables.customerReturns.channelReturnId })
            .from(wmsTables.customerReturns)
            .where(eq(wmsTables.customerReturns.id, id))
        )[0].c;
      expect(result.customerReturns).toHaveLength(2);
      // 읽기는 requestedAt, id 순 — 접수 시각이 이른 expected 가 먼저다
      expect(result.customerReturns).toEqual([
        {
          channelReturnId: await idOf(expected.customerReturnId),
          status: 'expected',
          kind: 'return',
          exchangeReleased: false,
        },
        {
          channelReturnId: await idOf(arrived.customerReturnId),
          status: 'arrived',
          kind: 'return',
          exchangeReleased: false,
        },
      ]);
    });
  });
  it('교환 반품 → kind exchange·exchangeReleased false, 교환 상자가 열린 뒤 true (N17)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 1 } }],
      });
      await asMedusa(tx, line);
      const { customerReturnId } = await insertCustomerReturn(tx, {
        salesOrderId: line.salesOrderId,
        status: 'expected',
        lines: [{ salesOrderLineId: line.lineId, quantity: 1 }],
      });
      await tx
        .update(wmsTables.customerReturns)
        .set({ kind: 'exchange' })
        .where(eq(wmsTables.customerReturns.id, customerReturnId));

      const before = await readReturnEligibility(tx, ORDER_ID);
      expect(before.customerReturns).toEqual([
        expect.objectContaining({ status: 'expected', kind: 'exchange', exchangeReleased: false }),
      ]);

      await tx
        .update(wmsTables.customerReturns)
        .set({ exchangeReleasedAt: new Date(), exchangeReleasedBy: '00000000-0000-0000-0000-000000000001' })
        .where(eq(wmsTables.customerReturns.id, customerReturnId));

      const after = await readReturnEligibility(tx, ORDER_ID);
      expect(after.customerReturns).toEqual([
        expect.objectContaining({ status: 'expected', kind: 'exchange', exchangeReleased: true }),
      ]);
    });
  });
});
