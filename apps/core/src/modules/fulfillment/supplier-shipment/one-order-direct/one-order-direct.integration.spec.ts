import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts/streams';
import { BadRequestError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import {
  remainingUnshippedQuantity,
  unshippedDemandPredicate,
} from '../../../inventory/stock-projection/services/unshipped-demand';
import { outboxPublisherFor } from '../../outbox/__support__/outbox-publisher.factory';
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
} from '../../services/__support__';
import { seedHandedOverOrder } from '../../services/__support__/sellmate-handed-over-fixtures';
import { FulfillmentCommandService } from '../../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { WaybillRepository } from '../../waybill/waybill.repository';
import { recallSupplierShipment } from '../supplier-recall';
import { SupplierTrackingInUseError } from '../supplier-shipment.errors';
import {
  DirectDeliveryChangedError,
  DirectDeliveryNotEligibleError,
  DirectDeliveryReturnNotEligibleError,
  DirectDeliverySellmateHandedOverError,
} from './one-order-direct.errors';
import { OneOrderDirectManager } from './one-order-direct.manager';
import { OneOrderDirectReader } from './one-order-direct.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('한 주문만 공급처 직배송 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let manager: OneOrderDirectManager;
  let reader: OneOrderDirectReader;
  const actor = { id: randomUUID(), roles: ['master'] };
  const takeoverReason = { reason: '', reasonCode: 'out_of_stock_supplier_ships' };
  const returnReason = { reason: '', reasonCode: 'supplier_cannot_ship' };

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    reader = new OneOrderDirectReader(dbService);
    manager = new OneOrderDirectManager(
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      new WaybillRepository(dbService),
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
      outboxPublisherFor(SHIPMENT_STREAM, dbService),
      outboxPublisherFor(FULFILLMENT_V2_STREAM, dbService),
      outboxPublisherFor(FULFILLMENT_STREAM, dbService),
      outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    );
  });

  afterAll(async () => {
    await client.end();
  });

  type World = { warehouseId: string; locationId: string; skuId: string; supplierId: string };
  type Box = { shipmentId: string; lineId: string; fulfillmentOrderId: string; salesOrderId: string };

  async function seedWorld(tx: DbTx, onHand: number): Promise<World> {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const [supplier] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `it-1532-${randomUUID().slice(0, 8)}` })
      .returning({ id: wmsTables.suppliers.id });
    await tx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId: supplier.id });
    const world = { warehouseId, locationId, skuId, supplierId: supplier.id };
    if (onHand > 0) await addStock(tx, world, onHand);
    return world;
  }

  async function addStock(tx: DbTx, world: World, qty: number) {
    const key = and(
      eq(wmsTables.stockLedgers.skuId, world.skuId),
      eq(wmsTables.stockLedgers.warehouseId, world.warehouseId),
      eq(wmsTables.stockLedgers.locationId, world.locationId),
      eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
    );
    const [existing] = await tx.select().from(wmsTables.stockLedgers).where(key);
    if (existing) {
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: existing.qty + qty })
        .where(key);
      return;
    }
    await tx.insert(wmsTables.stockLedgers).values({
      skuId: world.skuId,
      warehouseId: world.warehouseId,
      locationId: world.locationId,
      stockState: 'ON_HAND',
      qty,
    });
  }

  async function addOrder(tx: DbTx, world: World, qty: number, at: string): Promise<Box> {
    const variantId = randomUUID();
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: qty }] });
    // 발송 이벤트는 채널 주문 품목 id 가 있는 줄만 싣는다
    for (const lineId of lineIds) {
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: `item-${lineId.slice(0, 8)}` })
        .where(eq(wmsTables.salesOrderLines.id, lineId));
    }
    await tx
      .update(wmsTables.salesOrders)
      .set({ customerId: randomUUID(), customerEmail: 'it@example.com', customerName: '고객' })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await seedMatching(tx, { variantId, skuId: world.skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId: world.warehouseId }, tx);
    const [row] = await tx
      .select({
        lineId: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    await tx
      .update(wmsTables.shipmentLines)
      .set({ createdAt: new Date(at) })
      .where(eq(wmsTables.shipmentLines.id, row.lineId));
    await tx
      .update(wmsTables.stockReservations)
      .set({ requestedAt: new Date(at) })
      .where(eq(wmsTables.stockReservations.shipmentLineId, row.lineId));
    await tx
      .update(wmsTables.shipments)
      .set({
        recipientSnapshot: {
          recipientName: '받는분',
          phone: '010-0000-0000',
          postalCode: '00000',
          roadAddress: '서울 어딘가 1',
          detailAddress: '1층',
          deliveryNote: '문 앞',
        },
        entrancePassword: '#0000',
      })
      .where(eq(wmsTables.shipments.id, row.shipmentId));
    return { ...row, salesOrderId };
  }

  async function confirmed(tx: DbTx, shipmentId: string): Promise<number> {
    const rows = await tx
      .select({ qty: wmsTables.stockReservations.quantity })
      .from(wmsTables.stockReservations)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.stockReservations.shipmentLineId))
      .where(
        and(eq(wmsTables.shipmentLines.shipmentId, shipmentId), eq(wmsTables.stockReservations.status, 'confirmed')),
      );
    return rows.reduce((sum, row) => sum + row.qty, 0);
  }

  async function box(tx: DbTx, shipmentId: string) {
    const [row] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    return row;
  }

  async function version(tx: DbTx, shipmentId: string) {
    return (await box(tx, shipmentId)).manifestVersion;
  }

  async function takeover(
    tx: DbTx,
    world: World,
    target: Box,
    extra: { carrier?: 'CJ'; trackingNo?: string } = {},
    key = randomUUID(),
  ) {
    return manager.takeover(
      target.shipmentId,
      {
        ...takeoverReason,
        supplierId: world.supplierId,
        expectedManifestVersion: await version(tx, target.shipmentId),
        ...extra,
      },
      key,
      actor,
      tx,
    );
  }

  async function retryAll(tx: DbTx) {
    for (const candidate of await wired.retryWorker.findCandidates(50, tx)) {
      await wired.retryWorker.retryOne(candidate.id, tx);
    }
  }

  async function unshipped(tx: DbTx, foId: string): Promise<number> {
    const rows = await tx
      .select({ q: remainingUnshippedQuantity })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(and(eq(wmsTables.fulfillmentOrders.id, foId), unshippedDemandPredicate));
    return rows.reduce((sum, row) => sum + row.q, 0);
  }

  it('맡기면 잡은 재고를 놓고, 새 공급처 상자는 넘김 기록을 갖고, 옛 상자는 대체된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1);
      const target = await addOrder(tx, world, 3, '2026-11-01T00:00:00Z');
      expect(await confirmed(tx, target.shipmentId)).toBe(1);

      const result = await takeover(tx, world, target);

      expect(result.previousShipmentId).toBe(target.shipmentId);
      expect(result.releasedQty).toBe(1);
      expect(result.dispatched).toBe(false);
      expect((await box(tx, target.shipmentId)).status).toBe('superseded');
      const created = await box(tx, result.shipmentId);
      expect(created.supplierId).toBe(world.supplierId);
      expect(created.warehouseId).toBeNull();
      expect(created.status).toBe('draft');
      expect(created.supplierHandoffId).not.toBeNull();
      expect(created.entrancePassword).toBe('#0000');
      expect(await confirmed(tx, result.shipmentId)).toBe(0);
      expect(await confirmed(tx, target.shipmentId)).toBe(0);
      // 창고 미발송에서 빠진다
      expect(await unshipped(tx, target.fulfillmentOrderId)).toBe(0);
      const [op] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      expect(op.type).toBe('direct_delivery');
      expect(op.status).toBe('completed');
    });
  });

  it('맡긴 뒤 재고가 들어와도 그 상자에는 예약이 붙지 않고, 다음 창고 주문이 받는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 2, '2026-11-01T00:00:00Z');
      const later = await addOrder(tx, world, 2, '2026-11-02T00:00:00Z');
      const result = await takeover(tx, world, target);

      await addStock(tx, world, 2);
      await retryAll(tx);

      expect(await confirmed(tx, result.shipmentId)).toBe(0);
      expect(await confirmed(tx, later.shipmentId)).toBe(2);
    });
  });

  it('송장까지 넣으면 같은 트랜잭션에서 발송까지 끝나고, 같은 키로 다시 보내면 송장·발송이 한 번뿐이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      const key = randomUUID();
      const extra = { carrier: 'CJ' as const, trackingNo: '1234-5678-9012' };
      const expected = await version(tx, target.shipmentId);
      const send = () =>
        manager.takeover(
          target.shipmentId,
          { ...takeoverReason, supplierId: world.supplierId, expectedManifestVersion: expected, ...extra },
          key,
          actor,
          tx,
        );
      const first = await send();
      const again = await send();

      expect(again).toEqual(first);
      expect(first.dispatched).toBe(true);
      expect((await box(tx, first.shipmentId)).status).toBe('shipped');
      const waybills = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.shipmentId, first.shipmentId));
      expect(waybills.map((w) => w.trackingNo)).toEqual(['123456789012']);
      const attempts = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, first.shipmentId));
      expect(attempts).toHaveLength(1);
    });
  });

  it('배치에 담긴(작업 중) 상자·셀메이트로 넘긴 주문·바뀐 구성은 맡기지 않고 아무것도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const handedOver = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      await seedHandedOverOrder(tx, handedOver.salesOrderId);
      await expect(takeover(tx, world, handedOver)).rejects.toBeInstanceOf(DirectDeliverySellmateHandedOverError);
      expect((await box(tx, handedOver.shipmentId)).status).toBe('draft');

      const stale = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      await expect(
        manager.takeover(
          stale.shipmentId,
          {
            ...takeoverReason,
            supplierId: world.supplierId,
            expectedManifestVersion: (await version(tx, stale.shipmentId)) + 1,
          },
          randomUUID(),
          actor,
          tx,
        ),
      ).rejects.toBeInstanceOf(DirectDeliveryChangedError);
      expect((await box(tx, stale.shipmentId)).status).toBe('draft');

      const planned = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, planned.shipmentId));
      await expect(takeover(tx, world, planned)).rejects.toBeInstanceOf(DirectDeliveryNotEligibleError);
      const preview = await reader.preview(planned.shipmentId, tx);
      expect(preview.blockers.map((b) => b.code)).toContain('not_draft');
    });
  });

  it('이미 다른 상자에 쓴 송장번호면 맡기기째 되돌린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const first = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      const second = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      await takeover(tx, world, first, { carrier: 'CJ', trackingNo: '111122223333' });

      // 실제 요청은 명령 하나가 트랜잭션 하나다 — 여기서는 저장점으로 같은 모양을 만든다
      await expect(
        tx.transaction(async (sp) => {
          await takeover(sp as unknown as DbTx, world, second, { carrier: 'CJ', trackingNo: '1111-2222-3333' });
        }),
      ).rejects.toBeInstanceOf(SupplierTrackingInUseError);
      const kept = await box(tx, second.shipmentId);
      expect(kept.status).toBe('draft');
      expect(kept.warehouseId).toBe(world.warehouseId);
    });
  });

  it('창고로 되돌리면 원래 대기 순번에 서서 뒤에 온 주문보다 먼저 재고를 받는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 2, '2026-11-01T00:00:00Z');
      const taken = await takeover(tx, world, target);
      const later = await addOrder(tx, world, 2, '2026-11-05T00:00:00Z');

      const back = await manager.returnToWarehouse(
        taken.shipmentId,
        { ...returnReason, expectedManifestVersion: await version(tx, taken.shipmentId) },
        randomUUID(),
        actor,
        tx,
      );
      expect(back.wasHandedOff).toBe(true);
      const created = await box(tx, back.shipmentId);
      expect(created.warehouseId).toBe(world.warehouseId);
      expect(created.status).toBe('draft');
      expect((await box(tx, taken.shipmentId)).status).toBe('superseded');
      expect(await unshipped(tx, target.fulfillmentOrderId)).toBe(2);

      await addStock(tx, world, 2);
      await retryAll(tx);
      expect(await confirmed(tx, back.shipmentId)).toBe(2);
      expect(await confirmed(tx, later.shipmentId)).toBe(0);
    });
  });

  it('발송한 공급처 상자는 되돌리기 전에는 창고로 보낼 수 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      const taken = await takeover(tx, world, target, { carrier: 'CJ', trackingNo: '999988887777' });
      await expect(
        manager.returnToWarehouse(
          taken.shipmentId,
          { ...returnReason, expectedManifestVersion: await version(tx, taken.shipmentId) },
          randomUUID(),
          actor,
          tx,
        ),
      ).rejects.toBeInstanceOf(DirectDeliveryReturnNotEligibleError);
    });
  });

  it('송장을 잘못 넣어 발송을 되돌린 공급처 상자도 창고 출고로 되돌린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      const taken = await takeover(tx, world, target, { carrier: 'CJ', trackingNo: '343434343434' });
      const [attempt] = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, taken.shipmentId));
      const waybills = new WaybillRepository(makeDbService(db));
      await recallSupplierShipment(
        {
          shipments: outboxPublisherFor(SHIPMENT_STREAM, makeDbService(db)),
          fulfillmentsV2: outboxPublisherFor(FULFILLMENT_V2_STREAM, makeDbService(db)),
          invariant: new FulfillmentInvariantService(),
          voidUsedWaybill: async (id, trx) => {
            await waybills.casUsedToVoided(trx, id, new Date());
          },
        },
        tx,
        {
          shipmentId: taken.shipmentId,
          dispatchAttemptId: attempt.id,
          recallOperationId: randomUUID(),
          expectedManifestVersion: await version(tx, taken.shipmentId),
          actorId: actor.id,
          at: new Date(),
        },
      );
      expect((await box(tx, taken.shipmentId)).status).toBe('draft');

      const back = await manager.returnToWarehouse(
        taken.shipmentId,
        { reason: '', reasonCode: 'tracking_mistake', expectedManifestVersion: await version(tx, taken.shipmentId) },
        randomUUID(),
        actor,
        tx,
      );
      const created = await box(tx, back.shipmentId);
      expect(created.warehouseId).toBe(world.warehouseId);
      expect(created.status).toBe('draft');
      expect(await unshipped(tx, target.fulfillmentOrderId)).toBe(1);
    });
  });

  it('넘기지 않은 공급처 상자에 송장을 넣으면 넘김 기록을 남기고 발송한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      const taken = await takeover(tx, world, target);
      // 대기 상자처럼 만든다(넘김 전)
      await tx.execute(sql`UPDATE shipments SET supplier_handoff_id = NULL WHERE id = ${taken.shipmentId}`);

      const result = await manager.dispatch(
        taken.shipmentId,
        { carrier: 'CJ', trackingNo: '555566667777', expectedManifestVersion: await version(tx, taken.shipmentId) },
        randomUUID(),
        actor,
        tx,
      );
      expect(result.handedOffNow).toBe(true);
      const shipped = await box(tx, taken.shipmentId);
      expect(shipped.status).toBe('shipped');
      expect(shipped.supplierHandoffId).not.toBeNull();
    });
  });

  it('창을 연 뒤 상자가 바뀌었으면 송장을 넣지 않고, 빈 송장번호로는 맡기지도 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      await expect(takeover(tx, world, target, { carrier: 'CJ', trackingNo: ' - ' })).rejects.toBeInstanceOf(
        BadRequestError,
      );
      expect((await box(tx, target.shipmentId)).status).toBe('draft');

      const taken = await takeover(tx, world, target);
      await expect(
        manager.dispatch(
          taken.shipmentId,
          {
            carrier: 'CJ',
            trackingNo: '787878787878',
            expectedManifestVersion: (await version(tx, taken.shipmentId)) + 1,
          },
          randomUUID(),
          actor,
          tx,
        ),
      ).rejects.toBeInstanceOf(DirectDeliveryChangedError);
      expect((await box(tx, taken.shipmentId)).status).toBe('draft');
    });
  });

  it('창고로 못 돌리는 공급처 상자(직배 상품)라도 송장은 넣을 수 있다고 미리 보기가 가른다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      const taken = await takeover(tx, world, target);
      await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, world.skuId));
      const preview = await reader.preview(taken.shipmentId, tx);
      expect(preview.blockers.map((b) => b.code)).toContain('drop_shipped');
      expect(preview.dispatchBlockers).toEqual([]);
    });
  });

  it('송장 기다림 목록은 그 창고 주문의 넘긴 공급처 상자만 오래된 것부터 보인다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const handedAt = ['2026-11-04', '2026-11-01', '2026-11-03', '2026-11-02'];
      const taken: string[] = [];
      for (const day of handedAt) {
        const order = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
        const result = await takeover(tx, world, order);
        await tx
          .update(wmsTables.supplierHandoffs)
          .set({ createdAt: new Date(`${day}T00:00:00Z`) })
          .where(eq(wmsTables.supplierHandoffs.id, (await box(tx, result.shipmentId)).supplierHandoffId ?? ''));
        taken.push(result.shipmentId);
      }
      const shipped = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      await takeover(tx, world, shipped, { carrier: 'CJ', trackingNo: '121212121212' });

      const list = await reader.awaitingTracking(world.warehouseId, tx);
      expect(list.items.map((i) => i.shipmentId)).toEqual([taken[1], taken[3], taken[2], taken[0]]);
      const other = await seedWarehouseWithZone(tx);
      expect((await reader.awaitingTracking(other.warehouseId, tx)).items).toEqual([]);
    });
  });

  it('미리 보기는 상품에 연결된 공급처를 고르고 받는 분을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const target = await addOrder(tx, world, 1, '2026-11-01T00:00:00Z');
      const preview = await reader.preview(target.shipmentId, tx);
      expect(preview.owner).toBe('warehouse');
      expect(preview.suggestedSupplierId).toBe(world.supplierId);
      expect(preview.recipient?.name).toBe('받는분');
      expect(preview.blockers).toEqual([]);
      expect(preview.suppliers.map((s) => s.id)).toContain(world.supplierId);
      await tx.delete(wmsTables.skuSuppliers).where(inArray(wmsTables.skuSuppliers.skuId, [world.skuId]));
      expect((await reader.preview(target.shipmentId, tx)).suggestedSupplierId).toBeNull();
    });
  });
});
