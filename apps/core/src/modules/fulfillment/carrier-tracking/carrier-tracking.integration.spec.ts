import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FULFILLMENT_STREAM, SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from '../services/__support__';
import { outboxPublisherFor } from '../outbox/__support__/outbox-publisher.factory';
import { CarrierTrackingPoller } from '../services/carrier-tracking.poller';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { ShipmentDeliveryTrackingService } from '../services/shipment-delivery-tracking.service';
import {
  CarrierCapabilities,
  CarrierError,
  CarrierGateway,
  type CarrierCode,
  type CarrierScan,
} from '../waybill/carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { CarrierTrackingChecker } from './carrier-tracking.checker';
import { CarrierTrackingManager } from './carrier-tracking.manager';
import { CarrierTrackingReader } from './carrier-tracking.reader';
import { CarrierTrackingService } from './carrier-tracking.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

class FakeHanjin extends CarrierGateway {
  override readonly carrier: CarrierCode = 'HANJIN';
  override readonly capabilities: CarrierCapabilities = {
    allocatesExternally: true,
    registersSeparately: true,
    canTrack: true,
    canCancel: false,
  };
  answers = new Map<string, () => Promise<CarrierScan[]>>();
  override isConfigured() {
    return true;
  }
  override allocate(): never {
    throw new Error('unused');
  }
  override register(): never {
    throw new Error('unused');
  }
  override track(waybillNo: string): Promise<CarrierScan[]> {
    return this.answers.get(waybillNo)?.() ?? Promise.resolve([]);
  }
}

const scan = (statusCode: string, status: CarrierScan['status'], at: Date, over: Partial<CarrierScan> = {}) => ({
  statusCode,
  status,
  occurredAt: at,
  ...over,
});

describeIfDb('택배사 접수 대사 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  function wire(database: PostgresJsDatabase<typeof wmsSchema>) {
    const dbService = makeDbService(database);
    const gateway = new FakeHanjin();
    const gate = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' }));
    const tracking = new ShipmentDeliveryTrackingService(
      dbService,
      outboxPublisherFor(SHIPMENT_STREAM, dbService),
      outboxPublisherFor(FULFILLMENT_STREAM, dbService),
      gate,
      wireLogistics(dbService, 'v2').shipmentReservations,
    );
    const checker = new CarrierTrackingChecker(dbService, new CarrierGatewayRegistry([gateway]), tracking);
    const reader = new CarrierTrackingReader(dbService, checker);
    const manager = new CarrierTrackingManager(
      dbService,
      reader,
      checker,
      new FulfillmentCommandService(dbService),
      gate,
    );
    const service = new CarrierTrackingService(reader, manager);
    const poller = new CarrierTrackingPoller(dbService, checker, gate);
    return { gateway, checker, reader, manager, service, poller, dbService };
  }

  type Seeded = { attemptId: string; shipmentId: string; trackingNo: string; salesOrderId: string };

  async function seedDispatched(
    tx: DbTx,
    dispatchedAt: Date,
    over: { recalled?: boolean; shipmentStatus?: 'shipped' | 'in_transit' } = {},
  ): Promise<Seeded> {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const variantId = randomUUID();
    const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
    await seedMatching(tx, { variantId, skuId });
    const wired = wireLogistics(makeDbService(tx as never), 'v2');
    await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);
    const [line] = await tx
      .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
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
    const { shipmentId } = line;
    const trackingNo = `T${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const [waybill] = await tx
      .insert(wmsTables.waybills)
      .values({
        shipmentId,
        source: 'carrier',
        carrier: 'HANJIN',
        status: over.recalled ? 'voided' : 'used',
        trackingNo,
        manifestVersion: 1,
        recipientHash: 'a'.repeat(64),
      })
      .returning();
    const journal = async () => {
      const [row] = await tx
        .insert(wmsTables.stockJournals)
        .values({ sourceType: 'dispatch', idempotencyKey: `carrier-tracking-${randomUUID()}` })
        .returning();
      return row.id;
    };
    const [attempt] = await tx
      .insert(wmsTables.dispatchAttempts)
      .values({
        shipmentId,
        attemptNo: 1,
        status: over.recalled ? 'recalled' : 'dispatched',
        idempotencyKey: `carrier-tracking-${randomUUID()}`,
        waybillId: waybill.id,
        stockJournalId: await journal(),
        dispatchedAt,
        ...(over.recalled
          ? { recalledAt: new Date(dispatchedAt.getTime() + HOUR), reversalJournalId: await journal() }
          : {}),
      })
      .returning();
    if (!over.recalled) {
      await tx
        .update(wmsTables.shipments)
        .set({ status: over.shipmentStatus ?? 'shipped', shippedAt: dispatchedAt })
        .where(eq(wmsTables.shipments.id, shipmentId));
    }
    return { attemptId: attempt.id, shipmentId, trackingNo, salesOrderId };
  }

  const checkRow = async (tx: DbTx, attemptId: string) =>
    (
      await tx
        .select()
        .from(wmsTables.carrierTrackingChecks)
        .where(eq(wmsTables.carrierTrackingChecks.dispatchAttemptId, attemptId))
    )[0];

  const target = (seeded: Seeded, dispatchedAt: Date, recalled = false) => ({
    dispatchAttemptId: seeded.attemptId,
    dispatchedAt,
    carrier: 'HANJIN' as const,
    trackingNo: seeded.trackingNo,
    recalled,
  });

  it('집하 스캔이 없는 송장은 기준이 지나면 확인할 송장으로 세고 주문번호를 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { service, checker, reader } = wire(tx as never);
      const late = new Date(Date.now() - 5 * DAY);
      const recent = new Date(Date.now() - HOUR);
      const overdue = await seedDispatched(tx, late);
      const fresh = await seedDispatched(tx, recent);
      await checker.check(target(overdue, late));
      await checker.check(target(fresh, recent));

      const before = await reader.listOpen(new Date());
      const ours = before.filter((row) => [overdue.attemptId, fresh.attemptId].includes(row.dispatchAttemptId));
      expect(ours.map((row) => [row.dispatchAttemptId, row.judgement.kind])).toEqual([
        [overdue.attemptId, 'no_scan'],
        [fresh.attemptId, null],
      ]);
      const attention = await service.attention();
      const item = attention.items.find((row) => row.dispatchAttemptId === overdue.attemptId);
      expect(item).toMatchObject({
        kind: 'no_scan',
        raised: true,
        accepted: false,
        trackingNo: overdue.trackingNo,
        orders: [{ salesOrderId: overdue.salesOrderId }],
        lastOutcome: 'no_scan',
        scan: null,
      });
      expect(attention.items.some((row) => row.dispatchAttemptId === fresh.attemptId)).toBe(false);
      expect((await service.summary()).attention).toBe(attention.attention);
    });
  });

  it('집하출발만으로는 배송 중도 인수도 아니고, 미집하가 오면 되돌릴 수 있는 채로 알린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { gateway, checker, reader } = wire(tx as never);
      const at = new Date(Date.now() - 3 * HOUR);
      const seeded = await seedDispatched(tx, at);
      gateway.answers.set(seeded.trackingNo, () =>
        Promise.resolve([
          scan('07', 'pending', new Date(at.getTime() + HOUR)),
          scan('08', 'pickup_missed', new Date(at.getTime() + 2 * HOUR), { reasonLabel: '화물미준비' }),
        ]),
      );
      await checker.check(target(seeded, at));
      const [attempt] = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.id, seeded.attemptId));
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, seeded.shipmentId));
      expect(attempt.carrierAcceptedAt).toBeNull();
      expect(shipment.status).toBe('shipped');
      const row = await reader.findAttempt(seeded.attemptId, new Date());
      expect(row?.judgement).toMatchObject({ kind: 'pickup_missed', raised: true, accepted: false });
      expect(row?.check).toMatchObject({ scanCode: '08', scanReason: '화물미준비' });
    });
  });

  it('집하완료가 오면 배송 중으로 올리고 확인할 송장에서 빠진다. 두 번 물어도 이력은 하나다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { gateway, checker, reader } = wire(tx as never);
      const at = new Date(Date.now() - 5 * DAY);
      const seeded = await seedDispatched(tx, at);
      gateway.answers.set(seeded.trackingNo, () =>
        Promise.resolve([scan('11', 'in_transit', new Date(at.getTime() + 30 * HOUR))]),
      );
      expect(await checker.check(target(seeded, at))).toMatchObject({ outcome: 'answered', recorded: 1 });
      expect(await checker.check(target(seeded, at))).toMatchObject({ outcome: 'answered', recorded: 0 });
      const events = await tx
        .select()
        .from(wmsTables.shipmentTracking)
        .where(eq(wmsTables.shipmentTracking.dispatchAttemptId, seeded.attemptId));
      expect(events).toHaveLength(1);
      expect((await reader.findAttempt(seeded.attemptId, new Date()))?.judgement).toMatchObject({
        kind: null,
        accepted: true,
      });
    });
  });

  it('묻지 못해도 앞서 본 스캔과 마지막 답한 시각을 지우지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { gateway, checker } = wire(tx as never);
      const at = new Date(Date.now() - 2 * DAY);
      const seeded = await seedDispatched(tx, at);
      gateway.answers.set(seeded.trackingNo, () =>
        Promise.resolve([scan('08', 'pickup_missed', new Date(at.getTime() + HOUR))]),
      );
      await checker.check(target(seeded, at));
      const first = await checkRow(tx, seeded.attemptId);
      gateway.answers.set(seeded.trackingNo, () =>
        Promise.reject(new CarrierError('timeout', 'unknown_outcome', { code: 'timeout' })),
      );
      expect(await checker.check(target(seeded, at))).toMatchObject({ outcome: 'failed', code: 'timeout' });
      const second = await checkRow(tx, seeded.attemptId);
      expect(second).toMatchObject({
        outcome: 'unknown',
        errorCode: 'timeout',
        scanCode: '08',
        answeredAt: first.answeredAt,
      });
      gateway.answers.set(seeded.trackingNo, () => Promise.resolve([]));
      await checker.check(target(seeded, at));
      expect(await checkRow(tx, seeded.attemptId)).toMatchObject({
        outcome: 'no_scan',
        errorCode: null,
        scanCode: '08',
      });
    });
  });

  it('먼저 시작한 느린 조회가 나중 답을 덮지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { gateway, checker } = wire(tx as never);
      const at = new Date(Date.now() - 2 * DAY);
      const seeded = await seedDispatched(tx, at);
      const started = new Date();
      const later = new Date(started.getTime() + 1000);
      gateway.answers.set(seeded.trackingNo, () =>
        Promise.resolve([scan('08', 'pickup_missed', new Date(at.getTime() + HOUR))]),
      );
      await checker.check(target(seeded, at), () => later);
      gateway.answers.set(seeded.trackingNo, () => Promise.reject(new CarrierError('slow', 'unknown_outcome', {})));
      await checker.check(target(seeded, at), () => started);
      expect(await checkRow(tx, seeded.attemptId)).toMatchObject({ outcome: 'scans', attemptedAt: later });
    });
  });

  it('되돌린 송장을 택배사가 가져가면 배송 이력은 그대로 두고 알린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { gateway, poller, reader, service } = wire(tx as never);
      const at = new Date(Date.now() - 2 * DAY);
      const seeded = await seedDispatched(tx, at, { recalled: true });
      const targets = await poller.findTargets(['HANJIN'], new Date(Date.now() - 14 * DAY));
      expect(targets.find((row) => row.dispatchAttemptId === seeded.attemptId)).toMatchObject({ recalled: true });
      gateway.answers.set(seeded.trackingNo, () =>
        Promise.resolve([scan('11', 'in_transit', new Date(at.getTime() + 3 * HOUR))]),
      );
      await service.recheck(seeded.attemptId);
      const events = await tx
        .select()
        .from(wmsTables.shipmentTracking)
        .where(eq(wmsTables.shipmentTracking.dispatchAttemptId, seeded.attemptId));
      expect(events).toHaveLength(0);
      const rows = await reader.listOpen(new Date());
      expect(rows.find((row) => row.dispatchAttemptId === seeded.attemptId)?.judgement).toMatchObject({
        kind: 'recalled_but_moving',
        raised: true,
      });
    });
  });

  it('오래 안 물은 송장부터 묻는다 — 한 번도 안 물은 것이 먼저다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { checker, poller } = wire(tx as never);
      const at = new Date(Date.now() - 2 * DAY);
      const asked = await seedDispatched(tx, at);
      const askedEarlier = await seedDispatched(tx, at);
      const never = await seedDispatched(tx, new Date(at.getTime() + HOUR));
      await checker.check(target(askedEarlier, at), () => new Date(Date.now() - 2 * HOUR));
      await checker.check(target(asked, at), () => new Date(Date.now() - HOUR));
      const ids = [asked, askedEarlier, never].map((row) => row.attemptId);
      const order = (await poller.findTargets(['HANJIN'], new Date(Date.now() - 14 * DAY)))
        .map((row) => row.dispatchAttemptId)
        .filter((id) => ids.includes(id));
      expect(order).toEqual([never.attemptId, askedEarlier.attemptId, asked.attemptId]);
    });
  });

  it('확인 기록은 본 상태와 같을 때만 받고, 기다림이 끝나면 다시 뜬다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { checker, manager, reader, service } = wire(tx as never);
      const at = new Date(Date.now() - 5 * DAY);
      const seeded = await seedDispatched(tx, at);
      await checker.check(target(seeded, at));
      const dto = {
        outcome: 'wait' as const,
        note: ' 한진 지점에 확인, 오늘 집하 예정 ',
        expectedKind: 'no_scan' as const,
        expectedScanKey: '',
        expectedConfirmationId: null,
      };
      const key = randomUUID();
      const first = await manager.confirm(seeded.attemptId, dto, key, 'worker');
      // 응답을 못 받고 다시 눌러도 기록은 하나다
      expect(await manager.confirm(seeded.attemptId, dto, key, 'worker')).toEqual(first);
      const row = await reader.findAttempt(seeded.attemptId, new Date());
      expect(row?.judgement).toMatchObject({ kind: 'no_scan', raised: false });
      expect(row?.confirmation).toMatchObject({ note: '한진 지점에 확인, 오늘 집하 예정', actorId: 'worker' });
      const attention = await service.attention();
      expect(attention.waiting).toBeGreaterThan(0);
      expect(attention.items.find((item) => item.dispatchAttemptId === seeded.attemptId)).toMatchObject({
        raised: false,
        confirmations: [{ outcome: 'wait' }],
      });

      const resumed = new Date(new Date(first.resumeAt as string).getTime() + 1);
      expect((await reader.findAttempt(seeded.attemptId, resumed))?.judgement.raised).toBe(true);

      await expect(manager.confirm(seeded.attemptId, dto, randomUUID(), 'other')).rejects.toMatchObject({
        message: expect.stringContaining('changed') as string,
      });
      await expect(
        manager.confirm(
          seeded.attemptId,
          { ...dto, expectedConfirmationId: first.confirmationId, expectedScanKey: '08@x' },
          randomUUID(),
          'other',
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('changed') as string });
      const closed = await manager.confirm(
        seeded.attemptId,
        { ...dto, outcome: 'closed', expectedConfirmationId: first.confirmationId },
        randomUUID(),
        'manager',
      );
      expect(closed.resumeAt).toBeNull();
      const after = await service.attention();
      expect(after.items.some((item) => item.dispatchAttemptId === seeded.attemptId)).toBe(false);
      const [item] = (await service.forShipment(seeded.shipmentId)).items;
      expect(item.confirmations.map((row) => row.actorId)).toEqual(['manager', 'worker']);
    });
  });

  it('확인할 일이 아니면 기록을 받지 않고, 빈 메모도 받지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { manager } = wire(tx as never);
      const seeded = await seedDispatched(tx, new Date(Date.now() - HOUR));
      const dto = { outcome: 'closed' as const, note: 'x', expectedKind: 'no_scan' as const, expectedScanKey: '' };
      await expect(manager.confirm(seeded.attemptId, dto, randomUUID(), 'a')).rejects.toMatchObject({
        message: expect.stringContaining('needs no confirmation') as string,
      });
      await expect(manager.confirm(seeded.attemptId, { ...dto, note: '   ' }, randomUUID(), 'a')).rejects.toMatchObject(
        { message: expect.stringContaining('note') as string },
      );
    });
  });

  it('두 사람이 동시에 기록하면 한 명만 남고 다른 한 명은 바뀌었다고 알린다', async () => {
    const at = new Date(Date.now() - 5 * DAY);
    const seeded = await db.transaction((tx) => seedDispatched(tx as unknown as DbTx, at));
    try {
      const { manager, checker } = wire(db);
      await checker.check(target(seeded, at));
      const dto = {
        outcome: 'wait' as const,
        note: '확인',
        expectedKind: 'no_scan' as const,
        expectedScanKey: '',
        expectedConfirmationId: null,
      };
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let written = () => {};
      const firstWritten = new Promise<void>((resolve) => (written = resolve));
      const first = db.transaction(async (tx) => {
        await manager.confirm(seeded.attemptId, dto, randomUUID(), 'a', tx as unknown as DbTx);
        written();
        await held;
      });
      await firstWritten;
      // 앞 사람의 기록이 아직 커밋되지 않았을 때 들어온다
      const second = manager.confirm(seeded.attemptId, dto, randomUUID(), 'b').then(
        () => 'saved',
        (error: Error) => error.message,
      );
      const early = await Promise.race([second, new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))]);
      release();
      await first;
      expect(early).toBe('waiting');
      expect(await second).toContain('changed');
      const rows = await db
        .select()
        .from(wmsTables.carrierTrackingConfirmations)
        .where(eq(wmsTables.carrierTrackingConfirmations.dispatchAttemptId, seeded.attemptId));
      expect(rows).toHaveLength(1);
    } finally {
      // 다른 스펙의 목록에 잡히지 않게 배송완료로 닫아 둔다
      await db
        .update(wmsTables.shipments)
        .set({ status: 'delivered' })
        .where(eq(wmsTables.shipments.id, seeded.shipmentId));
    }
  });
});
