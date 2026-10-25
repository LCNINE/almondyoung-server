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
import { ManifestEditDeps } from '../shipment/shipment-manifest-edit';
import { WaybillRepository } from '../waybill/waybill.repository';
import { shipSupplierShipment, SupplierDispatchDeps } from './supplier-dispatch';
import { mergeSupplierShipments, splitOffSupplierLines } from './supplier-manifest';
import { SupplierMergeRecipientMismatchError, SupplierShipmentNotEditableError } from './supplier-shipment.errors';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const RECIPIENT = {
  recipientName: '홍길동',
  phone: '010-1234-5678',
  postalCode: '06236',
  roadAddress: '서울 강남구 테헤란로 1',
  detailAddress: '101호',
};

/** K3 PR5 Task 5 — 입점사 상자 나누기·합포장(창고 합배송과 같은 표현). */
describeIfDb('입점사 상자 나누기·합포장 (K3 PR5, PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let wired: Wired;
  let manifestDeps: ManifestEditDeps;
  let dispatchDeps: SupplierDispatchDeps;
  const at = new Date('2026-10-25T03:00:00.000Z');

  beforeAll(() => {
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService);
    manifestDeps = { invariant: new FulfillmentInvariantService(), reservations: wired.shipmentReservations };
    dispatchDeps = {
      shipments: outboxPublisherFor(SHIPMENT_STREAM, dbService),
      fulfillmentsV2: outboxPublisherFor(FULFILLMENT_V2_STREAM, dbService),
      fulfillmentsV1: outboxPublisherFor(FULFILLMENT_STREAM, dbService),
      coreOrders: outboxPublisherFor(CORE_ORDER_STREAM, dbService),
      audit: new AuditService(dbService),
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

  async function seedDropSku(tx: DbTx, holderId: string, supplierId: string): Promise<string> {
    const { skuId } = await seedSku(tx, holderId);
    await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, skuId));
    await tx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId });
    return skuId;
  }

  /** 입점사 직배 라인만(또는 창고 라인 하나를 더한) 주문 하나를 FO 로 만든다. dropQtys 당 라인 하나. */
  async function order(tx: DbTx, supplierId: string, opts: { dropQtys: number[]; withWarehouseLine?: boolean }) {
    const w = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const lines: Array<{ skuId: string; quantity: number }> = [];
    for (const quantity of opts.dropQtys) lines.push({ skuId: await seedDropSku(tx, holderId, supplierId), quantity });
    if (opts.withWarehouseLine) {
      const { skuId } = await seedSku(tx, holderId);
      await tx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId: w.warehouseId,
        locationId: w.locationId,
        stockState: 'ON_HAND',
        qty: 3,
      });
      lines.push({ skuId, quantity: 3 });
    }
    const variants = lines.map(() => randomUUID());
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: lines.map((line, i) => ({ variantId: variants[i], quantity: line.quantity })),
    });
    for (const lineId of lineIds) {
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: `item-${lineId.slice(0, 8)}` })
        .where(eq(wmsTables.salesOrderLines.id, lineId));
    }
    for (const [i, line] of lines.entries()) await seedMatching(tx, { variantId: variants[i], skuId: line.skuId });
    await tx
      .update(wmsTables.salesOrders)
      .set({ customerId: randomUUID(), customerEmail: 'it@example.com', customerName: '고객' })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
    if (!fo) throw new Error('expected a fulfillment order');
    const boxes = await tx
      .selectDistinct({
        id: wmsTables.shipments.id,
        supplierId: wmsTables.shipments.supplierId,
      })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
    const supplierBox = boxes.find((b) => b.supplierId !== null)?.id;
    if (!supplierBox) throw new Error('expected a supplier box');
    const warehouseBox = boxes.find((b) => b.supplierId === null)?.id ?? null;
    await tx
      .update(wmsTables.shipments)
      .set({ recipientSnapshot: RECIPIENT })
      .where(eq(wmsTables.shipments.id, supplierBox));
    return { salesOrderId, foId: fo.id, supplierBox, warehouseBox };
  }

  async function handoffOf(tx: DbTx, supplierId: string, shipmentId: string, createdAt = new Date()) {
    const handoffId = await seedHandoff(tx, supplierId, createdAt);
    await tx
      .update(wmsTables.shipments)
      .set({ supplierHandoffId: handoffId })
      .where(eq(wmsTables.shipments.id, shipmentId));
    return handoffId;
  }

  const boxRow = async (tx: DbTx, id: string) =>
    (await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, id)))[0];
  const linesOf = (tx: DbTx, id: string) =>
    tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.shipmentId, id));

  async function expectConsistent(tx: DbTx, foIds: string[]) {
    await expect(new FulfillmentInvariantService().assertFulfillmentOrders(foIds, tx)).resolves.toBeUndefined();
  }
  async function reservationCount(tx: DbTx, boxIds: string[]) {
    const lineIds = (
      await tx
        .select({ id: wmsTables.shipmentLines.id })
        .from(wmsTables.shipmentLines)
        .where(inArray(wmsTables.shipmentLines.shipmentId, boxIds))
    ).map((l) => l.id);
    if (lineIds.length === 0) return 0;
    const rows = await tx
      .select()
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          inArray(wmsTables.stockReservations.targetId, lineIds),
        ),
      );
    return rows.length;
  }

  it('라인 셋 중 둘을 떼면 새 상자에 둘(같은 라인 id), 원래 상자에 하나, 둘 다 같은 넘김·수령인', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2, 3] });
      const handoffId = await handoffOf(tx, supplierId, o.supplierBox);
      await tx
        .update(wmsTables.shipments)
        .set({ entrancePassword: '#1234' })
        .where(eq(wmsTables.shipments.id, o.supplierBox));
      const before = await linesOf(tx, o.supplierBox);
      expect(before).toHaveLength(3);
      const moving = before.slice(0, 2).map((l) => l.id);

      const newId = await splitOffSupplierLines(manifestDeps, tx, o.supplierBox, moving);

      expect(newId).not.toBe(o.supplierBox);
      expect((await linesOf(tx, newId)).map((l) => l.id).sort()).toEqual([...moving].sort());
      expect((await linesOf(tx, o.supplierBox)).map((l) => l.id)).toEqual([before[2].id]);
      const [orig, created] = [await boxRow(tx, o.supplierBox), await boxRow(tx, newId)];
      expect(created).toMatchObject({
        status: 'draft',
        supplierId,
        warehouseId: null,
        shippingProfileId: null,
        supplierHandoffId: handoffId,
        entrancePassword: '#1234',
        recoveryCode: null,
      });
      expect(created.recipientSnapshot).toEqual(orig.recipientSnapshot);
      expect(orig.supplierHandoffId).toBe(handoffId);
      await expectConsistent(tx, [o.foId]);
      expect(await reservationCount(tx, [o.supplierBox, newId])).toBe(0);
    });
  });

  it('전부를 떼면 원래 상자 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2] });
      const before = await linesOf(tx, o.supplierBox);
      const boxBefore = await boxRow(tx, o.supplierBox);

      const id = await splitOffSupplierLines(
        manifestDeps,
        tx,
        o.supplierBox,
        before.map((l) => l.id),
      );

      expect(id).toBe(o.supplierBox);
      expect((await linesOf(tx, o.supplierBox)).map((l) => l.id).sort()).toEqual(before.map((l) => l.id).sort());
      expect((await boxRow(tx, o.supplierBox)).manifestVersion).toBe(boxBefore.manifestVersion);
    });
  });

  it('나누기는 입점사 상자·draft 가 아니거나 상자 밖 라인이면 409', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2], withWarehouseLine: true });
      const lines = await linesOf(tx, o.supplierBox);
      if (!o.warehouseBox) throw new Error('expected a warehouse box');
      const whLines = await linesOf(tx, o.warehouseBox);
      await expect(
        tx.transaction((sp) =>
          splitOffSupplierLines(manifestDeps, sp as unknown as DbTx, o.warehouseBox!, [whLines[0].id]),
        ),
      ).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);
      await expect(
        tx.transaction((sp) =>
          splitOffSupplierLines(manifestDeps, sp as unknown as DbTx, o.supplierBox, [whLines[0].id]),
        ),
      ).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);
      await expect(
        tx.transaction((sp) => splitOffSupplierLines(manifestDeps, sp as unknown as DbTx, o.supplierBox, [])),
      ).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);
      await tx
        .update(wmsTables.shipments)
        .set({ recoveryCode: 'CONSOLIDATION_PENDING' })
        .where(eq(wmsTables.shipments.id, o.supplierBox));
      await expect(
        tx.transaction((sp) =>
          splitOffSupplierLines(manifestDeps, sp as unknown as DbTx, o.supplierBox, [lines[0].id]),
        ),
      ).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);
    });
  });

  it('같은 입점사의 두 주문 상자를 합치면 새 상자 하나, 원래 둘 superseded, 새 라인 createdFromLineId, 넘김은 더 이른 묶음', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1, 2] });
      const b = await order(tx, supplierId, { dropQtys: [3] });
      const earlier = await handoffOf(tx, supplierId, a.supplierBox, new Date('2026-10-20T00:00:00Z'));
      await handoffOf(tx, supplierId, b.supplierBox, new Date('2026-10-22T00:00:00Z'));
      await tx
        .update(wmsTables.shipments)
        .set({ entrancePassword: '#9999' })
        .where(eq(wmsTables.shipments.id, b.supplierBox));
      const srcLines = [...(await linesOf(tx, a.supplierBox)), ...(await linesOf(tx, b.supplierBox))];

      const mergedId = await mergeSupplierShipments(manifestDeps, tx, [a.supplierBox, b.supplierBox]);

      const merged = await boxRow(tx, mergedId);
      expect(merged).toMatchObject({
        status: 'draft',
        supplierId,
        warehouseId: null,
        shippingProfileId: null,
        supplierHandoffId: earlier,
      });
      expect(merged.entrancePassword).toBeTruthy();
      expect((await boxRow(tx, a.supplierBox)).status).toBe('superseded');
      expect((await boxRow(tx, b.supplierBox)).status).toBe('superseded');
      const newLines = await linesOf(tx, mergedId);
      expect(newLines).toHaveLength(3);
      for (const src of srcLines) {
        const target = newLines.find((l) => l.fulfillmentOrderItemId === src.fulfillmentOrderItemId);
        expect(target).toMatchObject({ qty: src.qty, createdFromLineId: src.id });
      }
      // 원래 상자는 라인을 지닌 채 superseded
      expect(await linesOf(tx, a.supplierBox)).toHaveLength(2);
      await expectConsistent(tx, [a.foId, b.foId]);
      expect(await reservationCount(tx, [a.supplierBox, b.supplierBox, mergedId])).toBe(0);
    });
  });

  it('수령인이 다르면 MERGE_RECIPIENT_MISMATCH, 다른 입점사·창고 상자·draft 아님이면 409', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1] });
      const b = await order(tx, supplierId, { dropQtys: [1], withWarehouseLine: true });
      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: { ...RECIPIENT, detailAddress: '202호' } })
        .where(eq(wmsTables.shipments.id, b.supplierBox));
      const attempt = (ids: string[]) =>
        tx.transaction((sp) => mergeSupplierShipments(manifestDeps, sp as unknown as DbTx, ids));

      await expect(attempt([a.supplierBox, b.supplierBox])).rejects.toBeInstanceOf(SupplierMergeRecipientMismatchError);
      expect(new SupplierMergeRecipientMismatchError('x').getErrorCode()).toBe('MERGE_RECIPIENT_MISMATCH');
      expect(new SupplierMergeRecipientMismatchError('x').getHttpStatus()).toBe(409);

      const otherSupplier = await seedDirectSupplier(tx);
      const c = await order(tx, otherSupplier, { dropQtys: [1] });
      await expect(attempt([a.supplierBox, c.supplierBox])).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);

      if (!b.warehouseBox) throw new Error('expected a warehouse box');
      await expect(attempt([a.supplierBox, b.warehouseBox])).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);

      await expect(attempt([a.supplierBox])).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);
      await expect(attempt([a.supplierBox, a.supplierBox])).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);

      await tx
        .update(wmsTables.shipments)
        .set({ recoveryCode: 'CONSOLIDATION_PENDING' })
        .where(eq(wmsTables.shipments.id, b.supplierBox));
      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: RECIPIENT })
        .where(eq(wmsTables.shipments.id, b.supplierBox));
      await expect(attempt([a.supplierBox, b.supplierBox])).rejects.toBeInstanceOf(SupplierShipmentNotEditableError);
    });
  });

  it('합친 상자를 발송하면 두 판매주문 각각에 SalesOrderShipmentDispatched', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await order(tx, supplierId, { dropQtys: [1] });
      const b = await order(tx, supplierId, { dropQtys: [2] });
      await handoffOf(tx, supplierId, a.supplierBox);
      await handoffOf(tx, supplierId, b.supplierBox);
      const mergedId = await mergeSupplierShipments(manifestDeps, tx, [a.supplierBox, b.supplierBox]);

      await shipSupplierShipment(dispatchDeps, tx, {
        shipmentId: mergedId,
        carrier: 'EPOST',
        trackingNo: 'MG-1',
        actorId: 'op',
        at,
      });

      const rows = await tx
        .select()
        .from(outbox_events)
        .where(inArray(outbox_events.aggregateId, [a.salesOrderId, b.salesOrderId]));
      const dispatched = rows.filter((r) => r.eventType === 'SalesOrderShipmentDispatched');
      expect(dispatched.map((r) => r.aggregateId).sort()).toEqual([a.salesOrderId, b.salesOrderId].sort());
      expect((await boxRow(tx, mergedId)).status).toBe('shipped');
      await expectConsistent(tx, [a.foId, b.foId]);
    });
  });

  it('나눈 상자도 발송되고 정합성 위반 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const o = await order(tx, supplierId, { dropQtys: [1, 2] });
      await handoffOf(tx, supplierId, o.supplierBox);
      const lines = await linesOf(tx, o.supplierBox);
      const newId = await splitOffSupplierLines(manifestDeps, tx, o.supplierBox, [lines[0].id]);
      await shipSupplierShipment(dispatchDeps, tx, {
        shipmentId: newId,
        carrier: 'EPOST',
        trackingNo: 'SP-1',
        actorId: 'op',
        at,
      });
      expect((await boxRow(tx, newId)).status).toBe('shipped');
      expect((await boxRow(tx, o.supplierBox)).status).toBe('draft');
      await expectConsistent(tx, [o.foId]);
    });
  });
});
