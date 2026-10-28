import { createCheckpointsForTesting } from '@app/authorization';
import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
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
} from './__support__';
import { canonicalFulfillmentRequestHash, FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import * as op from '../order-progress/__support__/order-progress.fixtures';
import { assembleBoxWithdrawal } from './__support__/box-withdrawal-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const COMPLETE_RECIPIENT = {
  recipientName: 'Integration Tester',
  phone: '010-0000-0000',
  postalCode: '01234',
  roadAddress: 'Seoul test road 1',
  detailAddress: '101',
};

describeIfDb('ShipmentPlanningService (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let planning: ShipmentPlanningService;
  const actor = { id: randomUUID(), roles: ['master'] };

  function makePlanningService(dbService: ReturnType<typeof makeDbService>, logistics: Wired): ShipmentPlanningService {
    return new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      logistics.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
      assembleBoxWithdrawal(dbService),
      createCheckpointsForTesting(),
    );
  }

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    planning = makePlanningService(dbService, wired);
  });

  afterAll(async () => {
    await client.end();
  });

  async function physicalFixture(tx: DbTx, quantity: number, onHand: number) {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    if (onHand > 0) {
      await tx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId,
        locationId,
        stockState: 'ON_HAND',
        qty: onHand,
      });
    }
    const variantId = randomUUID();
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity }] });
    await tx
      .update(wmsTables.salesOrders)
      .set({ shippingAddress: COMPLETE_RECIPIENT })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
      .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
    const { matchingId } = await seedMatching(tx, { variantId, skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);
    const [item] = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .then((rows) => rows.map((row) => row.fulfillment_order_items));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, item.id));
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, line.shipmentId));
    return {
      warehouseId,
      locationId,
      holderId,
      skuId,
      matchingId,
      salesOrderId,
      salesOrderLineId: lineIds[0],
      item,
      line,
      shipment,
    };
  }

  async function seedActiveWorkItem(
    tx: DbTx,
    warehouseId: string,
    shipmentId: string,
    options: { waitingOperationId?: string } = {},
  ) {
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `planning-test-${randomUUID()}`,
        warehouseId,
        pickingMethod: 'individual',
      })
      .returning();
    const { waitingOperationId } = options;
    const [workItem] = await tx
      .insert(wmsTables.outboundBatchWorkItems)
      .values({ batchId: batch.id, shipmentId, waitingOperationId })
      .returning();
    return workItem;
  }

  async function seedWaybill(
    tx: DbTx,
    shipment: typeof wmsTables.shipments.$inferSelect,
    status: 'registered' | 'pending',
  ) {
    const [waybill] = await tx
      .insert(wmsTables.waybills)
      .values({
        shipmentId: shipment.id,
        // manual 송장은 registered·used·voided 만 허용된다(ck_waybills_manual_status) — 발급 중은 carrier 로 심는다.
        source: status === 'pending' ? 'carrier' : 'manual',
        carrier: 'HANJIN',
        status,
        trackingNo: `planning-tracking-${randomUUID()}`,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalFulfillmentRequestHash(shipment.recipientSnapshot),
      })
      .returning();
    return waybill;
  }

  /** 어느 배치에도 없는 planned 상자(전량 예약) — 송장은 status 로 심는다. */
  async function plannedFixture(tx: DbTx, quantity: number, waybillStatus: 'registered' | 'pending' = 'registered') {
    const fixture = await physicalFixture(tx, quantity, quantity);
    const [shipment] = await tx
      .update(wmsTables.shipments)
      .set({ status: 'planned', plannedAt: new Date() })
      .where(eq(wmsTables.shipments.id, fixture.shipment.id))
      .returning();
    const waybill = await seedWaybill(tx, shipment, waybillStatus);
    return { ...fixture, shipment, waybill };
  }

  function cancelDto(
    fixture: { shipment: { manifestVersion: number }; line: { id: string; lineVersion: number; qty: number } },
    qty = fixture.line.qty,
  ) {
    return {
      expectedManifestVersion: fixture.shipment.manifestVersion,
      reason: '고객 취소',
      lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty }],
    };
  }

  async function confirmedQty(tx: DbTx, lineId: string): Promise<number> {
    const rows = await tx
      .select()
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.shipmentLineId, lineId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function shipmentRow(tx: DbTx, shipmentId: string) {
    const [row] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    return row;
  }

  async function waybillRow(tx: DbTx, waybillId: string) {
    const [row] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, waybillId));
    return row;
  }

  it('splits 10 into 6/4 unreserved-first, replays, and rejects a changed request for the same key', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 10, 6);
      const key = `split-${randomUUID()}`;
      const request = {
        expectedManifestVersion: fixture.shipment.manifestVersion,
        reason: 'separate backorder',
        moves: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
      };

      const first = await planning.split(fixture.shipment.id, request, key, actor, tx);
      expect(first.source.lines).toEqual([expect.objectContaining({ id: fixture.line.id, qty: 6, reservedQty: 6 })]);
      expect(first.target.lines).toEqual([expect.objectContaining({ qty: 4, reservedQty: 0 })]);

      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      expect(item).toMatchObject({ qty: 10, canceledQty: 0 });
      expect((await planning.split(fixture.shipment.id, request, key, actor, tx)).target.shipmentId).toBe(
        first.target.shipmentId,
      );
      let mismatch: unknown;
      try {
        await planning.split(fixture.shipment.id, { ...request, reason: 'different request' }, key, actor, tx);
      } catch (error) {
        mismatch = error;
      }
      expect(mismatch).toBeInstanceOf(ConflictException);
      expect((mismatch as ConflictException).getResponse()).toMatchObject({
        code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH',
      });

      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, first.operationId));
      expect(operation.idempotencyKey).toBe(key);
    });
  });

  it('carries the entrance password onto the split target — a split box faces the same door', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 10, 6);
      await tx
        .update(wmsTables.shipments)
        .set({ entrancePassword: '#1234' })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));

      const result = await planning.split(
        fixture.shipment.id,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          reason: 'separate backorder',
          moves: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
        },
        `split-entrance-${randomUUID()}`,
        actor,
        tx,
      );

      const [target] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, result.target.shipmentId));
      // 안 물려주면 이 상자의 송장에만 현관 정보가 빠진 채 나가고 기사가 문을 못 연다.
      expect(target.entrancePassword).toBe('#1234');
    });
  });

  it('입점사 상자를 나누면 나눈 상자가 같은 입점사·같은 넘김 묶음을 물려받는다 (K3 PR5 N7)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await op.seedWorld(tx);
      const foA = await op.seedFo(tx, w, await op.seedOrder(tx), { qty: 2 });
      const foB = await op.seedFo(tx, w, await op.seedOrder(tx), { qty: 3 });
      const supplierId = await op.seedDirectSupplier(tx);
      const handoffId = await op.seedHandoff(tx, supplierId);
      const box = await op.seedBox(tx, w, [foA.foItemId, foB.foItemId], {
        status: 'draft',
        supplierId,
        supplierHandoffId: handoffId,
        qty: [2, 3],
      });
      const [source] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, box.lineIds[0]));

      // 입점사 상자는 줄째로만 나눈다 — 한 FOI 의 산 입점사 줄은 하나다(N3).
      const result = await planning.split(
        box.shipmentId,
        {
          expectedManifestVersion: source.manifestVersion,
          reason: 'supplier split',
          moves: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: line.qty }],
        },
        `split-supplier-${randomUUID()}`,
        actor,
        tx,
      );

      const [target] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, result.target.shipmentId));
      expect(target.supplierId).toBe(supplierId);
      expect(target.warehouseId).toBeNull();
      expect(target.supplierHandoffId).toBe(handoffId);
    });
  });

  it('입점사 상자의 줄을 일부 수량만 옮기면 409 SUPPLIER_SHIPMENT_PARTIAL_SPLIT — 한 FOI 에 산 입점사 줄이 둘이 되지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await op.seedWorld(tx);
      const fo = await op.seedFo(tx, w, await op.seedOrder(tx), { qty: 4 });
      const supplierId = await op.seedDirectSupplier(tx);
      const box = await op.seedBox(tx, w, [fo.foItemId], { status: 'draft', supplierId, qty: [4] });
      const [source] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, box.lineIds[0]));

      const error = await planning
        .split(
          box.shipmentId,
          {
            expectedManifestVersion: source.manifestVersion,
            reason: 'supplier split',
            moves: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: 2 }],
          },
          `split-supplier-partial-${randomUUID()}`,
          actor,
          tx,
        )
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(ConflictException);
      expect(((error as ConflictException).getResponse() as { code: string }).code).toBe(
        'SUPPLIER_SHIPMENT_PARTIAL_SPLIT',
      );
      const lines = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, fo.foItemId));
      expect(lines.map((row) => row.qty)).toEqual([4]);
    });
  });

  // K3 PR6 N4 — 넘긴 입점사 상자의 줄을 줄이는데 가리킬 판매주문 취소가 없으면 알릴 취소를 쓸 수 없다(fail-closed).
  it('handed-off supplier box canceled without origin throws and leaves the box untouched', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await op.seedWorld(tx);
      const fo = await op.seedFo(tx, w, await op.seedOrder(tx), { qty: 2 });
      const supplierId = await op.seedDirectSupplier(tx);
      const handoffId = await op.seedHandoff(tx, supplierId);
      const box = await op.seedBox(tx, w, [fo.foItemId], {
        status: 'draft',
        supplierId,
        supplierHandoffId: handoffId,
        qty: [2],
      });
      const source = await shipmentRow(tx, box.shipmentId);
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, box.lineIds[0]));

      const error = await tx
        .transaction((sp) =>
          planning.cancelOutstanding(
            box.shipmentId,
            cancelDto({ shipment: source, line }),
            `cancel-no-origin-${randomUUID()}`,
            actor,
            null,
            sp as unknown as DbTx,
          ),
        )
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(box.shipmentId);
      expect((await shipmentRow(tx, box.shipmentId)).status).toBe('draft');
      const [after] = await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, line.id));
      expect(after.qty).toBe(2);
    });
  });

  // K3 PR6 N4 — 입점사 상자는 배치·송장 손질이 생길 수 없다. 생겼다면 불변식이 깨진 것이라 대기·손질로 보내지 않는다.
  it('supplier box never needs settle steps — a work item on it throws instead of settling', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await op.seedWorld(tx);
      const fo = await op.seedFo(tx, w, await op.seedOrder(tx), { qty: 1 });
      const supplierId = await op.seedDirectSupplier(tx);
      const box = await op.seedBox(tx, w, [fo.foItemId], { status: 'draft', supplierId, qty: [1] });
      // 운영 경로로는 못 만든다(배치 진입 가드) — 불변식이 깨진 상태를 직접 심는다
      await op.seedWorkItem(tx, w, box.shipmentId, { status: 'queued' });
      const source = await shipmentRow(tx, box.shipmentId);
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, box.lineIds[0]));

      const error = await tx
        .transaction((sp) =>
          planning.cancelOutstanding(
            box.shipmentId,
            cancelDto({ shipment: source, line }),
            `cancel-supplier-steps-${randomUUID()}`,
            actor,
            { orderCancellationId: randomUUID(), scope: 'full' },
            sp as unknown as DbTx,
          ),
        )
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(box.shipmentId);
      expect((await shipmentRow(tx, box.shipmentId)).status).toBe('draft');
      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, box.shipmentId));
      expect(workItem.status).toBe('queued');
    });
  });

  it('leaves the cancellation tombstone without an entrance password', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 10, 6);
      await tx
        .update(wmsTables.shipments)
        .set({ entrancePassword: '#1234' })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const [second] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: fixture.shipment.id,
          fulfillmentOrderItemId: fixture.item.id,
          skuId: fixture.skuId,
          qty: 2,
        })
        .returning();

      await planning.cancelOutstanding(
        fixture.shipment.id,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          reason: 'cancel one line only',
          lines: [{ shipmentLineId: second.id, expectedLineVersion: second.lineVersion, qty: 2 }],
        },
        `cancel-entrance-${randomUUID()}`,
        actor,
        null,
        tx,
      );

      const [tombstone] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(
          and(eq(wmsTables.shipments.warehouseId, fixture.warehouseId), eq(wmsTables.shipments.status, 'canceled')),
        );
      // 묘비는 송장을 발행하지 않는다 — 비번을 실으면 배송 완료 파기가 못 닿는 사본만 는다.
      expect(tombstone?.entrancePassword ?? null).toBeNull();
    });
  });

  it('cancels an unreserved remainder before releasing confirmed reservations', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 10, 6);
      await planning.cancelOutstanding(
        fixture.shipment.id,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          reason: 'cancel backorder only',
          lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
        },
        `cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );

      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      const [reservation] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      expect(line).toMatchObject({ qty: 6, reservedQty: 6 });
      expect(reservation).toMatchObject({ quantity: 6, status: 'confirmed' });
      expect(item).toMatchObject({ qty: 10, canceledQty: 4, reservedQty: 6 });
    });
  });

  it('revises only the entrance password without touching the recipient snapshot or manifest version', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 3, 3);
      // 해외직구 주문은 sales-order AddressDto 의 personalCustomsCode 까지 스냅샷에
      // 실어 온다 (recipientSnapshot 은 salesOrder.shippingAddress 의 그대로 복사본).
      // fulfillment AddressDto 는 그 키를 모르므로, 비번만 고칠 때 스냅샷을 되보내면
      // whitelist 가 통관부호를 떨어뜨린다. 스냅샷 미전송이 그걸 막는 유일한 방법이다.
      const customsSnapshot = { ...COMPLETE_RECIPIENT, personalCustomsCode: 'P123456789' };
      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: customsSnapshot })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));

      await planning.reviseRecipient(
        fixture.shipment.id,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          entrancePassword: '#9999',
          reason: '고객 요청',
        },
        `entrance-password-${randomUUID()}`,
        actor,
        tx,
      );

      const [after] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      // 비번은 recipient_snapshot 밖의 크리덴셜이다. 스냅샷과 manifestVersion 은 합배송
      // 호환성·송장 멱등성(waybill.recipientHash)의 입력이므로 함께 움직이면 안 된다.
      expect(after.entrancePassword).toBe('#9999');
      expect(after.recipientSnapshot).toEqual(customsSnapshot);
      expect(after.manifestVersion).toBe(fixture.shipment.manifestVersion);
    });
  });

  it('bumps the manifest version when the recipient snapshot changes alongside the entrance password', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 3, 3);
      const moved = { ...COMPLETE_RECIPIENT, detailAddress: '202' };

      await planning.reviseRecipient(
        fixture.shipment.id,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          recipientSnapshot: moved,
          entrancePassword: '#9999',
          reason: '주소 정정',
        },
        `recipient-and-password-${randomUUID()}`,
        actor,
        tx,
      );

      const [after] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      expect(after.entrancePassword).toBe('#9999');
      expect(after.recipientSnapshot).toEqual(moved);
      expect(after.manifestVersion).toBe(fixture.shipment.manifestVersion + 1);
    });
  });

  // #1016 30번 이후 시작된 배치 밖 planned 상자는 그 자리에서 끝나므로, 대기는 «막힘»(여기선 발급 중인 송장)이 있을 때만 남는다.
  // 시작된 배치의 일부 취소 대기는 batch-cancel-withdraw.integration.spec 의 E11 이 지킨다.
  it('stores a durable cancellation intent when a Planned shipment must wait for its issuing waybill', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 3, 'pending');
      const workItem = await seedActiveWorkItem(tx, fixture.warehouseId, fixture.shipment.id);
      const key = `pending-cancel-${randomUUID()}`;
      const result = await planning.cancelOutstanding(
        fixture.shipment.id,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          reason: 'change plan first',
          lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 1 }],
        },
        key,
        actor,
        null,
        tx,
      );

      expect(result.operationStatus).toBe('pending');
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      const [member] = await tx
        .select()
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, result.operationId));
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const [waitingWorkItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id));
      expect(operation).toMatchObject({ status: 'pending', idempotencyKey: key });
      expect(operation.afterManifestSnapshot).toMatchObject({
        pendingIntent: {
          kind: 'cancel_outstanding',
          lines: [{ shipmentLineId: fixture.line.id, qty: 1 }],
        },
      });
      expect(member.afterManifestSnapshot).toEqual(operation.afterManifestSnapshot);
      expect(waitingWorkItem.waitingOperationId).toBe(result.operationId);
      expect(shipment).toMatchObject({ status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      expect(shipment.manifestVersion).toBe(fixture.shipment.manifestVersion);
    });
  });

  it('rejects replacing a work item waiting operation and rolls the new cancellation back', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 3, 3);
      const existingOperationId = randomUUID();
      await tx.insert(wmsTables.shipmentOperations).values({
        id: existingOperationId,
        type: 'consolidate',
        status: 'pending',
        operatorId: actor.id,
        reason: 'existing recovery prerequisite',
        idempotencyKey: `existing-wait-${randomUUID()}`,
        requestHash: '0'.repeat(64),
      });
      const workItem = await seedActiveWorkItem(tx, fixture.warehouseId, fixture.shipment.id, {
        waitingOperationId: existingOperationId,
      });
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const key = `conflicting-pending-cancel-${randomUUID()}`;

      let error: unknown;
      try {
        await tx.transaction((nestedTx) =>
          planning.cancelOutstanding(
            fixture.shipment.id,
            {
              expectedManifestVersion: fixture.shipment.manifestVersion,
              reason: 'must not replace existing recovery',
              lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 1 }],
            },
            key,
            actor,
            null,
            nestedTx as unknown as DbTx,
          ),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANCELLATION_WORK_ITEM_ALREADY_WAITING',
      });
      const [unchangedWorkItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id));
      const [unchangedShipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const [rolledBackCommand] = await tx
        .select({ id: wmsTables.fulfillmentCommandRequests.id })
        .from(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key));
      expect(unchangedWorkItem.waitingOperationId).toBe(existingOperationId);
      expect(unchangedShipment.status).toBe('planned');
      expect(rolledBackCommand).toBeUndefined();
    });
  });

  // #1016 30번 — 시작된 배치 밖 상자의 취소는 그 자리에서 끝난다(스펙 §4.1).
  it('cancels a planned shipment outside any batch immediately and voids its registered waybill', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 3);

      const result = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture),
        `immediate-planned-cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );

      expect(result.operationStatus).toBe('completed');
      expect(await shipmentRow(tx, fixture.shipment.id)).toMatchObject({ status: 'canceled', recoveryCode: null });
      expect((await waybillRow(tx, fixture.waybill.id)).status).toBe('voided');
      expect(await confirmedQty(tx, fixture.line.id)).toBe(0);
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      expect(operation.status).toBe('completed');
    });
  });

  it('partial cancel of a planned shipment returns it to draft', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 3);

      const result = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture, 1),
        `partial-planned-cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );

      expect(result.operationStatus).toBe('completed');
      expect(await shipmentRow(tx, fixture.shipment.id)).toMatchObject({
        status: 'draft',
        plannedAt: null,
        recoveryCode: null,
      });
      expect((await waybillRow(tx, fixture.waybill.id)).status).toBe('voided');
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      expect(line).toMatchObject({ qty: 2, reservedQty: 2 });
      expect(await confirmedQty(tx, fixture.line.id)).toBe(2);
    });
  });

  it('K2 특성: 배치 밖 planned 전량 취소는 manifest +2 (D2)', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 3);
      const before = await shipmentRow(tx, fixture.shipment.id);

      const result = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture),
        `k2-planned-cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );

      expect(result.operationStatus).toBe('completed');
      const after = await shipmentRow(tx, fixture.shipment.id);
      expect(after.status).toBe('canceled');
      expect(after.manifestVersion - before.manifestVersion).toBe(2);
    });
  });

  it('K2 특성: planned 일부 취소는 manifest +2 (D2), 안 건드린 줄 버전 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 3);
      // 줄이 하나뿐인 픽스처라 안 건드릴 둘째 줄을 같은 상자에 더한다.
      const [secondItem] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: fixture.item.fulfillmentOrderId,
          skuId: fixture.skuId,
          qty: 2,
          status: fixture.item.status,
        })
        .returning();
      const [untouched] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: fixture.shipment.id,
          fulfillmentOrderItemId: secondItem.id,
          skuId: fixture.skuId,
          qty: 2,
        })
        .returning();
      // planned 상자는 줄마다 확정 예약이 줄 수량만큼 있어야 한다 — 첫 줄의 예약을 본떠 둘째 줄에도 심는다.
      const [firstReservation] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
      await tx.insert(wmsTables.stockReservations).values({
        ...firstReservation,
        id: undefined,
        shipmentLineId: untouched.id,
        fulfillmentOrderItemId: secondItem.id,
        quantity: 2,
      });
      await tx
        .update(wmsTables.shipmentLines)
        .set({ reservedQty: 2 })
        .where(eq(wmsTables.shipmentLines.id, untouched.id));
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ reservedQty: 2 })
        .where(eq(wmsTables.fulfillmentOrderItems.id, secondItem.id));
      const before = await shipmentRow(tx, fixture.shipment.id);
      const untouchedBefore = (
        await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, untouched.id))
      )[0];

      const result = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture, 1),
        `k2-partial-planned-cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );

      expect(result.operationStatus).toBe('completed');
      const after = await shipmentRow(tx, fixture.shipment.id);
      expect(after.status).toBe('draft');
      expect(after.manifestVersion - before.manifestVersion).toBe(2);
      const [untouchedAfter] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, untouched.id));
      expect(untouchedAfter.lineVersion - untouchedBefore.lineVersion).toBe(0);
    });
  });

  it('voids a registered waybill on a draft box and cancels immediately', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 2, 2);
      const waybill = await seedWaybill(tx, fixture.shipment, 'registered');

      const result = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture),
        `draft-waybill-cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );

      expect(result.operationStatus).toBe('completed');
      expect((await shipmentRow(tx, fixture.shipment.id)).status).toBe('canceled');
      expect((await waybillRow(tx, waybill.id)).status).toBe('voided');
    });
  });

  it('keeps a planned shipment pending while its waybill is still being issued', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 2, 'pending');

      const result = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture),
        `issuing-waybill-cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );

      expect(result.operationStatus).toBe('pending');
      expect(await shipmentRow(tx, fixture.shipment.id)).toMatchObject({
        status: 'recovery_required',
        recoveryCode: 'CANCEL_REPLAN_PENDING',
      });
      expect((await waybillRow(tx, fixture.waybill.id)).status).toBe('pending');
      expect(await confirmedQty(tx, fixture.line.id)).toBe(2);
    });
  });

  it('replays an immediate planned cancellation without voiding twice', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 2);
      const key = `replay-planned-cancel-${randomUUID()}`;

      const first = await planning.cancelOutstanding(fixture.shipment.id, cancelDto(fixture), key, actor, null, tx);
      const second = await planning.cancelOutstanding(fixture.shipment.id, cancelDto(fixture), key, actor, null, tx);

      expect(first.operationStatus).toBe('completed');
      expect(second).toEqual(first);
      const voided = await tx
        .select()
        .from(wmsTables.waybills)
        .where(and(eq(wmsTables.waybills.shipmentId, fixture.shipment.id), eq(wmsTables.waybills.status, 'voided')));
      expect(voided).toHaveLength(1);
      const voidCommands = await tx
        .select()
        .from(wmsTables.fulfillmentCommandRequests)
        .where(
          eq(
            wmsTables.fulfillmentCommandRequests.idempotencyKey,
            `cancel-exit:${first.operationId}:${fixture.shipment.id}`,
          ),
        );
      expect(voidCommands).toHaveLength(1);
    });
  });

  it('requires SHIPMENT_REOPEN to cancel a planned shipment immediately', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 2);
      // makePlanningService 의 스코프 조회는 master 만 안다 — 다른 역할은 SHIPMENT_REOPEN 이 없다.
      const worker = { id: randomUUID(), roles: ['logistics_worker'] };

      let error: unknown;
      try {
        await tx.transaction((nestedTx) =>
          planning.cancelOutstanding(
            fixture.shipment.id,
            cancelDto(fixture),
            `unscoped-planned-cancel-${randomUUID()}`,
            worker,
            null,
            nestedTx as unknown as DbTx,
          ),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((await shipmentRow(tx, fixture.shipment.id)).status).toBe('planned');
      expect((await waybillRow(tx, fixture.waybill.id)).status).toBe('registered');
    });
  });

  // 스펙 §4.2 — 재개가 §4.1 의 «막힘 없음» 갈래와 같은 손질을 한다. 손으로 뺀 대기 상자가 송장 때문에 막히지 않는다.
  it('resume voids a registered waybill left by a manual unstarted-batch exclusion', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 2, 'pending');
      const workItem = await seedActiveWorkItem(tx, fixture.warehouseId, fixture.shipment.id);
      const pending = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture),
        `manual-exclusion-cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );
      expect(pending.operationStatus).toBe('pending');
      expect(
        (
          await tx
            .select()
            .from(wmsTables.outboundBatchWorkItems)
            .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id))
        )[0].waitingOperationId,
      ).toBe(pending.operationId);

      // 캐리어 접수가 끝나 송장이 registered 로 굳었고, 운영자가 작업 항목을 손으로 뺐다(옛 방식의 대기 → 빼기).
      await tx
        .update(wmsTables.waybills)
        .set({ status: 'registered' })
        .where(eq(wmsTables.waybills.id, fixture.waybill.id));
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'excluded', exclusionReason: '손으로 뺌' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id));

      const resumed = await planning.resumePendingCancellation(pending.operationId, tx);

      expect(resumed.operationStatus).toBe('completed');
      expect(await shipmentRow(tx, fixture.shipment.id)).toMatchObject({ status: 'canceled', recoveryCode: null });
      expect((await waybillRow(tx, fixture.waybill.id)).status).toBe('voided');
      expect(await confirmedQty(tx, fixture.line.id)).toBe(0);
    });
  });

  it('reports why a pending cancellation cannot resume and resumes it once the waybill settles', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 2, 'pending');
      const workItem = await seedActiveWorkItem(tx, fixture.warehouseId, fixture.shipment.id);
      const pending = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture),
        `readiness-cancel-${randomUUID()}`,
        actor,
        null,
        tx,
      );
      expect(pending.operationStatus).toBe('pending');

      expect(await planning.findPendingCancellationOperationId(fixture.shipment.id, tx)).toBe(pending.operationId);
      expect(await planning.cancellationResumeReadiness(pending.operationId, tx)).toEqual({
        operationId: pending.operationId,
        shipmentId: fixture.shipment.id,
        blockers: ['WAYBILL_NOT_VOIDABLE'],
      });
      expect(await planning.tryResumePendingCancellation(pending.operationId, tx)).toBe('blocked');
      expect((await waybillRow(tx, fixture.waybill.id)).status).toBe('pending');

      await tx
        .update(wmsTables.waybills)
        .set({ status: 'registered' })
        .where(eq(wmsTables.waybills.id, fixture.waybill.id));
      expect(await planning.cancellationResumeReadiness(pending.operationId, tx)).toMatchObject({ blockers: [] });

      expect(await planning.tryResumePendingCancellation(pending.operationId, tx)).toBe('completed');
      // 시작 전 배치의 작업 항목은 재개가 뺀다 — 이 취소를 기다리던 항목은 막힘이 아니다.
      expect(
        (
          await tx
            .select()
            .from(wmsTables.outboundBatchWorkItems)
            .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id))
        )[0],
      ).toMatchObject({ status: 'excluded', waitingOperationId: pending.operationId });
      expect(await shipmentRow(tx, fixture.shipment.id)).toMatchObject({ status: 'canceled', recoveryCode: null });
      expect((await waybillRow(tx, fixture.waybill.id)).status).toBe('voided');

      expect(await planning.tryResumePendingCancellation(pending.operationId, tx)).toBe('already_completed');
      expect(await planning.cancellationResumeReadiness(pending.operationId, tx)).toBeNull();
      expect(await planning.findPendingCancellationOperationId(fixture.shipment.id, tx)).toBeNull();
    });
  });

  // 스펙 §4.1: 시작 전 배치에서 빼는 검사는 빼기 직전에 그대로 부른다 — 재개도 즉시 취소처럼 그 코드로 409, 읽기는 막힘으로 적는다.
  it('resume rejects with the unstarted-batch exit blocker code and leaves the waiting box as it was', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx, 2, 'pending');
      const workItem = await seedActiveWorkItem(tx, fixture.warehouseId, fixture.shipment.id);
      const pending = await planning.cancelOutstanding(
        fixture.shipment.id,
        cancelDto(fixture),
        `exit-blocked-resume-${randomUUID()}`,
        actor,
        null,
        tx,
      );
      await tx
        .update(wmsTables.waybills)
        .set({ status: 'registered' })
        .where(eq(wmsTables.waybills.id, fixture.waybill.id));
      await tx.insert(wmsTables.dispatchAttempts).values({
        shipmentId: fixture.shipment.id,
        attemptNo: 1,
        idempotencyKey: `exit-blocked-dispatch-${randomUUID()}`,
        status: 'pending',
      });

      expect(await planning.cancellationResumeReadiness(pending.operationId, tx)).toMatchObject({
        blockers: ['WORK_ITEM_DISPATCH_EXISTS'],
      });
      const error = await tx
        .transaction((nestedTx) =>
          planning.tryResumePendingCancellation(pending.operationId, nestedTx as unknown as DbTx),
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'WORK_ITEM_DISPATCH_EXISTS' });
      expect(await shipmentRow(tx, fixture.shipment.id)).toMatchObject({
        status: 'recovery_required',
        recoveryCode: 'CANCEL_REPLAN_PENDING',
      });
      const [itemAfter] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id));
      expect(itemAfter).toMatchObject({ status: workItem.status, waitingOperationId: pending.operationId });
      expect((await waybillRow(tx, fixture.waybill.id)).status).toBe('registered');
    });
  });

  it('rejects dispatched shipment cancellation instead of mutating shipped quantity', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 2, 2);
      await wired.shipmentReservations.releasePartial(fixture.line.id, 2, 'dispatch fixture', tx);
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: 2 })
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));

      let error: unknown;
      try {
        await planning.cancelOutstanding(
          fixture.shipment.id,
          {
            expectedManifestVersion: fixture.shipment.manifestVersion,
            reason: 'invalid shipped cancel',
            lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 1 }],
          },
          `shipped-cancel-${randomUUID()}`,
          actor,
          null,
          tx,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_ALREADY_DISPATCHED' });
    });
  });

  it('rejects planning a mixed-profile shipment', async () => {
    await inRollbackTx(db, async (tx) => {
      const [profileA, profileB] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values([
          { name: `profile-a-${randomUUID()}`, sourceType: 'in_house' },
          { name: `profile-b-${randomUUID()}`, sourceType: 'in_house' },
        ])
        .returning();
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const firstSku = await seedSku(tx, holderId);
      const secondSku = await seedSku(tx, holderId);
      await tx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: profileA.id })
        .where(eq(wmsTables.skus.id, firstSku.skuId));
      await tx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: profileB.id })
        .where(eq(wmsTables.skus.id, secondSku.skuId));
      await tx.insert(wmsTables.stockLedgers).values([
        { skuId: firstSku.skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: 1 },
        { skuId: secondSku.skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: 1 },
      ]);
      const variants = [randomUUID(), randomUUID()];
      const { salesOrderId } = await seedSalesOrder(tx, {
        lines: variants.map((variantId) => ({ variantId, quantity: 1 })),
      });
      await tx
        .update(wmsTables.salesOrders)
        .set({ shippingAddress: COMPLETE_RECIPIENT })
        .where(eq(wmsTables.salesOrders.id, salesOrderId));
      await seedMatching(tx, { variantId: variants[0], skuId: firstSku.skuId });
      await seedMatching(tx, { variantId: variants[1], skuId: secondSku.skuId });
      await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.warehouseId, warehouseId));

      let error: unknown;
      try {
        await planning.plan(
          shipment.id,
          {
            shippingProfileId: profileA.id,
            expectedManifestVersion: shipment.manifestVersion,
            expectedReservationVersion: shipment.reservationVersion,
          },
          `plan-${randomUUID()}`,
          actor,
          tx,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_PROFILE_INCOMPATIBLE' });
    });
  });

  it('rejects incomplete profile execution configuration and plans after all fields are supplied', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 1, 1);
      const [profile] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({
          name: `incomplete-profile-${randomUUID()}`,
          sourceType: 'in_house',
          supportedFulfillmentModes: ['in_house'],
        })
        .returning();
      await tx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: profile.id })
        .where(eq(wmsTables.skus.id, fixture.skuId));

      let error: unknown;
      try {
        await planning.plan(
          fixture.shipment.id,
          {
            shippingProfileId: profile.id,
            expectedManifestVersion: fixture.shipment.manifestVersion,
            expectedReservationVersion: fixture.shipment.reservationVersion,
          },
          `plan-incomplete-${randomUUID()}`,
          actor,
          tx,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE',
      });

      await tx
        .update(wmsTables.deliveryProfiles)
        .set({
          senderSnapshot: { name: 'Sender' },
          originAddressSnapshot: { address: 'Origin' },
          returnAddressSnapshot: { address: 'Return' },
          carrierAccountRef: 'carrier-account-1',
        })
        .where(eq(wmsTables.deliveryProfiles.id, profile.id));
      const planned = await planning.plan(
        fixture.shipment.id,
        {
          shippingProfileId: profile.id,
          expectedManifestVersion: fixture.shipment.manifestVersion,
          expectedReservationVersion: fixture.shipment.reservationVersion,
        },
        `plan-complete-${randomUUID()}`,
        actor,
        tx,
      );
      expect(planned.shipment.status).toBe('planned');
    });
  });

  it('serializes a concurrent split and cancellation so exactly one stale command loses', async () => {
    const fixture = await db.transaction((tx) => physicalFixture(tx as unknown as DbTx, 10, 6));
    const splitKey = `concurrent-split-${randomUUID()}`;
    const cancelKey = `concurrent-cancel-${randomUUID()}`;
    const concurrentDb = makeDb(DATABASE_URL as string);
    const concurrentDbService = makeDbService(concurrentDb.db);
    const concurrentWired = wireLogistics(concurrentDbService, 'v2');
    const concurrentPlanning = makePlanningService(concurrentDbService, concurrentWired);

    try {
      const results = await Promise.allSettled([
        planning.split(
          fixture.shipment.id,
          {
            expectedManifestVersion: fixture.shipment.manifestVersion,
            reason: 'concurrent split',
            moves: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
          },
          splitKey,
          actor,
        ),
        concurrentPlanning.cancelOutstanding(
          fixture.shipment.id,
          {
            expectedManifestVersion: fixture.shipment.manifestVersion,
            reason: 'concurrent cancellation',
            lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
          },
          cancelKey,
          actor,
          null,
        ),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

      await db.transaction(async (tx) => {
        await new FulfillmentInvariantService().assertFulfillmentOrders(
          [fixture.item.fulfillmentOrderId],
          tx as unknown as DbTx,
        );
      });
      const [item] = await db
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      expect(item.qty).toBe(10);
      expect(item.canceledQty === 0 || item.canceledQty === 4).toBe(true);
    } finally {
      await concurrentDb.sql.end();
      await db.transaction(async (tx) => {
        const shipmentRows = await tx
          .select({ id: wmsTables.shipments.id })
          .from(wmsTables.shipments)
          .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
          .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, fixture.item.id));
        const shipmentIds = shipmentRows.map((row) => row.id);
        const operationRows = shipmentIds.length
          ? await tx
              .select({ id: wmsTables.shipmentOperationMembers.operationId })
              .from(wmsTables.shipmentOperationMembers)
              .where(inArray(wmsTables.shipmentOperationMembers.shipmentId, shipmentIds))
          : [];
        const operationIds = [...new Set(operationRows.map((row) => row.id))];
        await tx
          .delete(wmsTables.fulfillmentCommandRequests)
          .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, [splitKey, cancelKey]));
        if (operationIds.length) {
          await tx
            .delete(wmsTables.shipmentOperationMembers)
            .where(inArray(wmsTables.shipmentOperationMembers.operationId, operationIds));
          await tx.delete(wmsTables.shipmentOperations).where(inArray(wmsTables.shipmentOperations.id, operationIds));
        }
        if (shipmentIds.length) {
          const lineRows = await tx
            .select({ id: wmsTables.shipmentLines.id })
            .from(wmsTables.shipmentLines)
            .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
          const lineIds = lineRows.map((row) => row.id);
          if (lineIds.length) {
            await tx
              .delete(wmsTables.stockReservations)
              .where(inArray(wmsTables.stockReservations.shipmentLineId, lineIds));
            await tx.delete(wmsTables.shipmentLines).where(inArray(wmsTables.shipmentLines.id, lineIds));
          }
          await tx.delete(wmsTables.shipments).where(inArray(wmsTables.shipments.id, shipmentIds));
        }
        await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, fixture.salesOrderId));
        await tx
          .delete(wmsTables.productVariantSkuLinks)
          .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, fixture.matchingId));
        await tx.delete(wmsTables.productMatchings).where(eq(wmsTables.productMatchings.id, fixture.matchingId));
        await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, fixture.skuId));
        await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, fixture.skuId));
        await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holderId));
        await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, fixture.locationId));
        await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouseId));
      });
    }
  });
  describe('splitUnreserved', () => {
    /** 한 주문·한 상자에 라인 셋: L1 수량2 재고2, L2 수량3 재고2, L3 수량1 재고0 → 예약 2 / 2 / 0 */
    async function shortageBox(tx: DbTx, reservedPerLine: [number, number, number] = [2, 2, 0]) {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const quantities = [2, 3, 1];
      const skuIds: string[] = [];
      const variantIds: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const { skuId } = await seedSku(tx, holderId);
        skuIds.push(skuId);
        variantIds.push(randomUUID());
        if (reservedPerLine[i] > 0) {
          await tx.insert(wmsTables.stockLedgers).values({
            skuId,
            warehouseId,
            locationId,
            stockState: 'ON_HAND',
            qty: reservedPerLine[i],
          });
        }
      }
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: variantIds.map((variantId, i) => ({ variantId, quantity: quantities[i] })),
      });
      await tx
        .update(wmsTables.salesOrders)
        .set({ shippingAddress: COMPLETE_RECIPIENT })
        .where(eq(wmsTables.salesOrders.id, salesOrderId));
      for (const lineId of lineIds) {
        await tx
          .update(wmsTables.salesOrderLines)
          .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
          .where(eq(wmsTables.salesOrderLines.id, lineId));
      }
      for (let i = 0; i < 3; i += 1) await seedMatching(tx, { variantId: variantIds[i], skuId: skuIds[i] });
      await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);
      const lines = await tx
        .select({ line: wmsTables.shipmentLines })
        .from(wmsTables.shipmentLines)
        .where(inArray(wmsTables.shipmentLines.skuId, skuIds))
        .then((rows) => rows.map((row) => row.line));
      const bySku = (skuId: string) => {
        const found = lines.find((line) => line.skuId === skuId);
        if (!found) throw new Error(`no shipment line for sku ${skuId}`);
        return found;
      };
      const [l1, l2, l3] = skuIds.map(bySku);
      const shipment = await shipmentRow(tx, l1.shipmentId);
      return { warehouseId, locationId, skuIds, salesOrderId, shipment, l1, l2, l3 };
    }

    function qtyAndReserved(snapshot: { lines: Array<{ id: string; qty: number; reservedQty: number }> }) {
      return snapshot.lines.map((line) => [line.qty, line.reservedQty]);
    }

    function dtoOf(box: { shipment: { manifestVersion: number } }) {
      return { expectedManifestVersion: box.shipment.manifestVersion, reason: '고객 동의 — 있는 것 먼저' };
    }

    it('미예약 몫 전부를 새 draft 상자로 옮긴다 — 예약 0 라인은 통째로, 일부 예약 라인은 미예약 몫만', async () => {
      await inRollbackTx(db, async (tx) => {
        const box = await shortageBox(tx);
        expect(new Set([box.l1.shipmentId, box.l2.shipmentId, box.l3.shipmentId]).size).toBe(1);
        const result = await planning.splitUnreserved(
          box.shipment.id,
          dtoOf(box),
          `split-unreserved-${randomUUID()}`,
          actor,
          tx,
        );

        const byId = (snapshot: typeof result.source) => new Map(snapshot.lines.map((line) => [line.id, line]));
        const source = byId(result.source);
        expect(source.size).toBe(2);
        expect(source.get(box.l1.id)).toMatchObject({ qty: 2, reservedQty: 2 });
        expect(source.get(box.l2.id)).toMatchObject({ qty: 2, reservedQty: 2 });
        expect(qtyAndReserved(result.target).sort()).toEqual([
          [1, 0],
          [1, 0],
        ]);
        // 예약 0 라인은 통째 이동 — 라인 id 를 유지한다
        expect(byId(result.target).get(box.l3.id)).toMatchObject({ qty: 1, reservedQty: 0 });
        // 일부 예약 라인의 미예약 몫은 새 라인으로, 순번을 이어받는다
        const moved = result.target.lines.find((line) => line.id !== box.l3.id);
        expect(moved).toBeDefined();
        const [movedRow] = await tx
          .select()
          .from(wmsTables.shipmentLines)
          .where(eq(wmsTables.shipmentLines.id, (moved as { id: string }).id));
        expect(movedRow.createdFromLineId).toBe(box.l2.id);
        expect(movedRow.demandRequestedAt).not.toBeNull();

        expect(result.target.status).toBe('draft');
        const [operation] = await tx
          .select()
          .from(wmsTables.shipmentOperations)
          .where(eq(wmsTables.shipmentOperations.id, result.operationId));
        expect(operation.type).toBe('split');
      });
    });

    it('같은 키 재시도는 같은 결과, 새 키로 다시 누르면 SHIPMENT_FULLY_RESERVED', async () => {
      await inRollbackTx(db, async (tx) => {
        const box = await shortageBox(tx);
        const key = `split-unreserved-${randomUUID()}`;
        const first = await planning.splitUnreserved(box.shipment.id, dtoOf(box), key, actor, tx);
        const replay = await planning.splitUnreserved(box.shipment.id, dtoOf(box), key, actor, tx);
        expect(replay.target.shipmentId).toBe(first.target.shipmentId);
        expect(replay.operationId).toBe(first.operationId);

        const after = await shipmentRow(tx, box.shipment.id);
        let error: unknown;
        try {
          await planning.splitUnreserved(
            box.shipment.id,
            { expectedManifestVersion: after.manifestVersion, reason: '다시' },
            `split-unreserved-${randomUUID()}`,
            actor,
            tx,
          );
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_FULLY_RESERVED' });
      });
    });

    it('화면이 본 뒤 워커가 예약을 더 잡았으면 잠금 뒤 숫자로 옮긴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const box = await shortageBox(tx);
        // 화면이 본 뒤: L2 에 재고 1 이 들어와 예약 1 이 더 잡힌다 (예약 2 → 3, 미예약 1 → 0)
        await tx
          .update(wmsTables.stockLedgers)
          .set({ qty: 3 })
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, box.l2.skuId),
              eq(wmsTables.stockLedgers.warehouseId, box.warehouseId),
              eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
            ),
          );
        await wired.shipmentReservations.reservePartial(box.l2.id, 1, tx);
        expect(await confirmedQty(tx, box.l2.id)).toBe(3);

        const fresh = await shipmentRow(tx, box.shipment.id);
        const result = await planning.splitUnreserved(
          box.shipment.id,
          { expectedManifestVersion: fresh.manifestVersion, reason: '고객 동의 — 있는 것 먼저' },
          `split-unreserved-${randomUUID()}`,
          actor,
          tx,
        );
        expect(result.target.lines.map((line) => line.id)).toEqual([box.l3.id]);
        expect(result.source.lines.find((line) => line.id === box.l2.id)).toMatchObject({ qty: 3, reservedQty: 3 });
      });
    });

    it('전부 미예약 상자는 SHIPMENT_NOTHING_RESERVED, 새 상자를 만들지 않는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const box = await shortageBox(tx, [0, 0, 0]);
        const before = await tx
          .select({ id: wmsTables.shipments.id })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.warehouseId, box.warehouseId));
        let error: unknown;
        try {
          await planning.splitUnreserved(box.shipment.id, dtoOf(box), `split-unreserved-${randomUUID()}`, actor, tx);
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_NOTHING_RESERVED' });
        const after = await tx
          .select({ id: wmsTables.shipments.id })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.warehouseId, box.warehouseId));
        expect(after).toHaveLength(before.length);
      });
    });

    it('draft 인데 복구 코드가 있는 상자(재계획 대기)는 SHIPMENT_RECOVERY_IN_PROGRESS, 새 상자를 만들지 않는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const box = await shortageBox(tx);
        await tx
          .update(wmsTables.shipments)
          .set({ recoveryCode: 'CANCEL_REPLAN_PENDING' })
          .where(eq(wmsTables.shipments.id, box.shipment.id));
        const before = await tx
          .select({ id: wmsTables.shipments.id })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.warehouseId, box.warehouseId));
        let error: unknown;
        try {
          await planning.splitUnreserved(box.shipment.id, dtoOf(box), `split-unreserved-${randomUUID()}`, actor, tx);
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_RECOVERY_IN_PROGRESS' });
        const after = await tx
          .select({ id: wmsTables.shipments.id })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.warehouseId, box.warehouseId));
        expect(after).toHaveLength(before.length);
      });
    });

    it('다른 판매주문 라인이 든 상자는 SHIPMENT_CONSOLIDATED', async () => {
      await inRollbackTx(db, async (tx) => {
        const box = await shortageBox(tx);
        const other = await shortageBox(tx);
        await tx
          .update(wmsTables.shipmentLines)
          .set({ shipmentId: box.shipment.id })
          .where(eq(wmsTables.shipmentLines.id, other.l3.id));
        let error: unknown;
        try {
          await planning.splitUnreserved(box.shipment.id, dtoOf(box), `split-unreserved-${randomUUID()}`, actor, tx);
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_CONSOLIDATED' });
      });
    });

    it('planned 상자는 SHIPMENT_NOT_DRAFT', async () => {
      await inRollbackTx(db, async (tx) => {
        const box = await shortageBox(tx, [2, 3, 1]);
        await tx
          .update(wmsTables.shipments)
          .set({ status: 'planned', plannedAt: new Date() })
          .where(eq(wmsTables.shipments.id, box.shipment.id));
        let error: unknown;
        try {
          await planning.splitUnreserved(box.shipment.id, dtoOf(box), `split-unreserved-${randomUUID()}`, actor, tx);
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_NOT_DRAFT' });
      });
    });
  });
});
