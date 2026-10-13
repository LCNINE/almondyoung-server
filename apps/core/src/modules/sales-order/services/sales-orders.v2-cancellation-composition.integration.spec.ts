import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  receiveStock,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from '../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { PoliciesService } from './policies.service';
import { SalesOrdersService } from './sales-orders.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    new PoliciesService(dbService),
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  return { logistics, salesOrders };
}

/** 라인 하나(주문 수량 quantity), 매칭 SKU 하나 × qtyPerUnit, 재고 넉넉. */
async function seedOrder(tx: DbTx, w: ReturnType<typeof wire>, quantity: number, qtyPerUnit: number) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
  const variantId = randomUUID();
  await seedMatching(tx, { variantId, skuId, quantity: qtyPerUnit });
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity }] });
  await tx
    .update(wmsTables.salesOrders)
    .set({ shippingAddress: ADDRESS })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
  return { salesOrderId, lineId: lineIds[0], warehouseId, skuId };
}

async function itemOf(tx: DbTx, salesOrderId: string, skuId: string) {
  const [row] = await tx
    .select({ qty: wmsTables.fulfillmentOrderItems.qty, canceledQty: wmsTables.fulfillmentOrderItems.canceledQty })
    .from(wmsTables.fulfillmentOrderItems)
    .where(
      and(
        eq(wmsTables.fulfillmentOrderItems.salesOrderId, salesOrderId),
        eq(wmsTables.fulfillmentOrderItems.skuId, skuId),
      ),
    );
  return row;
}

describeIfDb('V2 취소 — 비율은 라인 구성에서 (#1063 스펙 §6.5)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('1개당 2 인 라인: 부분 취소 1 → 물리 2, 이어서 전체 취소가 남은 물리 4 를 취소한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const o = await seedOrder(tx, w, 3, 2);
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);

      await w.salesOrders.cancel(
        o.salesOrderId,
        {
          lines: [{ salesOrderLineId: o.lineId, quantity: 1 }],
          cancelledBy: 'naver',
          metadata: { sourceEventId: `p-${randomUUID()}` },
        },
        tx,
      );
      expect(await itemOf(tx, o.salesOrderId, o.skuId)).toEqual({ qty: 6, canceledQty: 2 });

      await w.salesOrders.cancel(
        o.salesOrderId,
        { cancelledBy: 'naver', metadata: { sourceEventId: `f-${randomUUID()}` } },
        tx,
      );
      expect(await itemOf(tx, o.salesOrderId, o.skuId)).toEqual({ qty: 6, canceledQty: 6 });
    });
  });

  it('FO 생성 전 부분 취소가 있던 라인도 뒤이은 부분 취소가 통과한다(옛 역산은 409)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const o = await seedOrder(tx, w, 3, 1);
      await w.salesOrders.cancel(
        o.salesOrderId,
        {
          lines: [{ salesOrderLineId: o.lineId, quantity: 1 }],
          cancelledBy: 'naver',
          metadata: { sourceEventId: `p-${randomUUID()}` },
        },
        tx,
      );
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);
      expect(await itemOf(tx, o.salesOrderId, o.skuId)).toEqual({ qty: 2, canceledQty: 0 });

      await w.salesOrders.cancel(
        o.salesOrderId,
        {
          lines: [{ salesOrderLineId: o.lineId, quantity: 1 }],
          cancelledBy: 'naver',
          metadata: { sourceEventId: `q-${randomUUID()}` },
        },
        tx,
      );
      expect(await itemOf(tx, o.salesOrderId, o.skuId)).toEqual({ qty: 2, canceledQty: 1 });
    });
  });
});
