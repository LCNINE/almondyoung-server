import { createCheckpointsForTesting } from '@app/authorization';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { assembleBoxWithdrawal } from '../services/__support__/box-withdrawal-wiring';
import { randomUUID } from 'crypto';
import { count, eq, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  consolidationBase,
  createConsolidationSource,
  inRollbackTx,
  makeDb,
  makeDbService,
  seedSalesOrder,
  wireLogistics,
  Wired,
} from '../services/__support__';
import { ConsolidationBoardReader } from '../services/consolidation-board.reader';
import { loadSplitShares } from '../services/consolidation-shipment-reads';
import { OutboundPreparationReader } from './outbound-preparation.reader';
import { loadShortPickReturns } from './short-pick-returns';
import { loadReturnedWorkItems } from './batch-returns';
import { seedHandedOverOrder } from '../services/__support__/sellmate-handed-over-fixtures';
import { OutboundPreparationSummaryDto } from '../dto/outbound-preparation.dto';

const idsIn = (summary: OutboundPreparationSummaryDto, bucket: string) =>
  summary.buckets.find((entry) => entry.bucket === bucket)?.shipments.map((shipment) => shipment.shipmentId) ?? [];

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('OutboundPreparationReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let reader: OutboundPreparationReader;
  let planning: ShipmentPlanningService;
  let dbService: ReturnType<typeof makeDbService>;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

    ({ sql: client, db } = makeDb(DATABASE_URL));
    dbService = makeDbService(db);

    wired = wireLogistics(dbService, 'v2');
    planning = new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      wired.workflowGate,
      assembleBoxWithdrawal(dbService),
      createCheckpointsForTesting(),
    );
    reader = new OutboundPreparationReader(dbService, new ConsolidationBoardReader(dbService));
  });

  afterAll(async () => {
    await client.end();
  });

  it('전체 대상 상자를 분류하고 다른 창고와 활성 작업을 제외한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = (quantity = 1, customerId = randomUUID()) =>
        createConsolidationSource(tx, wired, base, { quantity, customerId });
      const ready = [await source(), await source(3)];
      const partial = await source(3);
      const unavailable = await source();
      const customerId = randomUUID();
      const mergeable = [await source(1, customerId), await source(1, customerId)];
      const resume = await source();
      const active = await source();
      const needsInfo = await source();
      const otherBase = await consolidationBase(tx);
      const other = await createConsolidationSource(tx, wired, otherBase, {
        quantity: 1,
        customerId: randomUUID(),
      });
      const extraLine = await createConsolidationSource(tx, wired, otherBase, {
        quantity: 1,
        customerId: randomUUID(),
      });

      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: needsInfo.shipment.id })
        .where(eq(wmsTables.shipmentLines.id, extraLine.line.id));
      await tx
        .update(wmsTables.stockReservations)
        .set({ quantity: 1 })
        .where(eq(wmsTables.stockReservations.targetId, partial.line.id));
      await tx
        .update(wmsTables.stockReservations)
        .set({ status: 'pending' })
        .where(eq(wmsTables.stockReservations.targetId, unavailable.line.id));

      for (const fixture of [resume, active]) {
        await tx
          .update(wmsTables.shipments)
          .set({ status: 'planned' })
          .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      }

      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          warehouseId: base.warehouseId,
          batchNumber: `preparation-${randomUUID()}`,
          pickingMethod: 'individual',
          name: `preparation-${randomUUID()}`,
        })
        .returning();

      await tx.insert(wmsTables.outboundBatchWorkItems).values({
        batchId: batch.id,
        shipmentId: active.shipment.id,
        status: 'queued',
      });

      const [before] = await tx
        .select({ count: count() })
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'));

      for (let index = 0; index < 2; index++) {
        const order = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });

        await tx.insert(wmsTables.fulfillmentOrderCreationBacklogs).values({
          salesOrderId: order.salesOrderId,
          status: 'awaiting_matching',
        });
      }

      const summary = await reader.summarize(base.warehouseId, undefined, tx);

      expect(summary.warehouseId).toBe(base.warehouseId);
      expect(summary.buckets.map(({ bucket, count }) => [bucket, count])).toEqual([
        ['ready', 2],
        ['partial', 1],
        ['unavailable', 1],
        ['mergeable', 2],
        ['resume', 1],
        ['needs_info', 1],
      ]);
      expect(summary.awaitingMatchingCount - before.count).toBe(2);
      expect(summary.buckets.find(({ bucket }) => bucket === 'needs_info')?.shipments[0].reason).toBe(
        '배송 프로필이 상품마다 달라요',
      );
      expect(summary.buckets.find(({ bucket }) => bucket === 'ready')).toMatchObject({ singleCount: 2, multiCount: 0 });
      expect(summary.buckets.find(({ bucket }) => bucket === 'needs_info')).toMatchObject({
        singleCount: 0,
        multiCount: 1,
      });

      const ids = summary.buckets.flatMap(({ shipments }) => shipments.map(({ shipmentId }) => shipmentId));

      expect(ids.sort()).toEqual(
        [...ready, partial, unavailable, ...mergeable, resume, needsInfo].map(({ shipment }) => shipment.id).sort(),
      );
      expect(ids).not.toContain(active.shipment.id);
      expect(ids).not.toContain(other.shipment.id);
      expect(JSON.stringify(summary)).not.toContain('recipientSnapshot');

      const readyShipments = summary.buckets.find(({ bucket }) => bucket === 'ready')?.shipments;

      expect(readyShipments?.find(({ shipmentId }) => shipmentId === ready[1].shipment.id)).toMatchObject({
        totalQty: 3,
        single: true,
        reason: null,
      });
      expect(
        readyShipments?.every(({ orderNos, itemSummary }) => orderNos.length === 1 && itemSummary.length > 0),
      ).toBe(true);
    });
  });

  it('나눈 상자를 다시 나눠도 마지막 상자에서 처음 주문 수량과 순번을 읽는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 1);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 3, customerId: randomUUID() });
      const actor = { id: randomUUID(), roles: ['master'] };
      const first = await planning.splitUnreserved(
        source.shipment.id,
        { reason: '있는 것만 먼저 보내기', expectedManifestVersion: source.shipment.manifestVersion },
        randomUUID(),
        actor,
        tx,
      );
      const [waitingLine] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, first.target.shipmentId));
      const [waiting] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, first.target.shipmentId));

      expect(waitingLine.qty).toBeGreaterThanOrEqual(2);

      const second = await planning.split(
        waiting.id,
        {
          reason: '한 개 먼저',
          expectedManifestVersion: waiting.manifestVersion,
          moves: [{ shipmentLineId: waitingLine.id, expectedLineVersion: waitingLine.lineVersion, qty: 1 }],
        },
        randomUUID(),
        actor,
        tx,
      );

      const last = await loadSplitShares(tx, [second.target.shipmentId]);

      expect(last.get(second.target.shipmentId)).toEqual(
        expect.objectContaining({ boxQty: 1, orderQty: 3, boxCount: 3 }),
      );

      const all = await loadSplitShares(tx, [source.shipment.id, first.target.shipmentId, second.target.shipmentId]);

      expect([...all.values()].map((share) => share.boxNo).sort()).toEqual([1, 2, 3]);
    });
  });

  it('실제 분할 후 요약에서 원본을 완전출고로 읽고 계획을 확정한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 1);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 2, customerId: randomUUID() });
      const actor = { id: randomUUID(), roles: ['master'] };
      const beforeSplit = await reader.summarize(base.warehouseId, undefined, tx);

      expect(beforeSplit.buckets.find((bucket) => bucket.bucket === 'partial')?.shipments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            shipmentId: source.shipment.id,
            lines: [expect.objectContaining({ qty: 2, reservedQty: 1 })],
            split: null,
          }),
        ]),
      );

      const split = await planning.splitUnreserved(
        source.shipment.id,
        {
          reason: '있는 것만 먼저 보내기',
          expectedManifestVersion: source.shipment.manifestVersion,
        },
        randomUUID(),
        actor,
        tx,
      );

      expect(split.source.lines).toMatchObject([{ id: source.line.id, qty: 1, reservedQty: 1 }]);
      expect(split.target.lines).toMatchObject([{ qty: 1, reservedQty: 0 }]);

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const [original] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, source.shipment.id));

      expect(
        summary.buckets.find((bucket) => bucket.bucket === 'ready')?.shipments.map((shipment) => shipment.shipmentId),
      ).toContain(source.shipment.id);
      expect(summary.buckets.find((bucket) => bucket.bucket === 'mergeable')?.count).toBe(0);

      const shipmentsAfter = summary.buckets.flatMap((bucket) => bucket.shipments);

      // 한 트랜잭션 안에서 만든 상자는 만든 시각이 같아 번호 순서는 id 로 갈린다 — 번호가 겹치지 않는지만 본다.
      const pair = [source.shipment.id, split.target.shipmentId].map(
        (id) => shipmentsAfter.find((shipment) => shipment.shipmentId === id)?.split,
      );

      expect(pair).toEqual([
        expect.objectContaining({ boxQty: 1, orderQty: 2, boxCount: 2 }),
        expect.objectContaining({ boxQty: 1, orderQty: 2, boxCount: 2 }),
      ]);
      expect(pair.map((share) => share?.boxNo).sort()).toEqual([1, 2]);

      await tx
        .update(wmsTables.deliveryProfiles)
        .set({
          senderSnapshot: { name: 'Sender' },
          originAddressSnapshot: { address: 'Origin' },
          returnAddressSnapshot: { address: 'Return' },
          carrierAccountRef: 'carrier-account-1',
        })
        .where(eq(wmsTables.deliveryProfiles.id, base.profileId));

      await planning.plan(
        source.shipment.id,
        {
          shippingProfileId: base.profileId,
          expectedManifestVersion: original.manifestVersion,
          expectedReservationVersion: original.reservationVersion,
        },
        randomUUID(),
        actor,
        tx,
      );

      const [planned] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, source.shipment.id));

      expect(planned.status).toBe('planned');
    });
  });

  it('셀메이트 상자는 어느 분류에도 없고 합칠 상대도 되지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const customerId = randomUUID();
      const handed = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const app = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const planned = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });

      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, planned.shipment.id));

      const before = await reader.summarize(base.warehouseId, undefined, tx);

      expect(idsIn(before, 'mergeable')).toEqual(expect.arrayContaining([handed.shipment.id, app.shipment.id]));
      expect(before.buckets.flatMap((bucket) => bucket.shipments.map((s) => s.shipmentId))).toContain(
        planned.shipment.id,
      );

      await seedHandedOverOrder(tx, handed.salesOrderId);
      await seedHandedOverOrder(tx, planned.salesOrderId);

      const after = await reader.summarize(base.warehouseId, undefined, tx);
      const all = after.buckets.flatMap((bucket) => bucket.shipments.map((s) => s.shipmentId));

      expect(all).not.toContain(handed.shipment.id);
      expect(all).not.toContain(planned.shipment.id);
      expect(idsIn(after, 'ready')).toContain(app.shipment.id);

      const board = await new ConsolidationBoardReader(dbService).findBoard(base.warehouseId, tx);

      expect(board.groups.flatMap((group) => group.shipments.map((s) => s.shipmentId))).not.toContain(
        handed.shipment.id,
      );
    });
  });

  it('셀메이트 상자는 계획 확정을 409 로 거절하고 draft 로 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const actor = { id: randomUUID(), roles: ['master'] };

      await tx
        .update(wmsTables.deliveryProfiles)
        .set({
          senderSnapshot: { name: 'Sender' },
          originAddressSnapshot: { address: 'Origin' },
          returnAddressSnapshot: { address: 'Return' },
          carrierAccountRef: 'carrier-account-1',
        })
        .where(eq(wmsTables.deliveryProfiles.id, base.profileId));
      await seedHandedOverOrder(tx, source.salesOrderId);

      await expect(
        planning.plan(
          source.shipment.id,
          {
            shippingProfileId: base.profileId,
            expectedManifestVersion: source.shipment.manifestVersion,
            expectedReservationVersion: source.shipment.reservationVersion,
          },
          randomUUID(),
          actor,
          tx,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SHIPMENT_HANDED_OVER_TO_SELLMATE' }),
      });

      const [after] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, source.shipment.id));

      expect(after.status).toBe('draft');
    });
  });

  it('대상 상자가 없어도 빈 버킷 6개와 전 창고 매칭 대기 건수를 반환한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const [backlog] = await tx
        .select({ count: count() })
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'));
      const summary = await reader.summarize(randomUUID(), undefined, tx);

      expect(summary.buckets.map(({ bucket }) => bucket)).toEqual([
        'ready',
        'partial',
        'unavailable',
        'mergeable',
        'resume',
        'needs_info',
      ]);
      expect(
        summary.buckets.every(
          ({ count, singleCount, multiCount, shipments }) =>
            count === 0 && singleCount === 0 && multiCount === 0 && shipments.length === 0,
        ),
      ).toBe(true);
      expect(summary.awaitingMatchingCount).toBe(backlog.count);
    });
  });

  it('버킷 전체 건수를 유지하면서 생성 순으로 최대 200개만 반환한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const shipments = Array.from({ length: 201 }, (_, index) => ({
        id: randomUUID(),
        warehouseId: base.warehouseId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      }));

      await tx.insert(wmsTables.shipments).values([...shipments].reverse());

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const unavailable = summary.buckets.find(({ bucket }) => bucket === 'unavailable');

      expect(unavailable).toMatchObject({ count: 201, singleCount: 0, multiCount: 201 });
      expect(unavailable?.shipments.map(({ shipmentId }) => shipmentId)).toEqual(
        shipments.slice(0, 200).map(({ id }) => id),
      );
    });
  });

  it('상품 프로필 누락과 수령인 누락 사유를 구분한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });

      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: {} })
        .where(eq(wmsTables.shipments.id, source.shipment.id));

      const missingRecipient = await reader.summarize(base.warehouseId, undefined, tx);

      expect(missingRecipient.buckets.find(({ bucket }) => bucket === 'needs_info')?.shipments[0].reason).toBe(
        '수령인 정보가 비어 있어요',
      );

      await tx.update(wmsTables.skus).set({ deliveryProfileId: null }).where(eq(wmsTables.skus.id, base.skuId));

      const missingProfile = await reader.summarize(base.warehouseId, undefined, tx);

      expect(missingProfile.buckets.find(({ bucket }) => bucket === 'needs_info')?.shipments[0].reason).toBe(
        '배송 프로필이 없는 상품이 있어요',
      );
    });
  });

  it('쇼핑몰 품목 번호가 없는 상자는 정보 필요로 두고 사유를 보인다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });

      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: null })
        .where(eq(wmsTables.salesOrderLines.salesOrderId, source.salesOrderId));

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const needsInfo = summary.buckets.find(({ bucket }) => bucket === 'needs_info');

      expect(summary.buckets.find(({ bucket }) => bucket === 'ready')?.count).toBe(0);
      expect(needsInfo?.shipments.map(({ shipmentId, reason }) => [shipmentId, reason])).toEqual([
        [source.shipment.id, '쇼핑몰 품목 번호가 없거나 맞지 않아요'],
      ]);
    });
  });

  it('이어서 할 상자는 마지막 송장 기록의 실패 사유를 보인다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const make = () => createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const rejected = await make();
      const reissued = await make();
      const untouched = await make();

      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(inArray(wmsTables.shipments.id, [rejected.shipment.id, reissued.shipment.id, untouched.shipment.id]));

      const waybill = (
        fixture: typeof rejected,
        values: { status: 'failed' | 'pending'; lastError: string | null; createdAt: Date },
      ) =>
        tx.insert(wmsTables.waybills).values({
          shipmentId: fixture.shipment.id,
          source: 'carrier',
          carrier: 'HANJIN',
          manifestVersion: fixture.shipment.manifestVersion,
          recipientHash: 'h'.repeat(64),
          ...values,
        });

      await waybill(rejected, {
        status: 'failed',
        lastError: 'allocate ERROR-01',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      await waybill(reissued, {
        status: 'failed',
        lastError: 'allocate ERROR-01',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      await waybill(reissued, { status: 'pending', lastError: null, createdAt: new Date('2026-01-01T00:01:00Z') });

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const reasons = new Map(
        summary.buckets
          .find(({ bucket }) => bucket === 'resume')
          ?.shipments.map(({ shipmentId, reason }) => [shipmentId, reason]),
      );

      expect(reasons).toEqual(
        new Map([
          [rejected.shipment.id, '운송사가 송장 번호를 주지 않았어요 (ERROR-01) — 상자 화면에서 확인해요'],
          [reissued.shipment.id, '운송사 응답을 확인하지 못했어요 — 상자 화면에서 송장 상태를 확인해요'],
          [untouched.shipment.id, null],
        ]),
      );
    });
  });

  it('결품으로 배치에서 빠진 상자를 분류 맨 앞에 모으고 상품·자리·모자란 수량을 사유로 준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = () => createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const plain = await source();
      const exited = await source();
      const refilled = await source();
      const rebatched = await source();
      const otherExit = await source();
      const [location] = await tx
        .select({ id: wmsTables.locations.id, code: wmsTables.locations.code })
        .from(wmsTables.locations)
        .where(eq(wmsTables.locations.warehouseId, base.warehouseId))
        .limit(1);
      const [sku] = await tx
        .select({ name: wmsTables.skus.name })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, base.skuId));
      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          warehouseId: base.warehouseId,
          batchNumber: `short-pick-${randomUUID()}`,
          pickingMethod: 'individual',
          name: `short-pick-${randomUUID()}`,
        })
        .returning();
      const leave = async (shipmentId: string, exclusionReason: string) => {
        const [item] = await tx
          .insert(wmsTables.outboundBatchWorkItems)
          .values({ batchId: batch.id, shipmentId, status: 'excluded', exitTo: 'draft', exclusionReason })
          .returning();

        return item.id;
      };
      const shortPick = async (shipmentId: string, lineId: string, workItemId: string, outcome: string) => {
        const id = randomUUID();

        await tx.insert(wmsTables.shipmentOperations).values({
          id,
          type: 'short_pick',
          status: 'completed',
          operatorId: randomUUID(),
          reason: 'inventory_shortage',
          idempotencyKey: randomUUID(),
          requestHash: 'a'.repeat(64),
          beforeManifestSnapshot: {
            intent: {
              kind: 'short_pick',
              operationId: id,
              shipmentId,
              workItemId,
              sessionId: randomUUID(),
              actorId: randomUUID(),
              reason: 'inventory_shortage',
              lines: [{ shipmentLineId: lineId, sourceLocationId: location.id, shortQty: 1, allocationQty: 1 }],
            },
          },
          afterManifestSnapshot: { outcome },
          completedAt: new Date(),
        });
        await tx.insert(wmsTables.shipmentOperationMembers).values({ operationId: id, shipmentId, role: 'source' });
      };

      await shortPick(
        exited.shipment.id,
        exited.line.id,
        await leave(exited.shipment.id, 'short_pick:inventory_shortage'),
        'exited',
      );
      await shortPick(
        refilled.shipment.id,
        refilled.line.id,
        await leave(refilled.shipment.id, '잘못 넣은 상자'),
        'refilled',
      );
      await shortPick(
        rebatched.shipment.id,
        rebatched.line.id,
        await leave(rebatched.shipment.id, 'short_pick:inventory_shortage'),
        'exited',
      );
      await tx.insert(wmsTables.outboundBatchWorkItems).values({
        batchId: batch.id,
        shipmentId: rebatched.shipment.id,
        status: 'excluded',
        exitTo: 'draft',
        exclusionReason: '잘못 넣은 상자',
        createdAt: new Date(Date.now() + 60_000),
      });
      await leave(otherExit.shipment.id, 'station_withdraw_command');

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const ready = summary.buckets.find((entry) => entry.bucket === 'ready');

      expect(ready?.count).toBe(5);
      expect(ready?.shortPickCount).toBe(1);
      expect(ready?.shipments[0]).toMatchObject({
        shipmentId: exited.shipment.id,
        reason: null,
        shortPick: [{ name: sku.name, locationCode: location.code, shortQty: 1 }],
      });
      expect(
        ready?.shipments
          .filter((shipment) => shipment.shipmentId !== exited.shipment.id)
          .map((shipment) => shipment.shortPick),
      ).toEqual([null, null, null, null]);
      await tx.insert(wmsTables.outboundBatchWorkItems).values({
        batchId: batch.id,
        shipmentId: exited.shipment.id,
        status: 'queued',
        createdAt: new Date(Date.now() - 60_000),
      });
      expect(await loadShortPickReturns(tx, await loadReturnedWorkItems(tx, [exited.shipment.id]))).toEqual(new Map());
      expect(ready?.batchReturnCount).toBe(3);
      expect(idsIn(summary, 'ready').slice(1, 4).sort()).toEqual(
        [refilled, rebatched, otherExit].map((fixture) => fixture.shipment.id).sort(),
      );
      expect(idsIn(summary, 'ready')[4]).toBe(plain.shipment.id);
      expect(ready?.shipments.find((shipment) => shipment.shipmentId === otherExit.shipment.id)?.batchReturn).toEqual({
        batchNumber: batch.batchNumber,
        exitedAt: expect.any(String),
        place: '물류앱 출고 검수',
        reason: '박스 빼기',
        needsNewWaybill: true,
      });
      expect(
        ready?.shipments.find((shipment) => shipment.shipmentId === rebatched.shipment.id)?.batchReturn,
      ).toMatchObject({ place: '관리자 출고 배치', reason: '잘못 넣은 상자' });
      expect(ready?.shipments.find((shipment) => shipment.shipmentId === plain.shipment.id)?.batchReturn).toBeNull();
    });
  });

  it('배치에서 빠져 돌아온 이어서 할 상자는 뺀 곳·사유와 새 송장이 필요한지를 준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const make = () => createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const voided = await make();
      const kept = await make();
      const typed = await make();
      const rejoined = await make();
      const failed = await make();
      const fixtures = [voided, kept, typed, rejoined, failed];

      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(
          inArray(
            wmsTables.shipments.id,
            fixtures.map((fixture) => fixture.shipment.id),
          ),
        );

      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          warehouseId: base.warehouseId,
          batchNumber: `returned-${randomUUID()}`,
          pickingMethod: 'individual',
          name: `returned-${randomUUID()}`,
        })
        .returning();
      const leave = (fixture: typeof voided, exclusionReason: string) =>
        tx
          .insert(wmsTables.outboundBatchWorkItems)
          .values({ batchId: batch.id, shipmentId: fixture.shipment.id, status: 'excluded', exclusionReason });
      const waybill = (fixture: typeof voided, status: 'voided' | 'registered' | 'failed') =>
        tx.insert(wmsTables.waybills).values({
          shipmentId: fixture.shipment.id,
          source: 'carrier',
          carrier: 'HANJIN',
          manifestVersion: fixture.shipment.manifestVersion,
          recipientHash: 'h'.repeat(64),
          status,
          trackingNo: status === 'registered' ? randomUUID().slice(0, 12) : null,
          lastError: status === 'failed' ? 'allocate ERROR-01' : null,
        });

      await leave(voided, '작업 시작 전 뺌 — 송장 미발급·재발급 필요');
      await waybill(voided, 'voided');
      await leave(kept, '잘못 넣은 상자');
      await waybill(kept, 'registered');
      await leave(typed, '고객 요청으로 보류');
      await waybill(typed, 'registered');
      await leave(failed, '잘못 넣은 상자');
      await waybill(failed, 'failed');
      await leave(rejoined, '잘못 넣은 상자');
      await tx
        .insert(wmsTables.outboundBatchWorkItems)
        .values({ batchId: batch.id, shipmentId: rejoined.shipment.id, status: 'queued' });

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const resume = summary.buckets.find(({ bucket }) => bucket === 'resume');
      const returns = new Map(resume?.shipments.map(({ shipmentId, batchReturn }) => [shipmentId, batchReturn]));

      expect(resume?.batchReturnCount).toBe(4);
      expect(returns.get(voided.shipment.id)).toMatchObject({
        batchNumber: batch.batchNumber,
        place: '물류앱 작업 시작',
        reason: '송장 미발급·재발급 필요',
        needsNewWaybill: true,
      });
      expect(returns.get(kept.shipment.id)).toMatchObject({
        place: '관리자 출고 배치',
        reason: '잘못 넣은 상자',
        needsNewWaybill: false,
      });
      expect(returns.get(typed.shipment.id)).toMatchObject({ place: null, reason: '고객 요청으로 보류' });
      expect(returns.get(failed.shipment.id)).toMatchObject({ needsNewWaybill: true });
      expect(await loadReturnedWorkItems(tx, [rejoined.shipment.id])).toEqual(new Map());
    });
  });
});
