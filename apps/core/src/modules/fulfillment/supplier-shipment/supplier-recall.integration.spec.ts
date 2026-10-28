import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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
import { FulfillmentReconciliationService } from '../services/fulfillment-reconciliation.service';
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
import { WaybillRepository } from '../waybill/waybill.repository';
import { shipSupplierShipment, SupplierDispatchDeps } from './supplier-dispatch';
import { recallSupplierShipment } from './supplier-recall';
import { mergeSupplierShipments } from './supplier-manifest';
import { ManifestEditDeps } from '../shipment/shipment-manifest-edit';
import { createCheckpointsForTesting } from '@app/authorization';
import { ShipmentRecallService } from '../services/shipment-recall.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { WaybillService } from '../waybill/waybill.service';
import { WaybillManager } from '../waybill/waybill.manager';
import { WaybillReader } from '../waybill/waybill.reader';
import { WaybillIssueMachine } from '../waybill/waybill-issue.machine';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { fakeCarrierGateway } from '../waybill/__support__/waybill-fixtures';
import type { HanjinConfig } from '../waybill/carrier/hanjin/hanjin.config';
import type { DbService } from '@app/db';
import { wmsSchema } from '../../inventory/schema/inventory.schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const RECIPIENT = {
  recipientName: '홍길동',
  phone: '010-1234-5678',
  postalCode: '06236',
  roadAddress: '서울 강남구 테헤란로 1',
  detailAddress: '101호',
};

/** K3 PR5 Task 7 — 입점사 상자 발송 되돌리기. 창고와 같은 명령(shipment.dispatch.recall), 원장·예약 갈래 없음. */
describeIfDb('입점사 상자 발송 되돌리기 (K3 PR5, PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let wired: Wired;
  let deps: SupplierDispatchDeps;
  let manifestDeps: ManifestEditDeps;
  const at = new Date('2026-10-25T03:00:00.000Z');
  const actor = { id: randomUUID(), roles: ['master'] };

  beforeAll(() => {
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService);
    manifestDeps = { invariant: new FulfillmentInvariantService(), reservations: wired.shipmentReservations };
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

  /** 롤백 트랜잭션 하나에 고정된 DbService — 서비스가 여는 트랜잭션이 곧 테스트 트랜잭션이다. */
  function recallServiceOver(tx: DbTx): ShipmentRecallService {
    const pinned = {
      db: tx,
      run: <T>(fn: (t: DbTx) => Promise<T>): Promise<T> => fn(tx),
    } as unknown as DbService<typeof wmsSchema>;
    const registry = new CarrierGatewayRegistry([fakeCarrierGateway()]);
    const repo = new WaybillRepository(pinned);
    const waybills = new WaybillService(
      new WaybillManager(
        new WaybillReader(pinned),
        repo,
        new WaybillIssueMachine(repo, registry, pinned),
        registry,
        new FulfillmentCommandService(pinned),
        {} as HanjinConfig,
        pinned,
      ),
    );
    return new ShipmentRecallService(
      pinned,
      new FulfillmentCommandService(pinned),
      waybills,
      {} as never, // inventory — 입점사 갈래는 부르지 않는다
      {
        lockShipmentGraphForDispatch: () => {
          throw new Error('warehouse-only lock must not run for supplier boxes');
        },
      } as never,
      outboxPublisherFor(SHIPMENT_STREAM, pinned),
      outboxPublisherFor(FULFILLMENT_V2_STREAM, pinned),
      new AuditService(pinned),
      { assertV2MutationAllowed: jest.fn() } as never,
      createCheckpointsForTesting(),
      new FulfillmentInvariantService(),
    );
  }

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

  async function world(tx: DbTx, opts: { mixed: boolean; supplierId?: string } = { mixed: true }) {
    const w = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const supplierId = opts.supplierId ?? (await seedDirectSupplier(tx));
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
      .selectDistinct({ id: wmsTables.shipments.id, supplierId: wmsTables.shipments.supplierId })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
    const box = boxes.find((row) => row.supplierId !== null);
    if (!box) throw new Error('expected a supplier box');
    const handoffId = await seedHandoff(tx, supplierId);
    await tx
      .update(wmsTables.shipments)
      .set({ supplierHandoffId: handoffId })
      .where(eq(wmsTables.shipments.id, box.id));
    return { supplierId, salesOrderId, foId: fo.id, supplierBox: box.id, dropSku, handoffId };
  }

  const ship = (tx: DbTx, shipmentId: string, trackingNo = 'EP-100-200') =>
    shipSupplierShipment(deps, tx, { shipmentId, carrier: 'EPOST', trackingNo, actorId: actor.id, at });
  const boxRow = async (tx: DbTx, id: string) =>
    (await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, id)))[0];
  const recallDto = async (tx: DbTx, shipmentId: string, dispatchAttemptId: string) => ({
    dispatchAttemptId,
    expectedManifestVersion: (await boxRow(tx, shipmentId)).manifestVersion,
    physicalRecoveryConfirmed: true as const,
    reason: 'dispatch_mistake' as const,
  });
  const payloadOf = (row: { payload: unknown }) => {
    const envelope = row.payload as { payload?: unknown };
    return envelope.payload ?? row.payload;
  };

  it('발송한 입점사 상자를 되돌리면 draft(넘김 그대로), 시도 recalled, 송장 voided, FOI·FO 원상, 이벤트 계약 통과, 원장 이벤트 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      const sent = await ship(tx, x.supplierBox);
      const [foSent] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, x.foId));
      expect(foSent.shippedAt).not.toBeNull();
      const service = recallServiceOver(tx);

      const response = await service.report(
        x.supplierBox,
        sent.attemptId,
        await recallDto(tx, x.supplierBox, sent.attemptId),
        `recall-${randomUUID()}`,
        actor,
      );

      expect(response).toMatchObject({
        shipmentId: x.supplierBox,
        dispatchAttemptId: sent.attemptId,
        operationStatus: 'completed',
      });
      const box = await boxRow(tx, x.supplierBox);
      expect(box).toMatchObject({
        status: 'draft',
        recoveryCode: null,
        shippedAt: null,
        supplierHandoffId: x.handoffId,
      });
      const [attempt] = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.id, sent.attemptId));
      expect(attempt).toMatchObject({
        status: 'recalled',
        recoveryCode: null,
        stockJournalId: null,
        reversalJournalId: null,
      });
      expect(attempt.recalledAt).not.toBeNull();
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, sent.waybillId));
      expect(waybill.status).toBe('voided');
      const [foi] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(
          and(
            eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, x.foId),
            eq(wmsTables.fulfillmentOrderItems.skuId, x.dropSku),
          ),
        );
      expect(foi.shippedQty).toBe(0);
      const [fo] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, x.foId));
      expect(fo.shippedAt).toBeNull();
      expect(fo.status).not.toBe('completed');

      const [op] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, response.operationId));
      expect(op).toMatchObject({ type: 'recall', status: 'completed' });
      const rows = await tx
        .select()
        .from(outbox_events)
        .where(inArray(outbox_events.aggregateId, [x.supplierBox, x.foId]));
      const recalled = rows.find((r) => r.eventType === 'ShipmentDispatchRecalled');
      const reopened = rows.find((r) => r.eventType === 'FulfillmentReopened');
      if (!recalled || !reopened) throw new Error('recall events missing');
      SHIPMENT_STREAM.events.ShipmentDispatchRecalled.schema!.parse(payloadOf(recalled));
      FULFILLMENT_V2_STREAM.events.FulfillmentReopened.schema!.parse(payloadOf(reopened));
      const ledger = await tx
        .select()
        .from(wmsTables.stockJournals)
        .where(eq(wmsTables.stockJournals.sourceId, response.operationId));
      expect(ledger).toHaveLength(0);
      await expect(new FulfillmentInvariantService().assertFulfillmentOrders([x.foId], tx)).resolves.toBeUndefined();
    });
  });

  it('섞인 FO 의 직배분을 되돌려도 FulfillmentReopened 가 나가고 FO 정합성 위반 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: true });
      const sent = await ship(tx, x.supplierBox);
      await recallServiceOver(tx).report(
        x.supplierBox,
        sent.attemptId,
        await recallDto(tx, x.supplierBox, sent.attemptId),
        `recall-${randomUUID()}`,
        actor,
      );
      expect((await boxRow(tx, x.supplierBox)).status).toBe('draft');
      const rows = await tx
        .select()
        .from(outbox_events)
        .where(inArray(outbox_events.aggregateId, [x.foId]));
      const reopened = rows.filter((r) => r.eventType === 'FulfillmentReopened');
      expect(reopened).toHaveLength(1);
      expect(FULFILLMENT_V2_STREAM.events.FulfillmentReopened.schema!.parse(payloadOf(reopened[0]))).toMatchObject({
        fulfillmentOrderId: x.foId,
        shippedQty: 0,
        outstandingQty: 5,
      });
      await expect(new FulfillmentInvariantService().assertFulfillmentOrders([x.foId], tx)).resolves.toBeUndefined();
    });
  });

  it('밤 대사(SQL 쌍둥이)는 발송 중·되돌린 입점사 시도를 위반으로 세지 않고, 원천이 붙은 입점사 시도만 센다', async () => {
    await inRollbackTx(db, async (tx) => {
      const kept = await world(tx, { mixed: false });
      const keptSent = await ship(tx, kept.supplierBox, 'EP-KEEP-1');
      const back = await world(tx, { mixed: false });
      const backSent = await ship(tx, back.supplierBox, 'EP-BACK-1');
      await recallServiceOver(tx).report(
        back.supplierBox,
        backSent.attemptId,
        await recallDto(tx, back.supplierBox, backSent.attemptId),
        `recall-${randomUUID()}`,
        actor,
      );
      const reconciliation = new FulfillmentReconciliationService(
        { run: (fn: (trx: DbTx) => Promise<unknown>) => fn(tx) } as never,
        {} as never,
      );
      const ours = new Set<string>([keptSent.attemptId, backSent.attemptId, kept.foId, back.foId]);
      const oursIn = (report: Awaited<ReturnType<FulfillmentReconciliationService['reconcile']>>) =>
        report.violations.filter((v) => ours.has(v.resourceId) || [...ours].some((id) => v.message.includes(id)));

      expect(oursIn(await reconciliation.reconcile(tx))).toEqual([]);

      // TS 판정기와 같은 규칙: 입점사 시도에 원천 줄이 붙으면 그것이 위반이다.
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, kept.supplierBox));
      const [location] = await tx.select({ id: wmsTables.locations.id }).from(wmsTables.locations).limit(1);
      await tx.insert(wmsTables.dispatchAttemptSources).values({
        dispatchAttemptId: keptSent.attemptId,
        shipmentLineId: line.id,
        sourceLocationId: location.id,
        qty: line.qty,
      });
      const drifted = await reconciliation.reconcile(tx);
      expect(drifted.resourceIds.DISPATCH_SOURCE_CARDINALITY).toContain(keptSent.attemptId);
      expect(drifted.resourceIds.DISPATCH_SOURCE_CARDINALITY).not.toContain(backSent.attemptId);
    });
  });

  it('같은 번호로 다시 발송하면 시도 2 로 성공한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      const first = await ship(tx, x.supplierBox, 'EP-100-200');
      await recallServiceOver(tx).report(
        x.supplierBox,
        first.attemptId,
        await recallDto(tx, x.supplierBox, first.attemptId),
        `recall-${randomUUID()}`,
        actor,
      );

      const second = await ship(tx, x.supplierBox, 'EP-100-200');

      expect(second.attemptNo).toBe(2);
      expect((await boxRow(tx, x.supplierBox)).status).toBe('shipped');
    });
  });

  it('합친 상자를 되돌리면 합친 상자 그대로 draft', async () => {
    await inRollbackTx(db, async (tx) => {
      const supplierId = await seedDirectSupplier(tx);
      const a = await world(tx, { mixed: false, supplierId });
      const b = await world(tx, { mixed: false, supplierId });
      for (const box of [a.supplierBox, b.supplierBox]) {
        await tx
          .update(wmsTables.shipments)
          .set({ recipientSnapshot: RECIPIENT })
          .where(eq(wmsTables.shipments.id, box));
      }
      const mergedId = await mergeSupplierShipments(manifestDeps, tx, [a.supplierBox, b.supplierBox]);
      const sent = await ship(tx, mergedId, 'MG-1');

      await recallServiceOver(tx).report(
        mergedId,
        sent.attemptId,
        await recallDto(tx, mergedId, sent.attemptId),
        `recall-${randomUUID()}`,
        actor,
      );

      expect((await boxRow(tx, mergedId)).status).toBe('draft');
      for (const foId of [a.foId, b.foId]) {
        await expect(new FulfillmentInvariantService().assertFulfillmentOrders([foId], tx)).resolves.toBeUndefined();
      }
    });
  });

  it('같은 멱등 키로 두 번 부르면 두 번째는 첫 결과를 돌려주고 일을 다시 하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      const sent = await ship(tx, x.supplierBox);
      const service = recallServiceOver(tx);
      const dto = await recallDto(tx, x.supplierBox, sent.attemptId);
      const key = `recall-${randomUUID()}`;

      const first = await service.report(x.supplierBox, sent.attemptId, dto, key, actor);
      const again = await service.report(x.supplierBox, sent.attemptId, dto, key, actor);

      expect(again).toEqual(first);
      const ops = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.idempotencyKey, key));
      expect(ops).toHaveLength(1);
    });
  });

  // savepoint: 실패한 호출이 남긴 쓰기를 되돌려 «아무것도 남지 않음»을 볼 수 있게 한다. drizzle 의 중첩 트랜잭션은
  // 부모와 같은 타입이지만 선언은 PgTransaction 이라 DbTx 로 한 번 좁힌다(런타임 동일).
  const inSavepoint = <T>(tx: DbTx, fn: (sp: DbTx) => Promise<T>): Promise<T> =>
    tx.transaction((sp) => fn(sp as unknown as DbTx));

  it('physicalRecoveryConfirmed 가 true 가 아니면 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      const sent = await ship(tx, x.supplierBox);
      const dto = await recallDto(tx, x.supplierBox, sent.attemptId);

      await expect(
        recallServiceOver(tx).report(
          x.supplierBox,
          sent.attemptId,
          // 검증 경로를 밟으려는 의도적 잘못된 입력 — DTO 타입은 true 리터럴만 허용한다
          { ...dto, physicalRecoveryConfirmed: false as never },
          'k-1',
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('어긋난 매니페스트 버전은 발송 상태 그대로 409 SHIPMENT_RECALL_STALE_MANIFEST, 이미 되돌린 상자는 409 SHIPMENT_RECALL_NOT_SHIPPED', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      const sent = await ship(tx, x.supplierBox);
      const dto = await recallDto(tx, x.supplierBox, sent.attemptId);
      const codeOf = async (promise: Promise<unknown>) => {
        const error = await promise.then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(ConflictException);
        return ((error as ConflictException).getResponse() as { code: string }).code;
      };

      expect(
        await codeOf(
          inSavepoint(tx, (sp) =>
            recallServiceOver(sp).report(
              x.supplierBox,
              sent.attemptId,
              { ...dto, expectedManifestVersion: dto.expectedManifestVersion + 1 },
              'k-stale',
              actor,
            ),
          ),
        ),
      ).toBe('SHIPMENT_RECALL_STALE_MANIFEST');
      expect((await boxRow(tx, x.supplierBox)).status).toBe('shipped');

      await recallServiceOver(tx).report(x.supplierBox, sent.attemptId, dto, 'k-ok', actor);
      const again = { ...dto, expectedManifestVersion: (await boxRow(tx, x.supplierBox)).manifestVersion };
      expect(
        await codeOf(
          inSavepoint(tx, (sp) => recallServiceOver(sp).report(x.supplierBox, sent.attemptId, again, 'k-again', actor)),
        ),
      ).toBe('SHIPMENT_RECALL_NOT_SHIPPED');
    });
  });

  it('작업 기록의 before 스냅샷은 창고와 같은 { shipment, attempt, intent } 모양이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      const sent = await ship(tx, x.supplierBox);
      const response = await recallServiceOver(tx).report(
        x.supplierBox,
        sent.attemptId,
        await recallDto(tx, x.supplierBox, sent.attemptId),
        'k-snap',
        actor,
      );
      const [op] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, response.operationId));
      expect(op.beforeManifestSnapshot).toMatchObject({
        shipment: { id: x.supplierBox, status: 'shipped' },
        attempt: { id: sent.attemptId, status: 'dispatched' },
        intent: { kind: 'shipment_recall', attemptNo: 1, shipmentId: x.supplierBox },
      });
    });
  });

  it('커밋 전 정합성 판정이 던지면 되돌리기가 통째로 물러난다(판정은 해당 FO 로 불린다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const x = await world(tx, { mixed: false });
      const sent = await ship(tx, x.supplierBox);
      const assertFulfillmentOrders = jest.fn().mockRejectedValue(new Error('invariant violated'));
      const expectedManifestVersion = (await boxRow(tx, x.supplierBox)).manifestVersion;

      await expect(
        inSavepoint(tx, (sp) =>
          recallSupplierShipment(
            {
              shipments: deps.shipments,
              fulfillmentsV2: deps.fulfillmentsV2,
              invariant: { assertFulfillmentOrders },
              voidUsedWaybill: async (id, trx) => {
                await deps.waybills.casUsedToVoided(trx, id, at);
              },
            },
            sp,
            {
              shipmentId: x.supplierBox,
              dispatchAttemptId: sent.attemptId,
              recallOperationId: randomUUID(),
              expectedManifestVersion,
              actorId: actor.id,
              at,
            },
          ),
        ),
      ).rejects.toThrow('invariant violated');

      expect(assertFulfillmentOrders).toHaveBeenCalledWith([x.foId], expect.anything());
      expect((await boxRow(tx, x.supplierBox)).status).toBe('shipped');
    });
  });
});
