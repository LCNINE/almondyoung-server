import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { findCompositionInvariantViolations } from '../../product-matching/line-composition/__support__/composition-invariant';
import { PoliciesService } from '../../sales-order/services/policies.service';
import { SalesOrdersService } from '../../sales-order/services/sales-orders.service';
import { outboxPublisherFor } from '../outbox/__support__/outbox-publisher.factory';
import { inRollbackTx, makeDb, seedSalesOrder, wireLogistics } from '../services/__support__';
import { ambientDbService, assembleOutbound } from '../services/__support__/simple-outbound-wiring';
import {
  boxLinesOf,
  itemsOf,
  seedOrderWithDraftBox,
  seedStockedSku,
} from '../draft-box/__support__/draft-box-fixtures';
import { wireLineCompositionEdit } from './__support__/line-composition-edit-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID() };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const edit = wireLineCompositionEdit(dbService, logistics);
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
  return { logistics, edit, salesOrders };
}

async function lineOf(tx: DbTx, id: string) {
  const [line] = await tx.select().from(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.id, id));
  return line;
}

describeIfDb('주문별 라인 구성 지정 (#1063 스펙 §7.1)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('FO 전: 상품매칭 없이 운영자 지정 → 매칭 대기가 깨고 → FO 가 지정 구성으로 생긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [1] }] });
      // FO 가 없는 두 번째 주문: 매칭 없는 variant
      const sku = await seedStockedSku(tx, fx, 10);
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 2 }] });
      await tx
        .insert(wmsTables.fulfillmentOrderCreationBacklogs)
        .values({ salesOrderId, status: 'awaiting_matching', waitingVariantIds: [] });

      const result = await w.edit.manager.assignToLine(
        salesOrderId,
        lineIds[0],
        [{ skuId: sku, qtyPerUnit: 3 }],
        null,
        actor,
        tx,
      );

      expect(result).toMatchObject({ source: 'operator', changedShipmentIds: [], amendmentId: null });
      const [backlog] = await tx
        .select({ status: wmsTables.fulfillmentOrderCreationBacklogs.status })
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId));
      expect(backlog.status).toBe('pending');

      await w.logistics.fulfillments.create({ salesOrderId, warehouseId: fx.warehouseId }, tx);
      const items = await tx
        .select({ skuId: wmsTables.fulfillmentOrderItems.skuId, qty: wmsTables.fulfillmentOrderItems.qty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, lineIds[0]));
      expect(items).toEqual([{ skuId: sku, qty: 6 }]);
      expect((await lineOf(tx, lineIds[0])).compositionSource).toBe('operator');
    });
  });

  it('FO 뒤: SKU 교체가 박스를 맞추고 amendment 를 남기며, 다시 불러도 바뀌지 않고, 뒤이은 고객 전체 취소가 통과한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 2, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      const [b] = fx.spareSkuIds;

      const first = await w.edit.manager.assignToLine(
        fx.salesOrderId,
        fx.lineIds[0],
        [{ skuId: b, qtyPerUnit: 2 }],
        '오매칭',
        actor,
        tx,
      );
      expect(first).toMatchObject({ source: 'operator', changedShipmentIds: [fx.shipmentId] });
      expect(first.amendmentId).not.toBeNull();
      expect(await boxLinesOf(tx, fx.shipmentId)).toMatchObject([{ skuId: b, qty: 4 }]);
      const [amendment] = await tx
        .select()
        .from(wmsTables.salesOrderAmendments)
        .where(eq(wmsTables.salesOrderAmendments.id, first.amendmentId ?? ''));
      expect(amendment).toMatchObject({
        amendmentKind: 'fulfillment_only',
        origin: 'operator',
        status: 'applied',
        note: '오매칭',
      });

      const again = await w.edit.manager.assignToLine(
        fx.salesOrderId,
        fx.lineIds[0],
        [{ skuId: b, qtyPerUnit: 2 }],
        null,
        actor,
        tx,
      );
      expect(again).toMatchObject({ changedShipmentIds: [], amendmentId: null });

      await w.salesOrders.cancel(
        fx.salesOrderId,
        { cancelledBy: 'naver', metadata: { sourceEventId: `f-${randomUUID()}` } },
        tx,
      );
      const items = new Map((await itemsOf(tx, fx.fulfillmentOrderId)).map((item) => [item.skuId, item]));
      expect(items.get(fx.skuIdsByLine[0][0])).toMatchObject({ qty: 0, canceledQty: 0 });
      expect(items.get(b)).toMatchObject({ qty: 4, canceledQty: 4 });
      expect(await findCompositionInvariantViolations(tx)).toEqual([]);
    });
  });

  it('부분 취소가 있던 라인의 1개당 수량을 바꾼 뒤 부분 취소가 통과한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 3, qtyPerUnits: [1] }] });
      const [a] = fx.skuIdsByLine[0];
      await w.salesOrders.cancel(
        fx.salesOrderId,
        {
          lines: [{ salesOrderLineId: fx.lineIds[0], quantity: 1 }],
          cancelledBy: 'naver',
          metadata: { sourceEventId: `p-${randomUUID()}` },
        },
        tx,
      );

      await w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: a, qtyPerUnit: 2 }], null, actor, tx);
      expect(await itemsOf(tx, fx.fulfillmentOrderId)).toMatchObject([{ skuId: a, qty: 5, canceledQty: 1 }]);

      await w.salesOrders.cancel(
        fx.salesOrderId,
        {
          lines: [{ salesOrderLineId: fx.lineIds[0], quantity: 1 }],
          cancelledBy: 'naver',
          metadata: { sourceEventId: `q-${randomUUID()}` },
        },
        tx,
      );
      expect(await itemsOf(tx, fx.fulfillmentOrderId)).toMatchObject([{ skuId: a, qty: 5, canceledQty: 3 }]);
    });
  });

  it('라인이 담긴 박스가 draft 가 아니면 LINE_BOX_NOT_DRAFT 와 박스 목록', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, fx.shipmentId));

      await expect(
        w.edit.manager.assignToLine(
          fx.salesOrderId,
          fx.lineIds[0],
          [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }],
          null,
          actor,
          tx,
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'LINE_BOX_NOT_DRAFT',
          boxes: [{ shipmentId: fx.shipmentId, status: 'planned', batchId: null }],
        },
      });
    });
  });

  it('SKU 가 다른 박스로 갈라진 라인은 COMPOSITION_UNITS_AMBIGUOUS, 아무것도 바뀌지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1, 1] }],
        spareSkus: 1,
      });
      const [, second] = fx.skuIdsByLine[0];
      // 두 번째 SKU 줄만 새 draft 박스로 옮긴다(분할과 같은 결과)
      const [other] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: fx.warehouseId, status: 'draft' })
        .returning();
      const lines = await boxLinesOf(tx, fx.shipmentId);
      const moved = lines.find((line) => line.skuId === second);
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: other.id })
        .where(eq(wmsTables.shipmentLines.id, moved?.id ?? ''));

      await expect(
        w.edit.manager.assignToLine(
          fx.salesOrderId,
          fx.lineIds[0],
          [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }],
          null,
          actor,
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'COMPOSITION_UNITS_AMBIGUOUS' } });
      expect((await lineOf(tx, fx.lineIds[0])).compositionSource).toBe('matching');
    });
  });

  it('박스를 세고 잠그는 사이 라인이 다른 박스로 옮겨지면 SHIPMENT_COMPONENT_CHANGED_RETRY, 아무것도 바뀌지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [
          { quantity: 1, qtyPerUnits: [1] },
          { quantity: 1, qtyPerUnits: [1] },
        ],
        spareSkus: 1,
      });
      const [a] = fx.skuIdsByLine[0];
      const [other] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: fx.warehouseId, status: 'draft' })
        .returning();
      const moved = (await boxLinesOf(tx, fx.shipmentId)).find((line) => line.salesOrderLineId === fx.lineIds[0]);
      // 첫 조회 직후, 박스 잠금 전에 분할이 커밋된 것과 같은 상태를 만든다
      const reader = w.edit.reader;
      jest.spyOn(reader, 'boxesOfLines').mockImplementationOnce(async (trx, ids) => {
        // once 구현은 이 호출에서 소진됐으므로 안쪽 호출은 원래 메서드로 간다
        const result = await reader.boxesOfLines(trx, ids);
        await tx
          .update(wmsTables.shipmentLines)
          .set({ shipmentId: other.id })
          .where(eq(wmsTables.shipmentLines.id, moved?.id ?? ''));
        return result;
      });

      await expect(
        w.edit.manager.assignToLine(
          fx.salesOrderId,
          fx.lineIds[0],
          [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }],
          null,
          actor,
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_COMPONENT_CHANGED_RETRY' } });

      expect((await lineOf(tx, fx.lineIds[0])).compositionSource).toBe('matching');
      expect(await boxLinesOf(tx, other.id)).toMatchObject([{ skuId: a, qty: 1 }]);
      const amendments = await tx
        .select({ id: wmsTables.salesOrderAmendments.id })
        .from(wmsTables.salesOrderAmendments)
        .where(eq(wmsTables.salesOrderAmendments.salesOrderId, fx.salesOrderId));
      expect(amendments).toEqual([]);
    });
  });

  it('디지털 라인·직배송 SKU·FO 있는데 미굳힘 라인을 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      const [spare] = fx.spareSkuIds;

      await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, spare));
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: { code: 'DROP_SHIP_NOT_SUPPORTED' } });
      await tx.update(wmsTables.skus).set({ stockType: 'physical' }).where(eq(wmsTables.skus.id, spare));

      // 백필 전 공백 흉내: 출처와 구성 행을 함께 지운다(불변식 유지)
      await tx
        .delete(wmsTables.salesOrderLineCompositions)
        .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, fx.lineIds[0]));
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSource: null, compositionSetAt: null })
        .where(eq(wmsTables.salesOrderLines.id, fx.lineIds[0]));
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: { code: 'COMPOSITION_NOT_FROZEN' } });

      await tx
        .update(wmsTables.salesOrderLines)
        .set({ fulfillmentKind: 'digital', requiresShipping: false })
        .where(eq(wmsTables.salesOrderLines.id, fx.lineIds[0]));
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: { code: 'LINE_NOT_PHYSICAL' } });
    });
  });

  it('FO 뒤에 FO 항목이 없는 라인은 LINE_NOT_IN_FULFILLMENT, 전체 취소된 주문은 SALES_ORDER_CANCELLED', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      const [spare] = fx.spareSkuIds;
      // FO 를 만든 뒤에 붙은 라인(void 매칭·FO 전 전량 취소 라인과 같은 처지 — FO 항목이 없다)
      const [late] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: fx.salesOrderId,
          variantId: randomUUID(),
          productName: 'late',
          quantity: 1,
          unitPrice: 1000,
        })
        .returning();
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, late.id, [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: { code: 'LINE_NOT_IN_FULFILLMENT' } });

      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled' })
        .where(eq(wmsTables.salesOrders.id, fx.salesOrderId));
      await expect(
        w.edit.manager.assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: spare, qtyPerUnit: 1 }], null, actor, tx),
      ).rejects.toMatchObject({ response: { code: 'SALES_ORDER_CANCELLED' } });
    });
  });
});
