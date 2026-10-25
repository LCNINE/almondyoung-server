import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { FulfillmentInvariantService } from '../../fulfillment/services/fulfillment-invariant.service';
import { WaybillRepository } from '../../fulfillment/waybill/waybill.repository';
import { shipSupplierShipment, SupplierDispatchDeps } from '../../fulfillment/supplier-shipment/supplier-dispatch';
import { recallSupplierShipment } from '../../fulfillment/supplier-shipment/supplier-recall';
import { mergeSupplierShipments } from '../../fulfillment/supplier-shipment/supplier-manifest';
import { reportUnfulfillable } from '../../fulfillment/supplier-shipment/supplier-line-reports';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { wireCancellation } from '../cancellation-record/__support__/cancellation-scenarios';
import {
  boxesOfOrder,
  cancelNoticesOf,
  draftSupplierBoxOf,
  markHandedOff,
  seedSupplierCancellableOrder,
} from '../cancellation-record/__support__/supplier-cancellation-scenarios';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * K3 PR6 — 넘긴 입점사 상자 라인의 취소는 상자 후 취소 경로가 같은 트랜잭션·같은 취소 id 로 «알릴 취소» 행을 남긴다
 * (스펙 §4.7, ADR-0050). 넘기지 않은 상자·«못 보냄» 라인·창고 라인은 행이 없다.
 */
describeIfDb('SalesOrdersService 취소 — 입점사 상자 알릴 취소 (K3 PR6)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  const at = new Date('2026-10-26T03:00:00.000Z');
  const op = randomUUID();
  const admin = { cancelledBy: 'admin' };
  const command = (key: string) => ({ actorId: op, actorRoles: ['admin'], idempotencyKey: key });

  function dispatchDeps(tx: DbTx): SupplierDispatchDeps {
    const dbService = ambientDbService(tx);
    return {
      shipments: outboxPublisherFor(SHIPMENT_STREAM, dbService),
      fulfillmentsV2: outboxPublisherFor(FULFILLMENT_V2_STREAM, dbService),
      fulfillmentsV1: outboxPublisherFor(FULFILLMENT_STREAM, dbService),
      coreOrders: outboxPublisherFor(CORE_ORDER_STREAM, dbService),
      audit: new AuditService(dbService),
      invariant: new FulfillmentInvariantService(),
      waybills: new WaybillRepository(dbService),
    };
  }

  async function shipAndRecall(tx: DbTx, shipmentId: string, trackingNo: string) {
    const deps = dispatchDeps(tx);
    const sent = await shipSupplierShipment(deps, tx, {
      shipmentId,
      carrier: 'EPOST',
      trackingNo,
      actorId: op,
      at,
    });
    const [box] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    await recallSupplierShipment(
      {
        shipments: deps.shipments,
        fulfillmentsV2: deps.fulfillmentsV2,
        invariant: new FulfillmentInvariantService(),
        voidUsedWaybill: async (id, trx) => {
          await deps.waybills.casUsedToVoided(trx, id, at);
        },
      },
      tx,
      {
        shipmentId,
        dispatchAttemptId: sent.attemptId,
        recallOperationId: randomUUID(),
        expectedManifestVersion: box.manifestVersion,
        actorId: op,
        at,
      },
    );
  }

  async function cancellationsOf(tx: DbTx, salesOrderId: string) {
    return tx
      .select()
      .from(wmsTables.salesOrderCancellations)
      .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
  }

  it('넘긴 입점사 상자 전체 취소 — 행 하나, 취소 id 는 취소 행 id, 입점사는 상자 주인, 상자 canceled', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedSupplierCancellableOrder(tx, w, { supplierLines: [{ supplierKey: 'A', quantity: 2 }] });
      const box = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
      await markHandedOff(tx, box.shipment.id, o.supplierIds.A);

      await w.salesOrders.cancel(o.salesOrderId, { reasonCode: 'customer_request', ...admin }, tx);

      const [cancellation] = await cancellationsOf(tx, o.salesOrderId);
      expect(await cancelNoticesOf(tx, o.salesOrderId)).toEqual([
        expect.objectContaining({
          orderCancellationId: cancellation.id,
          supplierId: o.supplierIds.A,
          holderId: null,
          salesOrderLineId: o.lineIds[0],
          fulfillmentOrderItemId: box.lines[0].fulfillmentOrderItemId,
          canceledQty: 2,
          cancellationScope: 'full',
          notifiedAt: null,
        }),
      ]);
      const [after] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipment.id));
      expect(after.status).toBe('canceled');
    });
  });

  it('넘기지 않은 입점사 상자 취소 — 행 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedSupplierCancellableOrder(tx, w, { supplierLines: [{ supplierKey: 'A', quantity: 2 }] });

      await w.salesOrders.cancel(o.salesOrderId, admin, tx);

      expect(await cancelNoticesOf(tx, o.salesOrderId)).toEqual([]);
      expect(await cancellationsOf(tx, o.salesOrderId)).toHaveLength(1);
    });
  });

  it('부분 취소 2/5 — 행 canceled_qty 2·partial, 상자 draft·라인 3, forwarded 3', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedSupplierCancellableOrder(tx, w, { supplierLines: [{ supplierKey: 'A', quantity: 5 }] });
      const box = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
      await markHandedOff(tx, box.shipment.id, o.supplierIds.A);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineIds[0], quantity: 2 }], ...admin },
        tx,
      );

      expect(await cancelNoticesOf(tx, o.salesOrderId)).toEqual([
        expect.objectContaining({ canceledQty: 2, cancellationScope: 'partial', supplierId: o.supplierIds.A }),
      ]);
      const after = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
      expect(after.shipment.id).toBe(box.shipment.id);
      expect(after.lines.map((line) => line.qty)).toEqual([3]);
      expect(
        (await readLineQuantities(tx, o.salesOrderId)).get(o.lineIds[0])?.skus.map((sku) => sku.forwarded),
      ).toEqual([3]);
    });
  });

  it('못 보냄 라인과 보통 라인이 한 상자에 있으면 전체 취소는 보통 라인만 행을 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedSupplierCancellableOrder(tx, w, {
        supplierLines: [
          { supplierKey: 'A', quantity: 1 },
          { supplierKey: 'A', quantity: 2 },
        ],
      });
      const box = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
      await markHandedOff(tx, box.shipment.id, o.supplierIds.A);
      const unfulfillable = box.lines.find((line) => line.salesOrderLineId === o.lineIds[0])!;
      await reportUnfulfillable(tx, { shipmentLineId: unfulfillable.id, reason: '품절', actorId: op, at });

      await w.salesOrders.cancel(o.salesOrderId, admin, tx);

      expect(await cancelNoticesOf(tx, o.salesOrderId)).toEqual([
        expect.objectContaining({ salesOrderLineId: o.lineIds[1], canceledQty: 2 }),
      ]);
    });
  });

  it('창고분 + 입점사 A(넘김) + 입점사 B(넘기지 않음) 전체 취소 — 행은 A 라인만, 창고 상자 canceled·확정 예약 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedSupplierCancellableOrder(tx, w, {
        warehouseQty: 3,
        supplierLines: [
          { supplierKey: 'A', quantity: 2 },
          { supplierKey: 'B', quantity: 1 },
        ],
      });
      const boxA = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
      await markHandedOff(tx, boxA.shipment.id, o.supplierIds.A);

      await w.salesOrders.cancel(o.salesOrderId, admin, tx);

      expect(await cancelNoticesOf(tx, o.salesOrderId)).toEqual([
        expect.objectContaining({ supplierId: o.supplierIds.A, salesOrderLineId: o.lineIds[0], canceledQty: 2 }),
      ]);
      const boxes = await boxesOfOrder(tx, o.salesOrderId);
      const warehouse = boxes.filter((b) => b.shipment.warehouseId !== null);
      expect(warehouse.length).toBeGreaterThan(0);
      expect(warehouse.every((b) => b.shipment.status === 'canceled')).toBe(true);
      const confirmed = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.status, 'confirmed'));
      const warehouseLineIds = new Set(warehouse.flatMap((b) => b.lines.map((line) => line.id)));
      expect(confirmed.filter((r) => r.shipmentLineId !== null && warehouseLineIds.has(r.shipmentLineId))).toEqual([]);
    });
  });

  it('되돌린 합포장 상자(주문 둘)에서 주문 1 만 취소 — 주문 2 라인 그대로, 행은 주문 1 라인만', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o1 = await seedSupplierCancellableOrder(tx, w, { supplierLines: [{ supplierKey: 'A', quantity: 2 }] });
      const o2 = await seedSupplierCancellableOrder(tx, w, {
        supplierLines: [{ supplierKey: 'A', quantity: 4 }],
        supplierIds: o1.supplierIds,
      });
      const b1 = await draftSupplierBoxOf(tx, o1.salesOrderId, o1.supplierIds.A);
      const b2 = await draftSupplierBoxOf(tx, o2.salesOrderId, o1.supplierIds.A);
      await markHandedOff(tx, b1.shipment.id, o1.supplierIds.A);
      await markHandedOff(tx, b2.shipment.id, o1.supplierIds.A);
      const merged = await mergeSupplierShipments(
        { invariant: new FulfillmentInvariantService(), reservations: w.logistics.shipmentReservations },
        tx,
        [b1.shipment.id, b2.shipment.id],
        { actorId: op },
        at,
      );
      await shipAndRecall(tx, merged, 'EP-MERGE-1');

      await w.salesOrders.cancel(o1.salesOrderId, admin, tx);

      expect(await cancelNoticesOf(tx, o1.salesOrderId)).toEqual([
        expect.objectContaining({ salesOrderId: o1.salesOrderId, salesOrderLineId: o1.lineIds[0], canceledQty: 2 }),
      ]);
      expect(await cancelNoticesOf(tx, o2.salesOrderId)).toEqual([]);
      const remaining = await draftSupplierBoxOf(tx, o2.salesOrderId, o1.supplierIds.A);
      expect(remaining.shipment.id).toBe(merged);
      expect(remaining.lines.map((line) => line.qty)).toEqual([4]);
    });
  });

  it('되돌린 단일 상자 취소 — 넘김 기록이 남아 행이 생긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedSupplierCancellableOrder(tx, w, { supplierLines: [{ supplierKey: 'A', quantity: 2 }] });
      const box = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
      await markHandedOff(tx, box.shipment.id, o.supplierIds.A);
      await shipAndRecall(tx, box.shipment.id, 'EP-ONE-1');

      await w.salesOrders.cancel(o.salesOrderId, admin, tx);

      expect(await cancelNoticesOf(tx, o.salesOrderId)).toEqual([expect.objectContaining({ canceledQty: 2 })]);
    });
  });

  it('발송된 입점사 라인 부분 취소 — 400(남은 미발송 수량 초과), 행 0, FOI canceled_qty 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedSupplierCancellableOrder(tx, w, { supplierLines: [{ supplierKey: 'A', quantity: 2 }] });
      const box = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
      await markHandedOff(tx, box.shipment.id, o.supplierIds.A);
      await shipSupplierShipment(dispatchDeps(tx), tx, {
        shipmentId: box.shipment.id,
        carrier: 'EPOST',
        trackingNo: 'EP-SENT-1',
        actorId: op,
        at,
      });

      await expect(
        tx.transaction((sp) =>
          w.salesOrders.cancel(
            o.salesOrderId,
            { lines: [{ salesOrderLineId: o.lineIds[0], quantity: 1 }], ...admin },
            sp as unknown as DbTx,
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(await cancelNoticesOf(tx, o.salesOrderId)).toEqual([]);
      const [foi] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, box.lines[0].fulfillmentOrderItemId));
      expect(foi.canceledQty).toBe(0);
    });
  });

  it('같은 Idempotency-Key 로 다시 온 부분 취소는 행을 늘리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedSupplierCancellableOrder(tx, w, { supplierLines: [{ supplierKey: 'A', quantity: 3 }] });
      const box = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
      await markHandedOff(tx, box.shipment.id, o.supplierIds.A);
      const options = {
        lines: [{ salesOrderLineId: o.lineIds[0], quantity: 1 }],
        ...admin,
        fulfillmentCommandContext: command(`key-${randomUUID()}`),
      };

      await w.salesOrders.cancel(o.salesOrderId, options, tx);
      await w.salesOrders.cancel(o.salesOrderId, options, tx);

      expect(await cancelNoticesOf(tx, o.salesOrderId)).toHaveLength(1);
      expect(await cancellationsOf(tx, o.salesOrderId)).toHaveLength(1);
    });
  });
});
