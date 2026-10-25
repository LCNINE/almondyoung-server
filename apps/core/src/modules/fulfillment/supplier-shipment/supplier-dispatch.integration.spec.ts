import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { outbox_events } from '@app/events';
import {
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { StoreSalesOrdersService } from '../../sales-order/services/store-sales-orders.service';
import { seedHandoff } from '../order-progress/__support__/order-progress.fixtures';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
  Wired,
} from '../services/__support__';
import { outboxPublisherFor } from '../outbox/__support__/outbox-publisher.factory';
import { WaybillTrackingLiveConflictError } from '../waybill/waybill.errors';
import { WaybillRepository } from '../waybill/waybill.repository';
import { normalizeTrackingNo, shipSupplierShipment, SupplierDispatchDeps } from './supplier-dispatch';
import { BadRequestError, NotFoundError } from '@app/shared';
import { SupplierShipmentNotShippableError, SupplierTrackingInUseError } from './supplier-shipment.errors';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** K3 PR5 Task 4 — 입점사 상자 하나를 수기 송장 하나로 발송한다(ADR-0050). */
describeIfDb('입점사 상자 발송 (K3 PR5, PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let wired: Wired;
  let deps: SupplierDispatchDeps;
  const at = new Date('2026-10-25T03:00:00.000Z');
  const actorId = 'op-supplier-dispatch';

  beforeAll(() => {
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService);
    deps = {
      shipments: outboxPublisherFor(SHIPMENT_STREAM, dbService),
      fulfillmentsV2: outboxPublisherFor(FULFILLMENT_V2_STREAM, dbService),
      fulfillmentsV1: outboxPublisherFor(FULFILLMENT_STREAM, dbService),
      coreOrders: outboxPublisherFor(CORE_ORDER_STREAM, dbService),
      audit: new AuditService(dbService),
      invariant: new FulfillmentInvariantService(),
      waybills: new WaybillRepository(dbService),
    };
  });
  afterAll(async () => {
    await client.end();
  });

  async function seedDirectSupplier(tx: DbTx): Promise<string> {
    const [row] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `it-direct-${randomUUID().slice(0, 8)}`, isDirectDelivery: true })
      .returning();
    return row.id;
  }

  async function seedDropShippedSku(tx: DbTx, holderId: string, supplierId: string): Promise<string> {
    const { skuId } = await seedSku(tx, holderId);
    await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, skuId));
    await tx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId });
    return skuId;
  }

  /** 섞인 주문(창고분 + 직배분) 또는 직배분만인 주문을 FO 로 만든다. 입점사 상자는 넘기지 않은 채 돌려준다. */
  async function world(tx: DbTx, opts: { mixed: boolean } = { mixed: true }) {
    const w = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const supplierId = await seedDirectSupplier(tx);
    const dropSku = await seedDropShippedSku(tx, holderId, supplierId);
    const lines: Array<{ skuId: string; quantity: number }> = [{ skuId: dropSku, quantity: 2 }];
    if (opts.mixed) {
      const { skuId: warehouseSku } = await seedSku(tx, holderId);
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: warehouseSku,
        warehouseId: w.warehouseId,
        locationId: w.locationId,
        stockState: 'ON_HAND',
        qty: 3,
      });
      lines.push({ skuId: warehouseSku, quantity: 3 });
    }
    const variants = lines.map(() => randomUUID());
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: lines.map((line, i) => ({ variantId: variants[i], quantity: line.quantity })),
    });
    // 발송 이벤트는 채널 주문 품목 id 가 있는 라인만 싣는다(신뢰할 수 있는 채널 신원)
    for (const lineId of lineIds) {
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: `item-${lineId.slice(0, 8)}` })
        .where(eq(wmsTables.salesOrderLines.id, lineId));
    }
    for (const [i, line] of lines.entries()) await seedMatching(tx, { variantId: variants[i], skuId: line.skuId });
    const customerId = randomUUID();
    await tx
      .update(wmsTables.salesOrders)
      .set({ customerId, customerEmail: 'it@example.com', customerName: '고객' })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
    if (!fo) throw new Error('expected a fulfillment order');
    const supplierBox = await supplierBoxOf(tx, fo.id);
    return { w, supplierId, salesOrderId, customerId, foId: fo.id, supplierBox, dropSku };
  }

  async function boxesOfFo(tx: DbTx, foId: string) {
    return tx
      .selectDistinct({ id: wmsTables.shipments.id, supplierId: wmsTables.shipments.supplierId })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId));
  }

  async function supplierBoxOf(tx: DbTx, foId: string) {
    const box = (await boxesOfFo(tx, foId)).find((row) => row.supplierId !== null);
    if (!box) throw new Error('expected a supplier box');
    return box.id;
  }

  async function hand(tx: DbTx, supplierId: string, shipmentId: string) {
    const handoffId = await seedHandoff(tx, supplierId);
    await tx
      .update(wmsTables.shipments)
      .set({ supplierHandoffId: handoffId })
      .where(eq(wmsTables.shipments.id, shipmentId));
    return handoffId;
  }

  /** 고객 추적은 롤백 트랜잭션 안의 행을 봐야 하므로 tx 를 db 로 꽂는다(풀로 읽으면 커밋 전 행이 안 보이고 풀이 막힌다). */
  const trackingOver = (tx: DbTx) =>
    new StoreSalesOrdersService(
      { db: tx } as never,
      {} as never,
      {} as never,
      { forSalesOrder: async () => [] } as never,
      {} as never,
      {} as never,
    );

  const ship = (tx: DbTx, shipmentId: string, trackingNo = 'EP-100-200', carrier: 'EPOST' | 'CJ' = 'EPOST') =>
    shipSupplierShipment(deps, tx, { shipmentId, carrier, trackingNo, actorId, at });

  async function outboxOf(tx: DbTx, aggregateIds: string[]) {
    return tx.select().from(outbox_events).where(inArray(outbox_events.aggregateId, aggregateIds));
  }

  it('넘긴 입점사 상자를 EPOST 송장으로 발송하면 상자 shipped, 시도 kind supplier·원장 NULL, 송장 manual·used, FOI shipped_qty = 수량', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);

      const result = await ship(tx, x.supplierBox);

      const [box] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, x.supplierBox));
      expect(box.status).toBe('shipped');
      const [attempt] = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, x.supplierBox));
      expect(attempt).toMatchObject({
        id: result.attemptId,
        attemptNo: 1,
        kind: 'supplier',
        status: 'dispatched',
        stockJournalId: null,
        reversalJournalId: null,
        waybillId: result.waybillId,
        idempotencyKey: `supplier-dispatch:${x.supplierBox}:1`,
      });
      expect(attempt.dispatchedAt?.toISOString()).toBe(at.toISOString());
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, result.waybillId));
      expect(waybill).toMatchObject({
        source: 'manual',
        status: 'used',
        carrier: 'EPOST',
        trackingNo: 'EP100200',
        shipmentId: x.supplierBox,
      });
      const [dropFoi] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(
          and(
            eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, x.foId),
            eq(wmsTables.fulfillmentOrderItems.skuId, x.dropSku),
          ),
        );
      expect(dropFoi.shippedQty).toBe(2);
      await expect(new FulfillmentInvariantService().assertFulfillmentOrders([x.foId], tx)).resolves.toBeUndefined();
    });
  });

  it('커밋 전 정합성 판정이 던지면 발송이 통째로 물러난다(판정은 해당 FO 로 불린다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      await hand(tx, x.supplierId, x.supplierBox);
      const assertFulfillmentOrders = jest.fn().mockRejectedValue(new Error('invariant violated'));

      await expect(
        tx.transaction((sp) =>
          shipSupplierShipment({ ...deps, invariant: { assertFulfillmentOrders } }, sp as unknown as DbTx, {
            shipmentId: x.supplierBox,
            carrier: 'EPOST',
            trackingNo: 'EP-1',
            actorId,
            at,
          }),
        ),
      ).rejects.toThrow('invariant violated');

      expect(assertFulfillmentOrders).toHaveBeenCalledWith([x.foId], expect.anything());
      const [box] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, x.supplierBox));
      expect(box.status).toBe('draft'); // savepoint 롤백 — 발송이 남지 않는다
    });
  });

  it('고객 추적에 상자별 택배사·송장번호가 나오고, 발송 전 입점사 상자는 draft 에 송장이 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);

      const before = await trackingOver(tx).getTracking(x.salesOrderId, x.customerId);
      const draft = before.shipments.find((s) => s.shipmentId === x.supplierBox);
      expect(draft).toMatchObject({ status: 'draft', trackingNumber: '' });
      expect(draft?.dispatchAttempts).toHaveLength(0);

      await ship(tx, x.supplierBox);

      const after = await trackingOver(tx).getTracking(x.salesOrderId, x.customerId);
      expect(after.shipments.find((s) => s.shipmentId === x.supplierBox)).toMatchObject({
        status: 'shipped',
        carrier: 'EPOST',
        trackingNumber: 'EP100200',
      });
    });
  });

  it('outbox 에 ShipmentShipped(supplierId, warehouseId 없음)·SalesOrderShipmentDispatched·FulfillmentProgressed 가 계약대로 적재된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      const result = await ship(tx, x.supplierBox);

      const rows = await outboxOf(tx, [x.supplierBox, x.salesOrderId, x.foId]);
      const payloadOf = (eventType: string) => {
        const row = rows.find((r) => r.eventType === eventType);
        if (!row) throw new Error(`no outbox row ${eventType}`);
        const envelope = row.payload as { payload?: unknown };
        return envelope.payload ?? row.payload;
      };
      const shipped = SHIPMENT_STREAM.events.ShipmentShipped.schema!.parse(payloadOf('ShipmentShipped')) as Record<
        string,
        unknown
      >;
      expect(shipped).toMatchObject({
        shipmentId: x.supplierBox,
        supplierId: x.supplierId,
        dispatchAttemptId: result.attemptId,
        invoice: { invoiceId: result.waybillId, carrier: 'EPOST', trackingNo: 'EP100200' },
      });
      expect(shipped.warehouseId).toBeUndefined();
      CORE_ORDER_STREAM.events.SalesOrderShipmentDispatched.schema!.parse(payloadOf('SalesOrderShipmentDispatched'));
      FULFILLMENT_V2_STREAM.events.FulfillmentProgressed.schema!.parse(payloadOf('FulfillmentProgressed'));
    });
  });

  it('섞인 FO 에서 직배분만 발송하면 FO shipped_at NULL, FulfillmentShipped v1 없음', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: true });
      await hand(tx, x.supplierId, x.supplierBox);
      await ship(tx, x.supplierBox);

      const [fo] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, x.foId));
      expect(fo.shippedAt).toBeNull();
      const rows = await outboxOf(tx, [x.foId]);
      expect(rows.filter((r) => r.eventType === 'FulfillmentShipped')).toHaveLength(0);
      expect(rows.filter((r) => r.eventType === 'FulfillmentProgressed')).toHaveLength(1);
    });
  });

  it('직배분만인 FO 면 shipped_at 이 찍히고 FulfillmentShipped v1 이 실제 택배사·송장으로 나간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      await hand(tx, x.supplierId, x.supplierBox);
      await ship(tx, x.supplierBox, '6000-1234', 'CJ');

      const [fo] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, x.foId));
      expect(fo.shippedAt?.toISOString()).toBe(at.toISOString());
      const rows = await outboxOf(tx, [x.foId]);
      const v1 = rows.filter((r) => r.eventType === 'FulfillmentShipped');
      expect(v1).toHaveLength(1);
      const envelope = v1[0].payload as { payload?: unknown };
      const payload = FULFILLMENT_STREAM.events.FulfillmentShipped.schema!.parse(envelope.payload ?? v1[0].payload);
      expect(payload).toMatchObject({ trackingInfo: { carrier: 'CJ', trackingNumber: '60001234' } });
      await expect(new FulfillmentInvariantService().assertFulfillmentOrders([x.foId], tx)).resolves.toBeUndefined();
    });
  });

  it('못 보냄 기록이 있던 라인은 발송 뒤 기록이 비어 있다 (N8)', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      await tx
        .update(wmsTables.shipmentLines)
        .set({ unfulfillableReason: '품절', unfulfillableReportedAt: at, unfulfillableReportedBy: 'supplier-op' })
        .where(eq(wmsTables.shipmentLines.shipmentId, x.supplierBox));

      await ship(tx, x.supplierBox);

      const lines = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, x.supplierBox));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatchObject({
          unfulfillableReason: null,
          unfulfillableReportedAt: null,
          unfulfillableReportedBy: null,
        });
      }
    });
  });

  it('넘기지 않은 상자·창고 상자·recovery_code 상자는 SUPPLIER_SHIPMENT_NOT_SHIPPABLE', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      // 넘기지 않음
      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, x.supplierBox))).rejects.toBeInstanceOf(
        SupplierShipmentNotShippableError,
      );
      // 창고 상자
      const boxes = await boxesOfFo(tx, x.foId);
      const warehouseBox = boxes.find((b) => b.supplierId === null);
      if (!warehouseBox) throw new Error('expected a warehouse box');
      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, warehouseBox.id))).rejects.toMatchObject({
        constructor: SupplierShipmentNotShippableError,
      });
      // recovery_code 상자
      await hand(tx, x.supplierId, x.supplierBox);
      await tx
        .update(wmsTables.shipments)
        .set({ recoveryCode: 'CONSOLIDATION_PENDING' })
        .where(eq(wmsTables.shipments.id, x.supplierBox));
      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, x.supplierBox))).rejects.toBeInstanceOf(
        SupplierShipmentNotShippableError,
      );
      expect(new SupplierShipmentNotShippableError('x').getErrorCode()).toBe('SUPPLIER_SHIPMENT_NOT_SHIPPABLE');
      expect(new SupplierShipmentNotShippableError('x').getHttpStatus()).toBe(409);
    });
  });

  it('다른 상자에서 살아 있는 송장번호는 TRACKING_IN_USE 이고 아무것도 남지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      await hand(tx, a.supplierId, a.supplierBox);
      await hand(tx, b.supplierId, b.supplierBox);
      await ship(tx, a.supplierBox, 'DUP-1');

      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, b.supplierBox, 'DUP-1'))).rejects.toBeInstanceOf(
        SupplierTrackingInUseError,
      );
      expect(new SupplierTrackingInUseError('x').getErrorCode()).toBe('TRACKING_IN_USE');
      expect(new SupplierTrackingInUseError('x').getHttpStatus()).toBe(409);

      const [box] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, b.supplierBox));
      expect(box.status).toBe('draft');
      expect(
        await tx
          .select()
          .from(wmsTables.dispatchAttempts)
          .where(eq(wmsTables.dispatchAttempts.shipmentId, b.supplierBox)),
      ).toHaveLength(0);
      expect(
        await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, b.supplierBox)),
      ).toHaveLength(0);

      // 선검사를 피한 경합에서도 유일 제약이 같은 에러로 옮겨진다
      await expect(
        tx.transaction((sp) =>
          deps.waybills.insertSupplierManualUsed(sp as unknown as DbTx, {
            shipmentId: b.supplierBox,
            carrier: 'EPOST',
            trackingNo: 'DUP1',
            manifestVersion: 1,
            recipientHash: 'a'.repeat(64),
          }),
        ),
      ).rejects.toBeInstanceOf(WaybillTrackingLiveConflictError);
    });
  });

  it('송장번호는 공백·하이픈을 지우고 대문자로 저장하고, 같은 번호의 다른 표기(소문자 포함)도 TRACKING_IN_USE 다', async () => {
    expect(normalizeTrackingNo(' EP-100 200 ')).toBe('EP100200');
    expect(normalizeTrackingNo('ep-100 200')).toBe('EP100200');
    await inRollbackTx(db, async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      await hand(tx, a.supplierId, a.supplierBox);
      await hand(tx, b.supplierId, b.supplierBox);
      const result = await ship(tx, a.supplierBox, ' EP-100 200 ');
      const [wb] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, result.waybillId));
      expect(wb.trackingNo).toBe('EP100200');
      await expect(
        tx.transaction((sp) => ship(sp as unknown as DbTx, b.supplierBox, 'EP-100-200')),
      ).rejects.toBeInstanceOf(SupplierTrackingInUseError);
      await expect(
        tx.transaction((sp) => ship(sp as unknown as DbTx, b.supplierBox, 'ep100200')),
      ).rejects.toBeInstanceOf(SupplierTrackingInUseError);
    });
  });

  it('빈 송장번호는 400, 없는 상자는 404', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, x.supplierBox, ' - '))).rejects.toBeInstanceOf(
        BadRequestError,
      );
      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, randomUUID()))).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  it('이미 발송된 상자·활성 송장이 있는 상자·라인 없는 상자는 NOT_SHIPPABLE', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      await ship(tx, x.supplierBox, 'ONCE-1');
      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, x.supplierBox, 'ONCE-2'))).rejects.toBeInstanceOf(
        SupplierShipmentNotShippableError,
      );

      const y = await world(tx);
      await hand(tx, y.supplierId, y.supplierBox);
      await tx.insert(wmsTables.waybills).values({
        shipmentId: y.supplierBox,
        source: 'manual',
        carrier: 'EPOST',
        status: 'registered',
        trackingNo: 'ACTIVE-1',
        manifestVersion: 1,
        recipientHash: 'b'.repeat(64),
      });
      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, y.supplierBox, 'ONCE-3'))).rejects.toBeInstanceOf(
        SupplierShipmentNotShippableError,
      );

      const z = await world(tx);
      const handoffId = await seedHandoff(tx, z.supplierId);
      const [empty] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: null, supplierId: z.supplierId, supplierHandoffId: handoffId, status: 'draft' })
        .returning();
      await expect(tx.transaction((sp) => ship(sp as unknown as DbTx, empty.id, 'ONCE-4'))).rejects.toBeInstanceOf(
        SupplierShipmentNotShippableError,
      );
    });
  });
});
