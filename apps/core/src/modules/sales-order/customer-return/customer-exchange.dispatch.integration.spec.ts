import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { outbox_events } from '@app/events';
import { FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from '../../fulfillment/services/__support__';
import { seedSpareStock } from '../../fulfillment/services/__support__/short-pick-fixtures';
import { assembleOutbound, startBatchFor } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { canonicalFulfillmentRequestHash } from '../../fulfillment/services/fulfillment-command.service';
import { isPreparationBlocked } from '../../fulfillment/services/outbound-preparation-result';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { fulfillmentShippedV1OutboxEvent } from '../../fulfillment/events';
import { seedBox, seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedComponentSku, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { seedDispatchedParcel } from '../line-quantities/__support__/shipment-facts.fixtures';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerExchangeReleaser } from './customer-exchange.releaser';
import { ExchangeShipmentOpener } from '../../fulfillment/exchange-shipment/exchange-shipment-opener';
import { exchangeBoxOf } from './__support__/exchange-box';

/**
 * 교환 상자가 실제 계획·출고를 지난다 (K8 PR11 최종 리뷰 C1). 상자는 실제 CustomerExchangeReleaser 가 열고,
 * 계획은 실제 ShipmentPlanningService, 출고는 실제 배치 시작 → 단순출고 스캔 → ShipmentDispatchService.
 * 교환 줄의 Medusa 품목 id 는 정산 사실이 채우므로 선발송·정산 전 출고는 그 id 없이(NULL) 나가야 한다.
 * 채널 발송 이벤트(ShipmentShipped)는 교환 줄을 싣지 않고, 고객 발송 알림은 나간다. 이미 다 나간 FO 의 v1 완료 투영·
 * FO shipped_at 은 처음 것이 남는다.
 *
 * 실행: DATABASE_URL=<scratch core DB> npx jest --runTestsByPath <this file> --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('교환 상자 계획·출고 (K8 PR11 C1)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  const dbService = makeDbService(db);
  const { location, shipmentReservations } = wireLogistics(dbService);
  afterAll(async () => {
    await client.end();
  });

  const releaser = new CustomerExchangeReleaser(new ExchangeShipmentOpener(shipmentReservations));
  const actor = { id: randomUUID(), roles: ['logistics_worker'] };
  const ORIGINAL_SHIPPED_AT = new Date('2026-10-20T01:00:00.000Z');
  const PICKUP_ADDRESS = {
    recipientName: '회수지',
    phone: '010-1234-5678',
    postalCode: '06236',
    roadAddress: 'Teheran-ro 1',
    detailAddress: '2F',
  };

  /** 계획·배치 시작이 요구하는 완전한 배송 프로필 하나, 그리고 그 프로필·바코드를 단 SKU */
  async function seedProfile(tx: DbTx): Promise<string> {
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `exchange-profile-${randomUUID()}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'Sender', phone: '02-0000-0000' },
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: { address: 'Return' },
        carrierAccountRef: 'exchange-center',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    return profile.id;
  }

  async function dressSku(tx: DbTx, skuId: string, profileId: string): Promise<string> {
    await tx.update(wmsTables.skus).set({ deliveryProfileId: profileId }).where(eq(wmsTables.skus.id, skuId));
    const barcode = `889${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId, barcode, isPrimary: true });
    return barcode;
  }

  /**
   * 배송완료 주문 하나(줄 A: w.skuId × 2, `second` 면 줄 B: 두 번째 SKU × 1 을 같은 FO·다른 소포로) → 원래 출고처럼
   * FO shipped_at·v1 완료 투영을 남기고 → 교환 접수(줄마다 반품 줄 하나). 반환: 상자를 열 수 있는 상태.
   */
  async function seedExchange(tx: DbTx, w: World, opts: { second?: boolean } = {}) {
    const profileId = await seedProfile(tx);
    const barcodes = new Map<string, string>([[w.skuId, await dressSku(tx, w.skuId, profileId)]]);
    await location.ensureSystemLocations(w.warehouseId, tx);
    const line = await seedDeliveredLine(tx, w, {
      quantity: 2,
      composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
      parcels: [{ qtyBySku: { [w.skuId]: 2 } }],
      customerId: randomUUID(),
      ledger: true,
    });
    await tx
      .update(wmsTables.shipments)
      .set({ recipientSnapshot: PICKUP_ADDRESS })
      .where(eq(wmsTables.shipments.id, line.parcels[0].shipmentId));
    await tx
      .update(wmsTables.salesOrders)
      .set({ customerEmail: 'exchange@example.com', customerName: '교환 고객' })
      .where(eq(wmsTables.salesOrders.id, line.salesOrderId));
    const [fo] = await tx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, line.salesOrderId));
    const items: Array<{ channelOrderItemId: string; quantity: number }> = [];
    const channelOrderItemId = `item_${randomUUID().slice(0, 8)}`;
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId, channelProductId: `prod_${randomUUID().slice(0, 8)}` })
      .where(eq(wmsTables.salesOrderLines.id, line.lineId));
    items.push({ channelOrderItemId, quantity: 2 });

    if (opts.second) {
      const secondSku = await seedComponentSku(tx, w);
      barcodes.set(secondSku, await dressSku(tx, secondSku, profileId));
      const secondItemId = `item_${randomUUID().slice(0, 8)}`;
      const [secondLine] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: line.salesOrderId,
          variantId: randomUUID(),
          productName: 'second',
          quantity: 1,
          unitPrice: 1000,
          channelOrderItemId: secondItemId,
          compositionSource: 'matching',
          compositionSetAt: new Date(),
        })
        .returning();
      await tx
        .insert(wmsTables.salesOrderLineCompositions)
        .values({ salesOrderLineId: secondLine.id, skuId: secondSku, qtyPerUnit: 1 });
      const [secondFoi] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: fo.id,
          salesOrderId: line.salesOrderId,
          salesOrderLineId: secondLine.id,
          skuId: secondSku,
          qty: 1,
        })
        .returning();
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalItems: 2, totalQty: 3 })
        .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
      const box = await seedBox(tx, w, [secondFoi.id], { status: 'planned', qty: [1] });
      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: PICKUP_ADDRESS })
        .where(eq(wmsTables.shipments.id, box.shipmentId));
      await tx
        .update(wmsTables.shipmentLines)
        .set({ skuId: secondSku })
        .where(eq(wmsTables.shipmentLines.id, box.lineIds[0]));
      await seedDispatchedParcel(tx, w, {
        shipmentId: box.shipmentId,
        lines: [{ shipmentLineId: box.lineIds[0], foItemId: secondFoi.id, qty: 1 }],
        delivered: true,
        ledger: true,
      });
      items.push({ channelOrderItemId: secondItemId, quantity: 1 });
    }

    // 원래 출고가 남겼을 FO 완료 흔적 — shipped_at 과 v1 완료 투영(FO 당 한 번)
    await tx
      .update(wmsTables.fulfillmentOrders)
      .set({ shippedAt: ORIGINAL_SHIPPED_AT })
      .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
    const originalItems = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
    const shippedQty = originalItems.reduce((sum, item) => sum + item.shippedQty, 0);
    const [so] = await tx
      .select({ channelOrderId: wmsTables.salesOrders.channelOrderId })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, line.salesOrderId));
    await outboxPublisherFor(FULFILLMENT_STREAM, dbService).enqueue(
      fulfillmentShippedV1OutboxEvent(
        {
          fulfillmentId: fo.id,
          orderId: line.salesOrderId,
          channelOrderId: so.channelOrderId,
          trackingInfo: { carrier: 'HANJIN', trackingNumber: 'ORIGINAL-TRACK' },
          shippedAt: ORIGINAL_SHIPPED_AT.toISOString(),
          shippedItems: originalItems.map((item) => ({
            fulfillmentItemId: item.id,
            skuId: item.skuId,
            shippedQty: item.shippedQty,
          })),
        },
        {
          fulfillmentOrderId: fo.id,
          salesOrderId: line.salesOrderId,
          shippedQty,
          canceledQty: 0,
          outstandingQty: 0,
        },
      ),
      tx,
    );

    const intake = new CustomerReturnManager(
      dbService,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
      new LineCompositionManager(dbService),
    );
    const { customerReturnId } = await intake.recordRequested(
      {
        orderId: 'ignored',
        salesChannel: 'medusa',
        externalOrderId: so.channelOrderId,
        returnId: `ret_${randomUUID().slice(0, 8)}`,
        requestId: `req_${randomUUID().slice(0, 8)}`,
        reason: 'defective',
        feeBearer: 'seller',
        requestedBy: 'customer',
        requestedAt: '2026-10-27T01:00:00.000Z',
        items,
        kind: 'exchange',
      },
      tx,
    );
    for (const skuId of barcodes.keys()) {
      await seedSpareStock(tx, { skuId, warehouseId: w.warehouseId }, 5);
    }
    return {
      salesOrderId: line.salesOrderId,
      channelOrderId: so.channelOrderId,
      foId: fo.id,
      profileId,
      barcodes,
      customerReturnId,
    };
  }

  type Seeded = Awaited<ReturnType<typeof seedExchange>>;

  /** 열린 교환 상자를 실제 계획 → 배치·운송장 → 배치 시작 → 단순출고 스캔(전량)으로 내보낸다 */
  async function planAndDispatch(tx: DbTx, w: World, s: Seeded) {
    const outbound = assembleOutbound(tx);
    const box = await exchangeBoxOf(tx, s.salesOrderId);
    expect(box.shipments).toHaveLength(1);
    const [draft] = box.shipments;
    expect(draft.status).toBe('draft');

    await outbound.planning.plan(
      draft.id,
      {
        shippingProfileId: s.profileId,
        expectedManifestVersion: draft.manifestVersion,
        expectedReservationVersion: draft.reservationVersion,
      },
      `plan-${randomUUID()}`,
      actor,
      tx,
    );
    const [planned] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, draft.id));
    expect(planned.status).toBe('planned');

    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `EXCHANGE-BATCH-${randomUUID()}`,
        warehouseId: w.warehouseId,
        pickingMethod: 'individual',
        status: 'created',
      })
      .returning();
    await tx
      .insert(wmsTables.outboundBatchWorkItems)
      .values({ batchId: batch.id, shipmentId: planned.id, status: 'queued', leaseVersion: 0 });
    const trackingNo = `EXCHANGE-TRACK-${randomUUID()}`;
    await tx.insert(wmsTables.waybills).values({
      shipmentId: planned.id,
      source: 'manual',
      carrier: 'HANJIN',
      status: 'registered',
      trackingNo,
      manifestVersion: planned.manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(planned.recipientSnapshot),
    });
    await startBatchFor(tx, { batchId: batch.id, actorId: actor.id });

    let state: unknown = null;
    for (const line of box.shipmentLines) {
      state = await outbound.simple.scan(
        planned.id,
        {
          barcode: s.barcodes.get(line.skuId)!,
          quantity: line.qty,
          actor,
          idempotencyKey: `scan-${randomUUID()}`,
        },
        tx,
      );
    }
    if (!state || isPreparationBlocked(state as never)) throw new Error('Expected prepared outbound state');
    expect(state).toMatchObject({ status: 'shipped' });
    return { shipmentId: planned.id, trackingNo };
  }

  async function outboxOf(tx: DbTx, s: Seeded, shipmentId: string) {
    const rows = await tx
      .select()
      .from(outbox_events)
      .where(inArray(outbox_events.aggregateId, [shipmentId, s.foId, s.salesOrderId]));
    // 아웃박스 행의 payload 는 봉투 전체다 — 이벤트 본문은 그 안의 payload
    const byType = (type: string) =>
      rows
        .filter((row) => row.eventType === type)
        .map((row) => ({ ...row, payload: (row.payload as { payload: Record<string, unknown> }).payload }));
    return { byType };
  }

  async function expectExchangeDispatchFacts(tx: DbTx, s: Seeded, shipmentId: string, exchangeQty: number) {
    const outbox = await outboxOf(tx, s, shipmentId);
    // 채널 발송 이벤트: 상자는 교환 줄만 실었다 → 채널 주문 0 (Medusa 품목에 투영하지 않는다, 원래 품목에도 안 붙인다)
    const shipped = outbox.byType('ShipmentShipped');
    expect(shipped).toHaveLength(1);
    expect((shipped[0].payload as { orders: unknown[] }).orders).toEqual([]);
    // 고객 발송 알림은 나간다 — FO 가 다 나갔으니 부분 발송이 아니다
    const notices = outbox.byType('SalesOrderShipmentDispatched');
    expect(notices).toHaveLength(1);
    expect(notices[0].payload).toMatchObject({
      orderId: s.salesOrderId,
      channelOrderId: s.channelOrderId,
      isPartial: false,
      customerEmail: 'exchange@example.com',
    });
    // v1 완료 투영은 FO 당 한 번 — 원래 출고의 행 하나가 그대로 남는다(교환 FOI 를 다시 싣지 않는다)
    const v1 = outbox.byType('FulfillmentShipped');
    expect(v1).toHaveLength(1);
    expect(v1[0].payload).toMatchObject({ trackingInfo: { trackingNumber: 'ORIGINAL-TRACK' } });
    // v2 진행 사실은 이 시도에 하나, FO 미처리 0
    const progressed = outbox.byType('FulfillmentProgressed');
    expect(progressed).toHaveLength(1);
    expect(progressed[0].payload).toMatchObject({ fulfillmentOrderId: s.foId, outstandingQty: 0 });
    // FO shipped_at 은 처음 다 나간 시각이 남는다
    const [fo] = await tx
      .select({ shippedAt: wmsTables.fulfillmentOrders.shippedAt })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, s.foId));
    expect(fo.shippedAt?.toISOString()).toBe(ORIGINAL_SHIPPED_AT.toISOString());
    // 교환 FOI 는 다 나갔고 원래 FOI 는 그대로다
    const box = await exchangeBoxOf(tx, s.salesOrderId);
    expect(box.items.reduce((sum, item) => sum + item.shippedQty, 0)).toBe(exchangeQty);
    expect(box.items.every((item) => item.shippedQty === item.qty)).toBe(true);
  }

  it('선발송 — 교환 줄의 Medusa 품목 id 가 없어도(NULL) 계획·출고된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seedExchange(tx, w);
      // 기록은 expected 그대로 CS 가 먼저 보낸다
      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId: actor.id })).toBe(true);
      const before = await exchangeBoxOf(tx, s.salesOrderId);
      expect(before.lines.map((line) => line.channelOrderItemId)).toEqual([null]);

      const { shipmentId } = await planAndDispatch(tx, w, s);

      await expectExchangeDispatchFacts(tx, s, shipmentId, 2);
      expect((await exchangeBoxOf(tx, s.salesOrderId)).lines[0].channelOrderItemId).toBeNull();
    });
  });

  it('정산이 먼저 와 교환 줄에 Medusa 품목 id 가 있어도 출고 사실의 모양은 같다(채널 발송 이벤트에 싣지 않는다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seedExchange(tx, w);
      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId: actor.id })).toBe(true);
      const opened = await exchangeBoxOf(tx, s.salesOrderId);
      // 정산 사실이 대체 품목 id 를 잇는 쓰기(recordSettled 의 matchExchangeItems 뒤)와 같은 모양
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: `item_replacement_${randomUUID().slice(0, 8)}` })
        .where(eq(wmsTables.salesOrderLines.id, opened.lines[0].id));

      const { shipmentId } = await planAndDispatch(tx, w, s);

      await expectExchangeDispatchFacts(tx, s, shipmentId, 2);
    });
  });

  it('반품 줄 2 → 교환 줄 2 → 상자 하나(줄 2)로 계획·출고된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seedExchange(tx, w, { second: true });
      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId: actor.id })).toBe(true);
      const opened = await exchangeBoxOf(tx, s.salesOrderId);
      expect(opened.lines).toHaveLength(2);
      expect(opened.shipmentLines).toHaveLength(2);
      expect(opened.reserved).toBe(3);

      const { shipmentId } = await planAndDispatch(tx, w, s);

      await expectExchangeDispatchFacts(tx, s, shipmentId, 3);
      // 원래 품목의 발송 수량은 그대로다 — 교환 상자가 원래 FOI 에 수량을 더하지 않는다
      const original = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(
          and(
            eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, s.foId),
            inArray(
              wmsTables.fulfillmentOrderItems.id,
              (
                await tx
                  .select({ id: wmsTables.fulfillmentOrderItems.id })
                  .from(wmsTables.fulfillmentOrderItems)
                  .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, s.foId))
              )
                .map((row) => row.id)
                .filter((id) => !opened.items.some((item) => item.id === id)),
            ),
          ),
        );
      expect(original.map((item) => item.shippedQty).sort()).toEqual([1, 2]);
    });
  });
});
