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
import { shipSupplierShipment, SupplierDispatchDeps } from './supplier-dispatch';
import { correctSupplierWaybill, reportUnfulfillable } from './supplier-line-reports';
import { OrderProgressReader } from '../order-progress/order-progress.reader';
import { BadRequestError, NotFoundError } from '@app/shared';
import {
  SupplierReasonOnShippedError,
  SupplierShipmentNotShippableError,
  SupplierTrackingInUseError,
} from './supplier-shipment.errors';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** K3 PR5 Task 6 — 송장 정정(N9)과 못 보냄 기록. */
describeIfDb('입점사 송장 정정·못 보냄 (K3 PR5, PostgreSQL integration)', () => {
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

  const correct = (tx: DbTx, shipmentId: string, trackingNo: string, carrier: 'EPOST' | 'CJ' = 'EPOST') =>
    correctSupplierWaybill(deps, tx, {
      shipmentId,
      carrier,
      trackingNo,
      actorId,
      at: new Date('2026-10-25T05:00:00.000Z'),
    });
  const report = (tx: DbTx, shipmentLineId: string, reason: string, by = 'op-1') =>
    reportUnfulfillable(tx, { shipmentLineId, reason, actorId: by, at: new Date('2026-10-25T04:00:00.000Z') });
  const lineOf = async (tx: DbTx, shipmentId: string) =>
    (await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.shipmentId, shipmentId)))[0];

  it('발송된 상자에 새 번호: 옛 송장 voided, 새 송장 used, 시도 waybill_id 갱신, 고객 추적 새 번호, 새 outbox 0, 상자 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      const first = await ship(tx, x.supplierBox, 'OLD-1');
      const [before] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, x.supplierBox));
      const outboxBefore = (await outboxOf(tx, [x.supplierBox, x.salesOrderId, x.foId])).length;

      const result = await correct(tx, x.supplierBox, ' NEW-2 ', 'CJ');

      expect(result.waybillId).not.toBe(first.waybillId);
      const [oldWb] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, first.waybillId));
      expect(oldWb.status).toBe('voided');
      const [newWb] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, result.waybillId));
      expect(newWb).toMatchObject({
        status: 'used',
        source: 'manual',
        carrier: 'CJ',
        trackingNo: 'NEW2',
        shipmentId: x.supplierBox,
      });
      const [attempt] = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, x.supplierBox));
      expect(attempt.waybillId).toBe(result.waybillId);
      const tracking = await trackingOver(tx).getTracking(x.salesOrderId, x.customerId);
      expect(tracking.shipments.find((s) => s.shipmentId === x.supplierBox)).toMatchObject({
        status: 'shipped',
        trackingNumber: 'NEW2',
      });
      expect((await outboxOf(tx, [x.supplierBox, x.salesOrderId, x.foId])).length).toBe(outboxBefore);
      const [after] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, x.supplierBox));
      expect(after.status).toBe('shipped');
      expect(after.manifestVersion).toBe(before.manifestVersion);
      await expect(new FulfillmentInvariantService().assertFulfillmentOrders([x.foId], tx)).resolves.toBeUndefined();
    });
  });

  it('같은 (택배사, 번호)면 아무것도 하지 않고 지금 송장 id, 정규화된 같은 번호도 동일', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      const first = await ship(tx, x.supplierBox, 'EP-1');
      expect((await correct(tx, x.supplierBox, 'EP 1')).waybillId).toBe(first.waybillId);
      expect(
        await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, x.supplierBox)),
      ).toHaveLength(1);
    });
  });

  it('택배사만 바꾸면 정정된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      const first = await ship(tx, x.supplierBox, 'EP-1');
      const r = await correct(tx, x.supplierBox, 'EP-1', 'CJ');
      expect(r.waybillId).not.toBe(first.waybillId);
    });
  });

  it('발송 전·창고 상자는 409, 다른 상자의 살아 있는 번호는 TRACKING_IN_USE 이며 옛 송장은 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      await hand(tx, a.supplierId, a.supplierBox);
      await hand(tx, b.supplierId, b.supplierBox);
      await expect(tx.transaction((sp) => correct(sp as unknown as DbTx, a.supplierBox, 'X-1'))).rejects.toBeInstanceOf(
        SupplierShipmentNotShippableError,
      );
      const warehouseBox = (await boxesOfFo(tx, a.foId)).find((r) => r.supplierId === null);
      if (!warehouseBox) throw new Error('expected a warehouse box');
      await expect(
        tx.transaction((sp) => correct(sp as unknown as DbTx, warehouseBox.id, 'X-1')),
      ).rejects.toBeInstanceOf(SupplierShipmentNotShippableError);

      const first = await ship(tx, a.supplierBox, 'A-1');
      await ship(tx, b.supplierBox, 'B-1');
      await expect(tx.transaction((sp) => correct(sp as unknown as DbTx, a.supplierBox, 'B-1'))).rejects.toBeInstanceOf(
        SupplierTrackingInUseError,
      );
      const [wb] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, first.waybillId));
      expect(wb.status).toBe('used');
      await expect(tx.transaction((sp) => correct(sp as unknown as DbTx, a.supplierBox, ' - '))).rejects.toBeInstanceOf(
        BadRequestError,
      );
    });
  });

  it('못 보냄: 세 칸이 채워지고 수량은 그대로, 보드는 drop_ship_unfulfillable, 같은 사유는 unchanged', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      const line = await lineOf(tx, x.supplierBox);

      expect(await report(tx, line.id, '  품절  ')).toBe('recorded');
      const after = await lineOf(tx, x.supplierBox);
      expect(after).toMatchObject({
        unfulfillableReason: '품절',
        unfulfillableReportedBy: 'op-1',
        qty: line.qty,
      });
      expect(after.unfulfillableReportedAt?.toISOString()).toBe('2026-10-25T04:00:00.000Z');
      const judged = await new OrderProgressReader(makeDbService(db)).judgeShipment(x.supplierBox, tx);
      expect(judged).toMatchObject({ stage: 'dispatch', state: 'drop_ship_unfulfillable' });

      expect(
        await reportUnfulfillable(tx, {
          shipmentLineId: line.id,
          reason: '품절',
          actorId: 'someone-else',
          at: new Date('2026-10-26T00:00:00.000Z'),
        }),
      ).toBe('unchanged');
      const same = await lineOf(tx, x.supplierBox);
      expect(same.unfulfillableReportedBy).toBe('op-1');
      expect(same.unfulfillableReportedAt?.toISOString()).toBe('2026-10-25T04:00:00.000Z');

      expect(await report(tx, line.id, '단종', 'op-2')).toBe('recorded');
      expect((await lineOf(tx, x.supplierBox)).unfulfillableReason).toBe('단종');
    });
  });

  it('못 보냄: 빈 사유 400, 없는 라인 404, 발송된 상자·창고 상자 라인은 409 REASON_ON_SHIPPED', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx);
      await hand(tx, x.supplierId, x.supplierBox);
      const line = await lineOf(tx, x.supplierBox);
      await expect(tx.transaction((sp) => report(sp as unknown as DbTx, line.id, '  '))).rejects.toBeInstanceOf(
        BadRequestError,
      );
      await expect(tx.transaction((sp) => report(sp as unknown as DbTx, randomUUID(), '품절'))).rejects.toBeInstanceOf(
        NotFoundError,
      );
      const warehouseBox = (await boxesOfFo(tx, x.foId)).find((r) => r.supplierId === null);
      if (!warehouseBox) throw new Error('expected a warehouse box');
      const wLine = await lineOf(tx, warehouseBox.id);
      await expect(tx.transaction((sp) => report(sp as unknown as DbTx, wLine.id, '품절'))).rejects.toBeInstanceOf(
        SupplierReasonOnShippedError,
      );
      await ship(tx, x.supplierBox);
      const err = await tx.transaction((sp) => report(sp as unknown as DbTx, line.id, '품절')).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SupplierReasonOnShippedError);
      expect((err as SupplierReasonOnShippedError).getErrorCode()).toBe('REASON_ON_SHIPPED');
      expect((err as SupplierReasonOnShippedError).getHttpStatus()).toBe(409);
    });
  });
});
