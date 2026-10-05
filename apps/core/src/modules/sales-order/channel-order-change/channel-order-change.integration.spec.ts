import { randomUUID } from 'crypto';
import { and, eq, like } from 'drizzle-orm';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  wireLogistics,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedMatching,
  receiveStock,
} from '../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { PoliciesService } from '../services/policies.service';
import { SalesOrdersService } from '../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';
import { ChannelOrderChangeReader } from './channel-order-change.reader';
import { ChannelOrderChangeManager } from './channel-order-change.manager';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };
const NEXT = { ...ADDRESS, roadAddress: '부산', detailAddress: '202' };

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
  const amendments = new SalesOrderAmendmentsService(dbService);
  const reader = new ChannelOrderChangeReader(salesOrders);
  const manager = new ChannelOrderChangeManager(reader, salesOrders, amendments, {
    get: () => outbound.planning,
  } as never);
  return { logistics, outbound, salesOrders, manager };
}

/** 판매주문(채널 라인 2개, 수량 2·1) → FO → draft 박스. withFo=false 면 FO 를 만들지 않는다. */
async function seedOrder(tx: DbTx, w: ReturnType<typeof wire>, opts: { withFo: boolean }) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const lines = [
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 2 },
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 1 },
  ];
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `ext-${randomUUID().slice(0, 8)}`,
      salesChannel: 'medusa',
      status: 'confirmed',
      shippingAddress: ADDRESS,
      orderDate: new Date(),
    })
    .returning();
  const lineIds: string[] = [];
  const skuIds: string[] = [];
  for (const line of lines) {
    const { skuId } = await seedSku(tx, holderId);
    skuIds.push(skuId);
    await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
    const variantId = randomUUID();
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    const [row] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: so.id,
        variantId,
        productName: 'IT',
        quantity: line.qty,
        unitPrice: 1000,
        channelOrderItemId: line.item,
        channelProductId: `cp-${line.item}`,
      })
      .returning();
    lineIds.push(row.id);
  }
  if (opts.withFo) await w.logistics.fulfillments.create({ salesOrderId: so.id, warehouseId }, tx);
  return { salesOrderId: so.id, externalOrderId: so.channelOrderId, lines, lineIds, skuIds, warehouseId };
}

function payload(
  seed: Awaited<ReturnType<typeof seedOrder>>,
  over: Partial<OrderModifiedPayload['snapshot']>,
): OrderModifiedPayload {
  return {
    orderId: randomUUID(),
    salesChannel: 'medusa',
    externalOrderId: seed.externalOrderId,
    modifiedAt: new Date().toISOString(),
    snapshot: {
      shippingAddress: ADDRESS,
      lines: seed.lines.map((line) => ({
        channelOrderItemId: line.item,
        channelProductId: `cp-${line.item}`,
        quantity: line.qty,
        unitPrice: 1000,
        cancelled: false,
      })),
      ...over,
    },
  };
}

async function amendmentsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderAmendments)
    .where(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId));
}

async function boxesOf(tx: DbTx, salesOrderId: string) {
  return tx
    .selectDistinct({
      id: wmsTables.shipments.id,
      status: wmsTables.shipments.status,
      recipientSnapshot: wmsTables.shipments.recipientSnapshot,
    })
    .from(wmsTables.shipments)
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
}

describeIfDb('채널 변경 반영 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('배송지 — 판매주문·출고지시·draft 박스에 한 번에 반영되고 applied 행 하나', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).toEqual(NEXT);
      const fos = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, seed.salesOrderId));
      expect(fos.every((fo) => JSON.stringify(fo.shippingAddress) === JSON.stringify(NEXT))).toBe(true);
      // jsonb 는 키 순서를 바꿔 저장하므로 문자열이 아니라 값으로 비교한다.
      const boxes = await boxesOf(tx, seed.salesOrderId);
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) expect(box.recipientSnapshot).toEqual(NEXT);
      const rows = await amendmentsOf(tx, seed.salesOrderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ origin: 'channel', status: 'applied', amendmentKind: 'fulfillment_only' });
    });
  });

  it('배송지 — 박스에 살아 있는 송장이 있으면 판매주문 주소도 그대로이고 WAYBILL_ISSUED 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      const [box] = await boxesOf(tx, seed.salesOrderId);
      await tx.insert(wmsTables.waybills).values({
        shipmentId: box.id,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'registered',
        trackingNo: `T${Date.now()}`,
        manifestVersion: 1,
        recipientHash: 'x'.repeat(64), // ck_waybills_recipient_hash: length = 64
      });
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).toEqual(ADDRESS);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('pending');
      expect(row.deltas).toEqual([
        expect.objectContaining({
          type: 'shipping_address_change',
          outcome: 'pending',
          blockers: [expect.objectContaining({ code: 'WAYBILL_ISSUED', shipmentId: box.id })],
        }),
      ]);
    });
  });

  it('배송지 — 출고지시·박스가 전부 떠났으면 판매주문 주소도 그대로이고 SHIPMENT_NOT_REVISABLE(already shipped) 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      for (const box of await boxesOf(tx, seed.salesOrderId)) {
        await tx.update(wmsTables.shipments).set({ status: 'shipped' }).where(eq(wmsTables.shipments.id, box.id));
      }
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'shipped', shippedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, seed.salesOrderId));
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).toEqual(ADDRESS);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('pending');
      expect(row.deltas).toEqual([
        expect.objectContaining({
          type: 'shipping_address_change',
          outcome: 'pending',
          blockers: [{ code: 'SHIPMENT_NOT_REVISABLE', detail: 'already shipped' }],
        }),
      ]);
    });
  });

  it('배송지 — 진행 중인 직배가 있으면 SHIPMENT_NOT_REVISABLE 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ fulfillmentMode: 'drop_ship', directShipStatus: 'forwarded' })
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, seed.salesOrderId));
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.deltas).toEqual([
        expect.objectContaining({ blockers: [expect.objectContaining({ code: 'SHIPMENT_NOT_REVISABLE' })] }),
      ]);
    });
  });

  it('배송지 — 박스 수정이 도메인 거절이 아닌 예외(Error)로 실패하면 대기로 삼키지 않고 그대로 던진다(스펙 §11)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      const failingPlanning = {
        reviseRecipientFromChannel: () => Promise.reject(new Error('boom')),
      };
      const manager = new ChannelOrderChangeManager(
        new ChannelOrderChangeReader(w.salesOrders),
        w.salesOrders,
        new SalesOrderAmendmentsService(ambientDbService(tx)),
        { get: () => failingPlanning } as never,
      );
      await expect(
        manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx),
      ).rejects.toThrow('boom');
    });
  });

  it('배송지 — 직배가 아직 공급처에 넘어가지 않았으면(pending) 막지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ fulfillmentMode: 'drop_ship', directShipStatus: 'pending' })
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, seed.salesOrderId));
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('applied');
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).toEqual(NEXT);
    });
  });

  it('감소 — 출고지시 전이면 반영되고 취소 행에 walletRefund 효과가 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const p = payload(seed, {});
      p.snapshot.lines[0].quantity = 1;
      await w.manager.handle(seed.salesOrderId, p, `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('applied');
      expect(await w.salesOrders.getCancelledQuantityByLine(seed.salesOrderId, tx)).toEqual(
        new Map([[seed.lineIds[0], 1]]),
      );
      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(JSON.stringify(cancellations.map((c) => c.effects))).not.toContain('wallet_refund');
    });
  });

  it('감소 — draft 박스면 즉시 반영, planned 박스면 되돌리고 CANCEL_NOT_IMMEDIATE(박스 무변경)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      const first = payload(seed, {});
      first.snapshot.lines[0].quantity = 1;
      await w.manager.handle(seed.salesOrderId, first, `m-${randomUUID()}`, tx);
      expect((await amendmentsOf(tx, seed.salesOrderId))[0].status).toBe('applied');

      for (const box of await boxesOf(tx, seed.salesOrderId)) {
        await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, box.id));
      }
      const second = payload(seed, {});
      second.snapshot.lines[0].quantity = 1;
      second.snapshot.lines[1].quantity = 0;
      await w.manager.handle(seed.salesOrderId, second, `m-${randomUUID()}`, tx);
      const rows = await amendmentsOf(tx, seed.salesOrderId);
      const latest = rows.find((row) => row.status === 'pending');
      expect(latest?.deltas).toEqual([
        expect.objectContaining({
          salesOrderLineId: seed.lineIds[1],
          outcome: 'pending',
          blockers: [expect.objectContaining({ code: 'CANCEL_NOT_IMMEDIATE' })],
        }),
      ]);
      const boxes = await boxesOf(tx, seed.salesOrderId);
      expect(boxes.every((box) => box.status === 'planned')).toBe(true);
    });
  });

  it('감소 — V1 출고지시(박스 이력 없음)에서 이미 출고된 수량이면 되돌리고 CANCEL_NOT_IMMEDIATE(취소·회수 이관 없음)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      // V2 박스가 없는 옛 출고지시 — `hasV2FulfillmentHistory` 가 거짓이라 `cancelPartial` 경로로 간다.
      const [fo] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: seed.salesOrderId,
          warehouseId: seed.warehouseId,
          status: 'shipped',
          shippedAt: new Date(),
          totalItems: 1,
          totalQty: 2,
          shippingAddress: ADDRESS,
        })
        .returning();
      await tx.insert(wmsTables.fulfillmentOrderItems).values({
        fulfillmentOrderId: fo.id,
        salesOrderId: seed.salesOrderId,
        salesOrderLineId: seed.lineIds[0],
        skuId: seed.skuIds[0],
        qty: 2,
        pickedQty: 2,
        shippedQty: 2,
        status: 'shipped',
      });
      const p = payload(seed, {});
      p.snapshot.lines[0].quantity = 1;
      const sourceEventId = `m-${randomUUID()}`;
      await w.manager.handle(seed.salesOrderId, p, sourceEventId, tx);

      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('pending');
      expect(row.deltas).toEqual([
        expect.objectContaining({
          type: 'quantity_correction',
          salesOrderLineId: seed.lineIds[0],
          outcome: 'pending',
          blockers: [{ code: 'CANCEL_NOT_IMMEDIATE', detail: 'cancellation needs post-shipment follow-up' }],
        }),
      ]);
      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toEqual([]);
      expect(await w.salesOrders.getCancelledQuantityByLine(seed.salesOrderId, tx)).toEqual(new Map());
      const handoffLinks = await tx
        .select()
        .from(wmsTables.businessLinks)
        .where(
          and(
            eq(wmsTables.businessLinks.sourceId, seed.salesOrderId),
            like(wmsTables.businessLinks.relationName, 'cancellation_linked_post_shipment_%'),
          ),
        );
      expect(handoffLinks).toEqual([]);
    });
  });

  it('전 라인 0 이면 ALL_LINES_REMOVED, 증가·추가는 OUT_OF_SCOPE', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: [] }), `m-${randomUUID()}`, tx);
      const grow = payload(seed, {});
      grow.snapshot.lines[0].quantity = 5;
      grow.snapshot.lines.push({
        channelOrderItemId: 'ci-new',
        channelProductId: 'cp-new',
        quantity: 1,
        unitPrice: 1,
        cancelled: false,
      });
      await w.manager.handle(seed.salesOrderId, grow, `m-${randomUUID()}`, tx);
      const rows = await amendmentsOf(tx, seed.salesOrderId);
      const superseded = rows.find((row) => row.status === 'superseded');
      const pending = rows.find((row) => row.status === 'pending');
      expect(JSON.stringify(superseded?.deltas)).toContain('ALL_LINES_REMOVED');
      expect(pending?.deltas).toEqual([
        expect.objectContaining({ type: 'quantity_correction', blockers: [{ code: 'OUT_OF_SCOPE' }] }),
        expect.objectContaining({ type: 'add_product', blockers: [{ code: 'OUT_OF_SCOPE' }] }),
      ]);
    });
  });

  it('lifecycle 취소가 먼저 적용된 라인을 cancelled 로 실은 스냅샷은 다시 줄이지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      await w.salesOrders.cancel(
        seed.salesOrderId,
        {
          lines: [{ salesOrderLineId: seed.lineIds[1], quantity: 1 }],
          cancelledBy: 'naver',
          metadata: { sourceEventId: `lc-${randomUUID()}` },
        },
        tx,
      );
      const p = payload(seed, {});
      p.snapshot.lines[1].cancelled = true;
      await w.manager.handle(seed.salesOrderId, p, `m-${randomUUID()}`, tx);
      expect(await amendmentsOf(tx, seed.salesOrderId)).toEqual([]);
      expect(await w.salesOrders.getCancelledQuantityByLine(seed.salesOrderId, tx)).toEqual(
        new Map([[seed.lineIds[1], 1]]),
      );
    });
  });

  it('실질 차이 0 이면 새 행 없이 이전 pending 만 superseded', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const grow = payload(seed, {});
      grow.snapshot.lines[0].quantity = 9;
      await w.manager.handle(seed.salesOrderId, grow, `m-${randomUUID()}`, tx);
      await w.manager.handle(seed.salesOrderId, payload(seed, {}), `m-${randomUUID()}`, tx);
      const rows = await amendmentsOf(tx, seed.salesOrderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'superseded', supersededById: null });
    });
  });

  it('셀메이트가 shipped 로 찍은 판매주문(core 출고 기록 없음) — 배송지는 판매주문 그대로 SHIPMENT_NOT_REVISABLE 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      // scripts/sellmate/mark-shipped-from-csv.ts 가 하는 일 그대로 — status 만 바꾼다(#1016 15번 행).
      await tx.update(wmsTables.salesOrders).set({ status: 'shipped' }).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).toEqual(ADDRESS);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('pending');
      expect(row.deltas).toEqual([
        expect.objectContaining({
          type: 'shipping_address_change',
          outcome: 'pending',
          blockers: [{ code: 'SHIPMENT_NOT_REVISABLE', detail: 'sales order marked shipped' }],
        }),
      ]);
    });
  });

  it('셀메이트가 shipped 로 찍은 판매주문 — 감소는 취소하지 않고 CANCEL_NOT_IMMEDIATE 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      await tx.update(wmsTables.salesOrders).set({ status: 'shipped' }).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      const p = payload(seed, {});
      p.snapshot.lines[0].quantity = 1;
      await w.manager.handle(seed.salesOrderId, p, `m-${randomUUID()}`, tx);
      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toHaveLength(0);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('pending');
      expect(row.deltas).toEqual([
        expect.objectContaining({
          type: 'quantity_correction',
          outcome: 'pending',
          blockers: [{ code: 'CANCEL_NOT_IMMEDIATE', detail: 'sales order marked shipped' }],
        }),
      ]);
    });
  });
});
