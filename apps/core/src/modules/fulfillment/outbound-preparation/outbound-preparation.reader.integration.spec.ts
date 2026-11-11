import { createCheckpointsForTesting } from '@app/authorization';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { assembleBoxWithdrawal } from '../services/__support__/box-withdrawal-wiring';
import { randomUUID } from 'crypto';
import { count, eq } from 'drizzle-orm';
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
import { OutboundPreparationReader } from './outbound-preparation.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('OutboundPreparationReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let reader: OutboundPreparationReader;
  let planning: ShipmentPlanningService;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

    ({ sql: client, db } = makeDb(DATABASE_URL));
    const dbService = makeDbService(db);

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
});
