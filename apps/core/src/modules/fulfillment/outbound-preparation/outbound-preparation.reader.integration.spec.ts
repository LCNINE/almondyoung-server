import { createCheckpointsForTesting } from '@app/authorization';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { assembleBoxWithdrawal } from '../services/__support__/box-withdrawal-wiring';
import { randomUUID } from 'crypto';
import { and, count, eq, inArray, not, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  CONSOLIDATION_RECIPIENT,
  consolidationBase,
  createConsolidationSource,
  inRollbackTx,
  makeDb,
  makeDbService,
  seedSalesOrder,
  seedWarehouseWithZone,
  wireLogistics,
  Wired,
} from '../services/__support__';
import { ConsolidationBoardReader } from '../services/consolidation-board.reader';
import { loadSplitShares } from '../services/consolidation-shipment-reads';
import { OutboundPreparationReader } from './outbound-preparation.reader';
import { InboundPipelineReader } from '../../inventory/stock-projection/services/inbound-pipeline.reader';
import { WarehouseTransferReader } from '../../inventory/warehouse-transfer/services/warehouse-transfer.reader';
import { PurchaseOrderExpectedArrivalReader } from '../../inventory/procurement/services/purchase-order-expected-arrival.reader';
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
    reader = new OutboundPreparationReader(
      dbService,
      new ConsolidationBoardReader(dbService),
      new InboundPipelineReader(
        dbService,
        new WarehouseTransferReader(dbService),
        new PurchaseOrderExpectedArrivalReader(dbService),
      ),
    );
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

      const counts = await reader.countBuckets(base.warehouseId, tx);

      expect(counts).toEqual({
        warehouseId: base.warehouseId,
        buckets: summary.buckets.map(({ bucket, count }) => ({ bucket, count })),
      });
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

  it.each([
    ['does_not_fit', '한 상자에 다 들어가지 않음', 'ready'],
    ['other', '선물 포장 따로', 'mergeable'],
  ])('%s 사유로 나눈 두 상자는 %s 로 사유를 싣고 %s 로 간다', async (reasonCode, reason, bucket) => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 2);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 2, customerId: randomUUID() });
      const actor = { id: randomUUID(), roles: ['master'] };
      const split = await planning.split(
        source.shipment.id,
        {
          reason,
          reasonCode,
          expectedManifestVersion: source.shipment.manifestVersion,
          moves: [{ shipmentLineId: source.line.id, expectedLineVersion: source.line.lineVersion, qty: 1 }],
        },
        randomUUID(),
        actor,
        tx,
      );
      const pair = [source.shipment.id, split.target.shipmentId];
      const summary = await reader.summarize(base.warehouseId, undefined, tx);

      expect(idsIn(summary, bucket)).toEqual(expect.arrayContaining(pair));
      expect(
        summary.buckets
          .flatMap((entry) => entry.shipments)
          .filter((shipment) => pair.includes(shipment.shipmentId))
          .map((shipment) => shipment.split?.reason),
      ).toEqual([reason, reason]);

      const board = await new ConsolidationBoardReader(dbService).findBoard(base.warehouseId, tx);
      const grouped = board.groups.some((group) =>
        group.shipments.some((shipment) => pair.includes(shipment.shipmentId)),
      );

      expect(grouped).toBe(bucket === 'mergeable');
    });
  });

  it('크기로 나눈 짝만 보낼 수 있으면 다른 주문 상자가 묶음에 있어도 합칠 주문으로 보지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 2);
      const customerId = randomUUID();
      const source = await createConsolidationSource(tx, wired, base, { quantity: 2, customerId });
      const waiting = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const split = await planning.split(
        source.shipment.id,
        {
          reason: '한 상자에 다 들어가지 않음',
          reasonCode: 'does_not_fit',
          expectedManifestVersion: source.shipment.manifestVersion,
          moves: [{ shipmentLineId: source.line.id, expectedLineVersion: source.line.lineVersion, qty: 1 }],
        },
        randomUUID(),
        { id: randomUUID(), roles: ['master'] },
        tx,
      );
      const summary = await reader.summarize(base.warehouseId, undefined, tx);

      expect(idsIn(summary, 'unavailable')).toContain(waiting.shipment.id);
      expect(idsIn(summary, 'ready')).toEqual(expect.arrayContaining([source.shipment.id, split.target.shipmentId]));
    });
  });

  it('크기로 나눈 한쪽을 다른 이유로 다시 나누면 그 둘만 합칠 주문으로 가고 반대쪽은 완전출고다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 4);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 4, customerId: randomUUID() });
      const actor = { id: randomUUID(), roles: ['master'] };
      const bySize = await planning.split(
        source.shipment.id,
        {
          reason: '한 상자에 다 들어가지 않음',
          reasonCode: 'does_not_fit',
          expectedManifestVersion: source.shipment.manifestVersion,
          moves: [{ shipmentLineId: source.line.id, expectedLineVersion: source.line.lineVersion, qty: 2 }],
        },
        randomUUID(),
        actor,
        tx,
      );
      const [half] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, bySize.target.shipmentId));
      const [halfBox] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, bySize.target.shipmentId));
      const again = await planning.split(
        halfBox.id,
        {
          reason: '선물 포장 따로',
          reasonCode: 'other',
          expectedManifestVersion: halfBox.manifestVersion,
          moves: [{ shipmentLineId: half.id, expectedLineVersion: half.lineVersion, qty: 1 }],
        },
        randomUUID(),
        actor,
        tx,
      );
      const summary = await reader.summarize(base.warehouseId, undefined, tx);

      expect(idsIn(summary, 'ready')).toContain(source.shipment.id);
      expect(idsIn(summary, 'mergeable')).toEqual(
        expect.arrayContaining([bySize.target.shipmentId, again.target.shipmentId]),
      );
      expect(idsIn(summary, 'mergeable')).not.toContain(source.shipment.id);
    });
  });

  it('크기로 나눈 두 쪽과 같은 고객의 다른 주문 상자가 함께 있으면 셋 다 완전출고다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 3);
      const customerId = randomUUID();
      const source = await createConsolidationSource(tx, wired, base, { quantity: 2, customerId });
      const other = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
      const split = await planning.split(
        source.shipment.id,
        {
          reason: '한 상자에 다 들어가지 않음',
          reasonCode: 'does_not_fit',
          expectedManifestVersion: source.shipment.manifestVersion,
          moves: [{ shipmentLineId: source.line.id, expectedLineVersion: source.line.lineVersion, qty: 1 }],
        },
        randomUUID(),
        { id: randomUUID(), roles: ['master'] },
        tx,
      );
      const summary = await reader.summarize(base.warehouseId, undefined, tx);

      expect(idsIn(summary, 'ready')).toEqual(
        expect.arrayContaining([source.shipment.id, split.target.shipmentId, other.shipment.id]),
      );
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

  it('분류 안에서 오래된 주문부터 놓고 주문일을 싣고, 받는 분은 완전출고 상자에만 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = (quantity = 1) =>
        createConsolidationSource(tx, wired, base, { quantity, customerId: randomUUID() });
      const newest = await source();
      const middle = await source();
      const oldest = await source();
      const joined = await source();
      const partial = await source(3);
      const at = (day: number) => new Date(Date.UTC(2026, 0, day, 3));
      const orderDates: [typeof newest, Date][] = [
        [newest, at(5)],
        [middle, at(3)],
        [oldest, at(2)],
        [joined, at(1)],
        [partial, at(4)],
      ];

      for (const [fixture, date] of orderDates) {
        await tx
          .update(wmsTables.salesOrders)
          .set({ orderDate: date })
          .where(eq(wmsTables.salesOrders.id, fixture.salesOrderId));
      }

      // 더 오래된 주문 줄을 가장 최근 상자에 합친다 — 상자의 주문일은 든 주문 중 가장 이른 날이다
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: newest.shipment.id })
        .where(eq(wmsTables.shipmentLines.id, joined.line.id));
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.shipments.id, joined.shipment.id));
      await tx
        .update(wmsTables.stockReservations)
        .set({ quantity: 1 })
        .where(eq(wmsTables.stockReservations.targetId, partial.line.id));

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const ready = summary.buckets.find(({ bucket }) => bucket === 'ready')?.shipments ?? [];
      const partialRows = summary.buckets.find(({ bucket }) => bucket === 'partial')?.shipments ?? [];

      expect(ready.map(({ shipmentId }) => shipmentId)).toEqual([
        newest.shipment.id,
        oldest.shipment.id,
        middle.shipment.id,
      ]);
      expect(ready.map(({ orderedAt }) => orderedAt)).toEqual([
        at(1).toISOString(),
        at(2).toISOString(),
        at(3).toISOString(),
      ]);
      expect(ready.map(({ shipmentId, recipient }) => recipient?.shipmentId === shipmentId)).toEqual([
        true,
        true,
        true,
      ]);
      expect(ready[0].recipient?.name).toBe(CONSOLIDATION_RECIPIENT.recipientName);
      expect(partialRows).toHaveLength(1);
      expect(partialRows[0]).toMatchObject({ shipmentId: partial.shipment.id, orderedAt: at(4).toISOString() });
      expect(partialRows[0]).not.toHaveProperty('recipient');
    });
  });

  it('우선할당한 상자를 앞에 놓고 표시하고, 합포장은 담긴 주문이 모두 우선할당일 때만 표시한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = () => createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const plain = await source();
      const mixed = await source();
      const joined = await source();
      const urgent = await source();
      const prioritize = (fulfillmentOrderId: string) =>
        tx
          .update(wmsTables.fulfillmentOrders)
          .set({ stockAllocation: 'priority' })
          .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: mixed.shipment.id })
        .where(eq(wmsTables.shipmentLines.id, joined.line.id));
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.shipments.id, joined.shipment.id));
      await prioritize(urgent.fulfillmentOrderId);
      await prioritize(joined.fulfillmentOrderId);

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const ready = summary.buckets.find(({ bucket }) => bucket === 'ready')?.shipments ?? [];

      expect(ready[0]).toMatchObject({ shipmentId: urgent.shipment.id, stockPriority: true });
      expect(new Map(ready.map((row) => [row.shipmentId, row.stockPriority]))).toEqual(
        new Map([
          [urgent.shipment.id, true],
          [plain.shipment.id, false],
          [mixed.shipment.id, false],
        ]),
      );
    });
  });

  it('다른 주문을 우선할당하면서 재고를 내준 부분출고 상자에 그 기록을 싣고, 완전출고 상자에는 싣지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = (quantity: number) =>
        createConsolidationSource(tx, wired, base, { quantity, customerId: randomUUID() });
      const giver = await source(3);
      const refilled = await source(1);
      const receiver = await source(1);
      await tx
        .update(wmsTables.stockReservations)
        .set({ quantity: 1 })
        .where(eq(wmsTables.stockReservations.targetId, giver.line.id));
      const [operation] = await tx
        .insert(wmsTables.shipmentOperations)
        .values({
          type: 'stock_priority',
          status: 'completed',
          operatorId: randomUUID(),
          reason: '우선할당',
          idempotencyKey: randomUUID(),
          requestHash: 'a'.repeat(64),
          completedAt: new Date(),
        })
        .returning();
      await tx.insert(wmsTables.shipmentOperationMembers).values([
        { operationId: operation.id, shipmentId: receiver.shipment.id, role: 'target' },
        { operationId: operation.id, shipmentId: giver.shipment.id, role: 'source' },
        { operationId: operation.id, shipmentId: refilled.shipment.id, role: 'source' },
      ]);

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const rows = new Map(summary.buckets.flatMap(({ shipments }) => shipments.map((row) => [row.shipmentId, row])));
      expect(rows.get(giver.shipment.id)?.stockGiven).toEqual({
        at: operation.createdAt,
        orderNos: rows.get(receiver.shipment.id)?.orderNos,
      });
      expect(rows.get(refilled.shipment.id)?.stockGiven).toBeNull();
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
      expect(missingRecipient.buckets.find(({ bucket }) => bucket === 'needs_info')?.shipments[0].needsInfo).toEqual([
        { kind: 'recipient_incomplete', fields: ['recipientName', 'phone', 'postalCode', 'roadAddress'] },
      ]);
      expect((await planning.getShipmentDetail(source.shipment.id, tx)).needsInfo).toEqual([
        { kind: 'recipient_incomplete', fields: ['recipientName', 'phone', 'postalCode', 'roadAddress'] },
      ]);
      expect(
        missingRecipient.buckets.find(({ bucket }) => bucket === 'needs_info')?.shipments[0].profileSplit,
      ).toBeUndefined();

      await tx.update(wmsTables.skus).set({ deliveryProfileId: null }).where(eq(wmsTables.skus.id, base.skuId));

      const missingProfile = await reader.summarize(base.warehouseId, undefined, tx);

      expect(missingProfile.buckets.find(({ bucket }) => bucket === 'needs_info')?.shipments[0].reason).toBe(
        '배송 프로필이 없는 상품이 있어요',
      );

      const [sku] = await tx
        .select({ name: wmsTables.skus.name, code: wmsTables.skus.code })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, base.skuId));

      // 사유는 첫 문제 하나지만, 고칠 것은 모두 보인다
      expect(
        missingProfile.buckets
          .find(({ bucket }) => bucket === 'needs_info')
          ?.shipments[0].needsInfo?.map((issue) => issue.kind),
      ).toEqual(['shipping_profile_missing', 'recipient_incomplete']);
      expect(missingProfile.buckets.find(({ bucket }) => bucket === 'needs_info')?.shipments[0].needsInfo?.[0]).toEqual(
        { kind: 'shipping_profile_missing', skus: [sku] },
      );
    });
  });

  it('배송 프로필이 섞인 정보 부족 상자에만 그 자리에서 나눌 줄과 상자 버전을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const kept = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const moved = await createConsolidationSource(tx, wired, base, { quantity: 2, customerId: randomUUID() });
      const [baseSku] = await tx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, base.skuId));
      const [cold] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({ name: `it-cold-${randomUUID().slice(0, 8)}`, sourceType: 'in_house' })
        .returning();
      const [coldSku] = await tx
        .insert(wmsTables.skus)
        .values({
          name: 'it-cold-sku',
          code: `IT-COLD-${randomUUID()}`,
          holderId: baseSku.holderId,
          deliveryProfileId: cold.id,
        })
        .returning();
      // 다른 프로필의 상품 줄을 한 상자에 둔다(분할 전 섞인 상자)
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ skuId: coldSku.id })
        .where(eq(wmsTables.fulfillmentOrderItems.id, moved.fulfillmentOrderItemId));
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: kept.shipment.id, skuId: coldSku.id })
        .where(eq(wmsTables.shipmentLines.id, moved.shipmentLineId));
      const [baseProfile] = await tx
        .select({ id: wmsTables.deliveryProfiles.id, name: wmsTables.deliveryProfiles.name })
        .from(wmsTables.deliveryProfiles)
        .where(eq(wmsTables.deliveryProfiles.id, baseSku.deliveryProfileId ?? ''));

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const row = summary.buckets
        .find(({ bucket }) => bucket === 'needs_info')
        ?.shipments.find(({ shipmentId }) => shipmentId === kept.shipment.id);

      expect(row?.needsInfo?.[0].kind).toBe('shipping_profile_mixed');
      expect(row?.profileSplit).toEqual({
        manifestVersion: kept.shipment.manifestVersion,
        lines: expect.arrayContaining([
          {
            id: kept.shipmentLineId,
            lineVersion: kept.line.lineVersion,
            qty: 1,
            skuId: base.skuId,
            skuName: baseSku.name,
            skuCode: baseSku.code,
            deliveryProfile: baseProfile,
          },
          {
            id: moved.shipmentLineId,
            lineVersion: moved.line.lineVersion,
            qty: 2,
            skuId: coldSku.id,
            skuName: 'it-cold-sku',
            skuCode: coldSku.code,
            deliveryProfile: { id: cold.id, name: cold.name },
          },
        ]),
      });
      expect(row?.profileSplit?.lines).toHaveLength(2);
      // 받는 분 정보는 싣지 않는다
      expect(JSON.stringify(row?.profileSplit)).not.toContain(CONSOLIDATION_RECIPIENT.recipientName);

      // 프로필이 하나로 맞으면 정보 부족이 아니고, 나눌 줄도 없다
      await tx.update(wmsTables.skus).set({ deliveryProfileId: cold.id }).where(eq(wmsTables.skus.id, base.skuId));
      const fixed = await reader.summarize(base.warehouseId, undefined, tx);
      expect(
        fixed.buckets.flatMap(({ shipments }) => shipments).find(({ shipmentId }) => shipmentId === kept.shipment.id)
          ?.profileSplit,
      ).toBeUndefined();
    });
  });

  it('상자 상세의 줄은 SKU 코드와 지금 SKU 에 지정된 배송 프로필을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const [sku] = await tx
        .select({ code: wmsTables.skus.code, profileId: wmsTables.skus.deliveryProfileId })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, base.skuId));
      const [profile] = await tx
        .select({ id: wmsTables.deliveryProfiles.id, name: wmsTables.deliveryProfiles.name })
        .from(wmsTables.deliveryProfiles)
        .where(eq(wmsTables.deliveryProfiles.id, sku.profileId ?? ''));

      expect((await planning.getShipmentDetail(source.shipment.id, tx)).lines).toEqual([
        expect.objectContaining({ skuId: base.skuId, skuCode: sku.code, deliveryProfile: profile }),
      ]);

      await tx.update(wmsTables.skus).set({ deliveryProfileId: null }).where(eq(wmsTables.skus.id, base.skuId));

      expect((await planning.getShipmentDetail(source.shipment.id, tx)).lines).toEqual([
        expect.objectContaining({ skuId: base.skuId, skuCode: sku.code, deliveryProfile: null }),
      ]);
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
      expect(needsInfo?.shipments[0].needsInfo?.map((issue) => issue.kind)).toEqual(['channel_item_unknown']);
      expect((await planning.getShipmentDetail(source.shipment.id, tx)).needsInfo.map((issue) => issue.kind)).toEqual([
        'channel_item_unknown',
      ]);
    });
  });

  it('출고불가 상자의 줄에 이 창고 재고·다른 상자 몫과 들어올 예정을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 4);
      const held = await createConsolidationSource(tx, wired, base, { quantity: 3, customerId: randomUUID() });
      const waiting = await createConsolidationSource(tx, wired, base, { quantity: 5, customerId: randomUUID() });

      await tx
        .update(wmsTables.stockReservations)
        .set({ status: 'pending' })
        .where(eq(wmsTables.stockReservations.targetId, waiting.line.id));

      const lineOf = (summary: OutboundPreparationSummaryDto) =>
        summary.buckets
          .find(({ bucket }) => bucket === 'unavailable')
          ?.shipments.find(({ shipmentId }) => shipmentId === waiting.shipment.id)?.lines[0];
      const [{ reserved }] = await tx
        .select({ reserved: sql<number>`COALESCE(SUM(${wmsTables.stockReservations.quantity}), 0)::int` })
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.skuId, base.skuId),
            eq(wmsTables.stockReservations.warehouseId, base.warehouseId),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );

      expect(held.line.id).not.toBe(waiting.line.id);
      expect(reserved).toBeGreaterThan(0);

      // 판매하지 않는 창고면 이 창고 재고만 안다
      await tx
        .update(wmsTables.warehouses)
        .set({ isSellable: false })
        .where(eq(wmsTables.warehouses.id, base.warehouseId));

      expect(lineOf(await reader.summarize(base.warehouseId, undefined, tx))).toEqual({
        name: expect.any(String),
        qty: 5,
        reservedQty: 0,
        stock: {
          skuId: base.skuId,
          onHand: 4,
          reservedByOthers: reserved,
          available: 4 - reserved,
          waiting: 5,
          incoming: null,
          elsewhere: null,
        },
      });

      // 판매 창고가 여럿이면 이 창고로 들어올 수량은 모르고, 판매하지 않는 창고 보유·발주만 안다
      await tx
        .update(wmsTables.warehouses)
        .set({ isSellable: true })
        .where(eq(wmsTables.warehouses.id, base.warehouseId));
      await seedWarehouseWithZone(tx);

      expect(lineOf(await reader.summarize(base.warehouseId, undefined, tx))?.stock).toEqual({
        skuId: base.skuId,
        onHand: 4,
        reservedByOthers: reserved,
        available: 4 - reserved,
        waiting: 5,
        incoming: null,
        elsewhere: expect.objectContaining({ onHand: expect.any(Number), ordered: expect.any(Number) }),
      });

      await tx
        .update(wmsTables.warehouses)
        .set({ isSellable: false })
        .where(not(eq(wmsTables.warehouses.id, base.warehouseId)));

      expect(lineOf(await reader.summarize(base.warehouseId, undefined, tx))?.stock).toEqual({
        skuId: base.skuId,
        onHand: 4,
        reservedByOthers: reserved,
        available: 4 - reserved,
        waiting: 5,
        incoming: {
          inTransit: 0,
          inTransitEta: null,
          ordered: 0,
          orderedEta: null,
          inboundShipment: 0,
          inboundShipmentEta: null,
        },
        elsewhere: { onHand: 0, ordered: 0, orderedEta: null },
      });
      // 모자란 줄이 없는 상자는 재고를 싣지 않는다
      expect(
        (await reader.summarize(base.warehouseId, undefined, tx)).buckets
          .flatMap(({ bucket, shipments }) => (bucket === 'unavailable' ? [] : shipments))
          .flatMap(({ lines }) => lines)
          .some((line) => line.stock !== undefined),
      ).toBe(false);
    });
  });

  it('부분출고 상자는 모자란 줄에만, 이 상자가 잡은 몫을 뺀 재고와 들어올 예정을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 10);
      const held = await createConsolidationSource(tx, wired, base, { quantity: 2, customerId: randomUUID() });
      const partial = await createConsolidationSource(tx, wired, base, { quantity: 3, customerId: randomUUID() });
      const joined = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });

      // 같은 상품의 다른 줄은 다 잡혀 있다
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: partial.shipment.id })
        .where(eq(wmsTables.shipmentLines.id, joined.line.id));
      await tx
        .update(wmsTables.stockReservations)
        .set({ quantity: 1 })
        .where(eq(wmsTables.stockReservations.targetId, partial.line.id));
      await tx
        .update(wmsTables.warehouses)
        .set({ isSellable: true })
        .where(eq(wmsTables.warehouses.id, base.warehouseId));
      await tx
        .update(wmsTables.warehouses)
        .set({ isSellable: false })
        .where(not(eq(wmsTables.warehouses.id, base.warehouseId)));

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const box = summary.buckets
        .find(({ bucket }) => bucket === 'partial')
        ?.shipments.find(({ shipmentId }) => shipmentId === partial.shipment.id);
      // 다른 주문 줄이 든 상자다
      expect(box?.orderCount).toBe(2);
      const short = box?.lines.find((line) => line.qty === 3);
      const full = box?.lines.find((line) => line.qty === 1);

      expect(short?.reservedQty).toBe(1);
      expect(short?.stock).toEqual({
        skuId: base.skuId,
        onHand: 10,
        // 다른 상자가 잡은 2개만. 이 상자의 두 줄이 잡은 2개는 세지 않는다
        reservedByOthers: 2,
        available: 6,
        waiting: 2,
        incoming: {
          inTransit: 0,
          inTransitEta: null,
          ordered: 0,
          orderedEta: null,
          inboundShipment: 0,
          inboundShipmentEta: null,
        },
        elsewhere: { onHand: 0, ordered: 0, orderedEta: null },
      });
      expect(full?.reservedQty).toBe(1);
      expect(full?.stock).toBeUndefined();
      const ready = summary.buckets.find(({ bucket }) => bucket === 'ready')?.shipments;
      expect(ready?.find(({ shipmentId }) => shipmentId === held.shipment.id)?.orderCount).toBe(1);
    });
  });

  it('기다리는 수량은 이 창고에서 그 상품 재고를 다 못 잡은 모든 상자를 세고, 바로 오는 발주의 예정일을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx, 20);
      const make = (quantity: number) =>
        createConsolidationSource(tx, wired, base, { quantity, customerId: randomUUID() });
      const unavailable = await make(5);
      const partial = await make(3);
      const ready = await make(2);
      const handedOver = await make(4);
      const planned = await make(1);
      const unreserve = (lineId: string, quantity: number) =>
        tx
          .update(wmsTables.stockReservations)
          .set(quantity > 0 ? { quantity } : { status: 'pending' })
          .where(eq(wmsTables.stockReservations.targetId, lineId));

      await unreserve(unavailable.line.id, 0);
      await unreserve(partial.line.id, 1);
      // 셀메이트가 내보낼 상자도 들어올 재고를 함께 기다린다(목록에는 없다)
      await unreserve(handedOver.line.id, 0);
      await seedHandedOverOrder(tx, handedOver.salesOrderId);
      // 출고 계획이 끝난 상자는 재고를 기다리지 않는다
      await unreserve(planned.line.id, 0);
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, planned.shipment.id));
      // 다른 창고의 상자는 세지 않는다
      const elsewhere = await seedWarehouseWithZone(tx);
      const other = await make(9);
      await unreserve(other.line.id, 0);
      await tx
        .update(wmsTables.shipments)
        .set({ warehouseId: elsewhere.warehouseId })
        .where(eq(wmsTables.shipments.id, other.shipment.id));
      await tx
        .update(wmsTables.warehouses)
        .set({ isSellable: true })
        .where(eq(wmsTables.warehouses.id, base.warehouseId));
      await tx
        .update(wmsTables.warehouses)
        .set({ isSellable: false })
        .where(not(eq(wmsTables.warehouses.id, base.warehouseId)));

      const [supplier] = await tx
        .insert(wmsTables.suppliers)
        .values({ name: `it-supplier-${randomUUID().slice(0, 8)}`, defaultWarehouseId: base.warehouseId })
        .returning({ id: wmsTables.suppliers.id });
      const [po] = await tx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: 'domestic',
          supplierId: supplier.id,
          status: 'confirmed',
          sourceWarehouseId: base.warehouseId,
          destinationWarehouseId: base.warehouseId,
          requiresTransfer: false,
        })
        .returning({ id: wmsTables.purchaseOrders.id });
      await tx.insert(wmsTables.purchaseOrderLines).values({
        poId: po.id,
        skuId: base.skuId,
        quantity: 6,
        unitPrice: 1000,
        status: 'ordered',
        orderedQty: 6,
        receivedQty: 0,
        expectedArrival: '2026-01-05',
      });

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const stockOf = (shipmentId: string) =>
        summary.buckets.flatMap(({ shipments }) => shipments).find((shipment) => shipment.shipmentId === shipmentId)
          ?.lines[0].stock;

      // 5 + (3 − 1) + 4
      expect(stockOf(unavailable.shipment.id)?.waiting).toBe(11);
      expect(stockOf(partial.shipment.id)?.waiting).toBe(11);
      expect(stockOf(unavailable.shipment.id)?.incoming).toEqual(
        expect.objectContaining({ ordered: 6, orderedEta: '2026-01-05' }),
      );
      expect(stockOf(ready.shipment.id)).toBeUndefined();
      expect(stockOf(handedOver.shipment.id)).toBeUndefined();
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

  it('출고를 되돌린 상자는 되돌린 시각·사유와 새 송장이 필요한지를 주고, 배치에서 돌아온 상자 다음에 놓되 배치에서 다시 빠졌으면 그 묶음에 함께 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const source = () => createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });
      const plain = await source();
      const recalled = await source();
      const redispatched = await source();
      const recalledThenExited = await source();
      const journal = async () => {
        const [row] = await tx.insert(wmsTables.stockJournals).values({}).returning();

        return row.id;
      };
      const dispatchedAt = new Date(Date.now() - 3_600_000);
      const recalledAt = new Date(Date.now() - 1_800_000);
      const attempt = async (shipmentId: string, attemptNo: number, status: 'recalled' | 'dispatched') =>
        tx.insert(wmsTables.dispatchAttempts).values({
          shipmentId,
          attemptNo,
          status,
          idempotencyKey: randomUUID(),
          stockJournalId: await journal(),
          reversalJournalId: status === 'recalled' ? await journal() : null,
          dispatchedAt,
          recalledAt: status === 'recalled' ? recalledAt : null,
        });
      const recall = async (shipmentId: string, reasonCode: string, completedAt: Date) => {
        const id = randomUUID();

        await tx.insert(wmsTables.shipmentOperations).values({
          id,
          type: 'recall',
          status: 'completed',
          operatorId: randomUUID(),
          reason: reasonCode,
          reasonCode,
          idempotencyKey: randomUUID(),
          requestHash: 'a'.repeat(64),
          completedAt,
        });
        await tx.insert(wmsTables.shipmentOperationMembers).values({ operationId: id, shipmentId, role: 'source' });
      };

      await attempt(recalled.shipment.id, 1, 'recalled');
      await recall(recalled.shipment.id, 'package_recovered', new Date(recalledAt.getTime() - 60_000));
      await recall(recalled.shipment.id, 'carrier_handoff_failed', recalledAt);
      await attempt(redispatched.shipment.id, 1, 'recalled');
      await attempt(redispatched.shipment.id, 2, 'dispatched');
      await recall(redispatched.shipment.id, 'dispatch_mistake', recalledAt);
      await attempt(recalledThenExited.shipment.id, 1, 'recalled');
      await recall(recalledThenExited.shipment.id, 'address_correction', recalledAt);
      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          warehouseId: base.warehouseId,
          batchNumber: `recall-${randomUUID()}`,
          pickingMethod: 'individual',
          name: `recall-${randomUUID()}`,
        })
        .returning();
      await tx.insert(wmsTables.outboundBatchWorkItems).values({
        batchId: batch.id,
        shipmentId: recalledThenExited.shipment.id,
        status: 'completed',
        completedAt: new Date(Date.now() - 7_200_000),
        createdAt: new Date(Date.now() - 7_200_000),
      });
      await tx.insert(wmsTables.outboundBatchWorkItems).values({
        batchId: batch.id,
        shipmentId: recalledThenExited.shipment.id,
        status: 'excluded',
        exitTo: 'draft',
        exclusionReason: '잘못 넣은 상자',
      });

      const summary = await reader.summarize(base.warehouseId, undefined, tx);
      const ready = summary.buckets.find((entry) => entry.bucket === 'ready');
      const recallOf = (shipmentId: string) =>
        ready?.shipments.find((shipment) => shipment.shipmentId === shipmentId)?.recallReturn;

      expect(ready?.count).toBe(4);
      expect(ready?.batchReturnCount).toBe(1);
      expect(ready?.recallReturnCount).toBe(1);
      expect(idsIn(summary, 'ready').slice(0, 2)).toEqual([recalledThenExited.shipment.id, recalled.shipment.id]);
      expect(recallOf(recalled.shipment.id)).toEqual({
        recalledAt: recalledAt.toISOString(),
        reasonCode: 'carrier_handoff_failed',
        reason: '택배사 인계 실패',
        needsNewWaybill: true,
      });
      expect(recallOf(redispatched.shipment.id)).toBeNull();
      expect(recallOf(recalledThenExited.shipment.id)).toMatchObject({ reasonCode: 'address_correction' });
      expect(
        ready?.shipments.find((shipment) => shipment.shipmentId === recalledThenExited.shipment.id)?.batchReturn,
      ).toMatchObject({ reason: '잘못 넣은 상자' });
      expect(recallOf(plain.shipment.id)).toBeNull();
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
