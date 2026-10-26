import { randomUUID } from 'crypto';
import { and, desc, eq, like } from 'drizzle-orm';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { ChannelCancelSettler } from '../channel-cancel-request/channel-cancel-settler';
import { ChannelCancelRequestReader } from '../channel-cancel-request/channel-cancel-request.reader';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import * as fixtures from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
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
import { SalesOrdersService } from '../services/sales-orders.service';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { seedCancellableOrder, wireCancellation } from '../cancellation-record/__support__/cancellation-scenarios';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';
import { ChannelOrderChangeReader } from './channel-order-change.reader';
import { ChannelOrderChangeManager } from './channel-order-change.manager';
import { OrderCancellation } from '../order-cancellation/order-cancellation';
import { OrderCancellationReader } from '../order-cancellation/order-cancellation.reader';
import { PrintOrderReader } from '../../print-order/services/print-order.reader';
import { PRINT_HELD_FOR_DECREASE, PrintOrderRepository } from '../../print-order/services/print-order.repository';
import { PrintOrderCancellationManager } from '../../print-order/services/print-order-cancellation.manager';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };
const NEXT = { ...ADDRESS, roadAddress: '부산', detailAddress: '202' };

/**
 * 실제 커널. 수량 감소 갈래는 판매주문 취소·커널 reader·인쇄 붙잡기(holdForDecrease)만 쓴다 —
 * 요청 협력자와 와우프레스 클라이언트는 비워 둔다(붙잡기는 외부를 부르지 않는다)
 */
function kernelFor(
  dbService: ReturnType<typeof ambientDbService>,
  salesOrders: SalesOrdersService,
  settler: ChannelCancelSettler,
) {
  const printOrders = new PrintOrderReader(dbService);
  return new OrderCancellation(
    dbService,
    salesOrders,
    {} as never,
    printOrders,
    new PrintOrderCancellationManager(printOrders, new PrintOrderRepository(dbService), {} as never),
    settler,
    new OrderCancellationReader(),
    {} as never,
  );
}

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.unboxedDemand,
    logistics.productSkuMapping,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  const amendments = new SalesOrderAmendmentsService(dbService);
  const reader = new ChannelOrderChangeReader();
  const settler = new ChannelCancelSettler(new ChannelCancelRequestReader());
  const manager = new ChannelOrderChangeManager(
    reader,
    amendments,
    {
      get: () => outbound.planning,
    } as never,
    settler,
    kernelFor(dbService, salesOrders, settler),
  );
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

  /** 주문의 FO 항목 하나를 열린 입점사 상자(draft)에 담는다. handoff 면 입점사 넘김 묶음도 단다 */
  async function seedSupplierBox(tx: DbTx, salesOrderId: string, handoff: boolean) {
    const supplierId = await fixtures.seedDirectSupplier(tx);
    const [item] = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.salesOrderId, salesOrderId))
      .limit(1);
    const supplierHandoffId = handoff ? await fixtures.seedHandoff(tx, supplierId) : undefined;
    await fixtures.seedBox(tx, { warehouseId: '', skuId: item.skuId, holderId: '' }, [item.id], {
      status: 'draft',
      supplierId,
      supplierHandoffId,
    });
  }

  it('배송지 — 넘긴 열린 입점사 상자가 있으면 SHIPMENT_NOT_REVISABLE 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await seedSupplierBox(tx, seed.salesOrderId, true);
      expect(await new ChannelOrderChangeReader().hasDropShipInProgress(seed.salesOrderId, tx)).toBe(true);
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.deltas).toEqual([
        expect.objectContaining({ blockers: [expect.objectContaining({ code: 'SHIPMENT_NOT_REVISABLE' })] }),
      ]);
    });
  });

  it('배송지 — 와우프레스로 보낸 인쇄 줄이 있으면 판매주문 주소도 그대로이고 SHIPMENT_NOT_REVISABLE 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await tx.insert(wmsTables.printOrders).values({
        salesOrderId: seed.salesOrderId,
        salesOrderLineId: randomUUID(),
        almondDesignId: randomUUID(),
        status: 'submitted',
        vendorOrderNumber: 'W-1',
        orderAttemptedAt: new Date(),
      });
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.deltas).toEqual([
        expect.objectContaining({
          blockers: [{ code: 'SHIPMENT_NOT_REVISABLE', detail: 'print order already sent to WowPress' }],
        }),
      ]);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).not.toEqual(NEXT);
    });
  });

  it('배송지 — 아직 발주 전인 인쇄 줄만 있으면 반영된다(발주할 때 새 주소를 읽는다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await tx.insert(wmsTables.printOrders).values({
        salesOrderId: seed.salesOrderId,
        salesOrderLineId: randomUUID(),
        almondDesignId: randomUUID(),
        status: 'pending',
      });
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('applied');
    });
  });

  it('배송지 — 박스 수정이 도메인 거절이 아닌 예외(Error)로 실패하면 대기로 삼키지 않고 그대로 던진다(스펙 §11)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      const failingPlanning = {
        reviseRecipientFromChannel: () => Promise.reject(new Error('boom')),
      };
      const settler = new ChannelCancelSettler(new ChannelCancelRequestReader());
      const manager = new ChannelOrderChangeManager(
        new ChannelOrderChangeReader(),
        new SalesOrderAmendmentsService(ambientDbService(tx)),
        { get: () => failingPlanning } as never,
        settler,
        kernelFor(ambientDbService(tx), w.salesOrders, settler),
      );
      await expect(
        manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx),
      ).rejects.toThrow('boom');
    });
  });

  it('배송지 — 넘기지 않은 입점사 상자만이면 이 검사로는 거절하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await seedSupplierBox(tx, seed.salesOrderId, false);
      expect(await new ChannelOrderChangeReader().hasDropShipInProgress(seed.salesOrderId, tx)).toBe(false);
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
      const lineQuantities = await readLineQuantities(tx, seed.salesOrderId);
      expect(lineQuantities.get(seed.lineIds[0])?.canceled).toBe(1);
      expect(lineQuantities.get(seed.lineIds[1])?.canceled).toBe(0);
      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(JSON.stringify(cancellations.map((c) => c.effects))).not.toContain('wallet_refund');
    });
  });

  it('감소 — 인쇄 줄이면 판매주문 취소 없이 CANCEL_NOT_IMMEDIATE 대기(와우프레스는 원래 수량으로 발주된다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      await tx.insert(wmsTables.printOrders).values({
        salesOrderId: seed.salesOrderId,
        salesOrderLineId: seed.lineIds[0],
        almondDesignId: randomUUID(),
        status: 'pending',
      });
      const p = payload(seed, {});
      p.snapshot.lines[0].quantity = 1;
      await w.manager.handle(seed.salesOrderId, p, `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.deltas).toEqual([
        expect.objectContaining({
          blockers: [{ code: 'CANCEL_NOT_IMMEDIATE', detail: 'print order on this line — decide on WowPress' }],
        }),
      ]);
      // 인쇄 줄은 쓰기 전에 거절한다 — savepoint 되돌림은 아래 출고분 거절 케이스가 증명한다
      // 아무것도 취소되지 않았다 — 문은 모든 라인을 canceled 0 으로 낸다(빈 맵이 아니다)
      expect([...(await readLineQuantities(tx, seed.salesOrderId)).values()].map((line) => line.canceled)).toEqual([
        0, 0,
      ]);
      // 거절 savepoint 가 되돌려도 아직 안 보낸 인쇄는 운영자 확인으로 붙잡혀, 워커가 원래 수량으로 주문하지 않는다
      const [print] = await tx
        .select()
        .from(wmsTables.printOrders)
        .where(eq(wmsTables.printOrders.salesOrderLineId, seed.lineIds[0]));
      expect(print).toMatchObject({ status: 'cancel_refused', lastError: PRINT_HELD_FOR_DECREASE });
    });
  });

  it('감소 — draft 박스도, 시작된 배치 밖의 planned 박스도 즉시 반영한다(planned 는 draft 로 돌아간다, #1016 30번)', async () => {
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
      expect(rows.map((row) => row.status)).toEqual(['applied', 'applied']);
      expect(rows.flatMap((row) => row.deltas)).toContainEqual(
        expect.objectContaining({ salesOrderLineId: seed.lineIds[1], outcome: 'applied' }),
      );

      const boxes = await boxesOf(tx, seed.salesOrderId);
      // 일부 취소는 남은 줄의 상자를 draft 로 되돌리고, 취소한 줄은 canceled 비석 상자로 떼어 낸다
      expect(boxes.map((box) => box.status).sort()).toEqual(['canceled', 'draft']);
    });
  });

  it('감소 — 상자 전 출고지시(박스 이력 없음)에서 이미 출고된 수량이면 되돌리고 CANCEL_NOT_IMMEDIATE(취소·회수 이관 없음)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      // 박스 이력이 없는 옛 출고지시 — `hasBoxedFulfillment` 가 거짓이라 `cancelBeforeBoxingPartial` 경로로 간다.
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
      // 아무것도 취소되지 않았다 — 문은 모든 라인을 canceled 0 으로 낸다(빈 맵이 아니다)
      expect([...(await readLineQuantities(tx, seed.salesOrderId)).values()].map((line) => line.canceled)).toEqual([
        0, 0,
      ]);
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

  it('전 라인 0 이어도 안 보낸 인쇄는 붙잡는다 — ALL_LINES_REMOVED 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      await tx.insert(wmsTables.printOrders).values({
        salesOrderId: seed.salesOrderId,
        salesOrderLineId: seed.lineIds[0],
        almondDesignId: randomUUID(),
        status: 'pending',
      });
      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: [] }), `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.deltas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ salesOrderLineId: seed.lineIds[0], blockers: [{ code: 'ALL_LINES_REMOVED' }] }),
        ]),
      );
      // 대기로 정했어도 워커가 원래 수량으로 주문하지 않게 붙잡는다 — 운영자가 수량을 확인한 뒤 진행한다
      const [print] = await tx
        .select()
        .from(wmsTables.printOrders)
        .where(eq(wmsTables.printOrders.salesOrderLineId, seed.lineIds[0]));
      expect(print).toMatchObject({ status: 'cancel_refused', lastError: PRINT_HELD_FOR_DECREASE });
      // 시도하지 않았다 — 아무것도 취소되지 않았다
      expect([...(await readLineQuantities(tx, seed.salesOrderId)).values()].map((line) => line.canceled)).toEqual([
        0, 0,
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
      const lineQuantities = await readLineQuantities(tx, seed.salesOrderId);
      expect(lineQuantities.get(seed.lineIds[0])?.canceled).toBe(0);
      expect(lineQuantities.get(seed.lineIds[1])?.canceled).toBe(1);
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

  it.each(['shipped', 'delivered'] as const)(
    '셀메이트가 %s 로 찍은 판매주문(core 출고 기록 없음) — 배송지는 판매주문 그대로 SHIPMENT_NOT_REVISABLE 대기',
    async (status) => {
      await inRollbackTx(db, async (tx) => {
        const w = wire(tx);
        const seed = await seedOrder(tx, w, { withFo: false });
        // scripts/sellmate/mark-shipped-from-csv.ts 가 하는 일 그대로 — status 만 바꾼다(#1016 15번 행).
        await tx.update(wmsTables.salesOrders).set({ status }).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
        await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
        const [so] = await tx
          .select()
          .from(wmsTables.salesOrders)
          .where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
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
    },
  );

  it.each(['shipped', 'delivered'] as const)(
    '셀메이트가 %s 로 찍은 판매주문 — 감소는 취소하지 않고 CANCEL_NOT_IMMEDIATE 대기',
    async (status) => {
      await inRollbackTx(db, async (tx) => {
        const w = wire(tx);
        const seed = await seedOrder(tx, w, { withFo: false });
        await tx.update(wmsTables.salesOrders).set({ status }).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
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
    },
  );

  async function dismissLatestPending(tx: DbTx, salesOrderId: string) {
    const [row] = await tx
      .select({ id: wmsTables.salesOrderAmendments.id })
      .from(wmsTables.salesOrderAmendments)
      .where(
        and(
          eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId),
          eq(wmsTables.salesOrderAmendments.status, 'pending'),
        ),
      )
      .orderBy(desc(wmsTables.salesOrderAmendments.createdAt))
      .limit(1);
    await tx
      .update(wmsTables.salesOrderAmendments)
      .set({ status: 'dismissed', dismissedAt: new Date() })
      .where(eq(wmsTables.salesOrderAmendments.id, row.id));
    return row.id;
  }

  it('무시 — 똑같은 스냅샷이 다시 오면 pending 이 생기지 않고 무시 행은 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const increased = payload(seed, {
        lines: seed.lines.map((line, i) => ({
          channelOrderItemId: line.item,
          channelProductId: `cp-${line.item}`,
          quantity: i === 0 ? 5 : line.qty,
          unitPrice: 1000,
          cancelled: false,
        })),
      });
      await w.manager.handle(seed.salesOrderId, increased, `msg-${randomUUID()}`, tx);
      const dismissedId = await dismissLatestPending(tx, seed.salesOrderId);

      await w.manager.handle(seed.salesOrderId, { ...increased, orderId: randomUUID() }, `msg-${randomUUID()}`, tx);

      const rows = await amendmentsOf(tx, seed.salesOrderId);
      expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
      expect(rows.find((row) => row.id === dismissedId)?.status).toBe('dismissed');
    });
  });

  it('무시 — 새 범위 밖 차이가 섞이면 델타 전부를 담은 pending 하나', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const lineOf = (qty0: number, qty1: number) =>
        seed.lines.map((line, i) => ({
          channelOrderItemId: line.item,
          channelProductId: `cp-${line.item}`,
          quantity: i === 0 ? qty0 : qty1,
          unitPrice: 1000,
          cancelled: false,
        }));
      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: lineOf(5, 1) }), `msg-${randomUUID()}`, tx);
      await dismissLatestPending(tx, seed.salesOrderId);

      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: lineOf(5, 4) }), `msg-${randomUUID()}`, tx);

      const pending = (await amendmentsOf(tx, seed.salesOrderId)).filter((row) => row.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].deltas).toHaveLength(2);
    });
  });

  it('무시 — 뒤이어 반영 가능한 주소 변경이 오면 applied 행 하나, pending 0, 무시 행 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const increasedLines = seed.lines.map((line, i) => ({
        channelOrderItemId: line.item,
        channelProductId: `cp-${line.item}`,
        quantity: i === 0 ? 5 : line.qty,
        unitPrice: 1000,
        cancelled: false,
      }));
      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: increasedLines }), `msg-${randomUUID()}`, tx);
      const dismissedId = await dismissLatestPending(tx, seed.salesOrderId);

      await w.manager.handle(
        seed.salesOrderId,
        payload(seed, { lines: increasedLines, shippingAddress: NEXT }),
        `msg-${randomUUID()}`,
        tx,
      );

      const rows = await amendmentsOf(tx, seed.salesOrderId);
      expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
      expect(rows.filter((row) => row.status === 'applied')).toHaveLength(1);
      expect(rows.find((row) => row.id === dismissedId)?.status).toBe('dismissed');
    });
  });

  it('effective quantity after an after-boxing full cancellation is zero', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);
      const [digital] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: o.salesOrderId,
          variantId: randomUUID(),
          productName: 'IT Digital',
          unitPrice: 1000,
          quantity: 1,
          fulfillmentKind: 'digital',
          requiresShipping: false,
        })
        .returning();
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);
      await w.salesOrders.cancel(
        o.salesOrderId,
        { cancelledBy: 'customer', metadata: { sourceEventId: `self-${randomUUID()}` } },
        tx,
      );

      // E1: 옛 코드는 전체취소를 세지 않아 둘 다 주문 수량 그대로(2, 1)였다.
      const effective = await new ChannelOrderChangeReader().lockEffectiveOrder(o.salesOrderId, tx);
      const byId = new Map(effective?.lines.map((line) => [line.id, line.effectiveQuantity]));
      expect(byId.get(o.lineId)).toBe(0);
      expect(byId.get(digital.id)).toBe(0);
    });
  });
});
