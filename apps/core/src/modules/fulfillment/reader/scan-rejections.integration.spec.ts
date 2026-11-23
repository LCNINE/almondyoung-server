import { randomUUID } from 'crypto';
import { eq, sql as fragment } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { OutboundScanRejectionManager } from '../scan-rejections/outbound-scan-rejection.manager';
import { recordableRejection } from '../scan-rejections/scan-rejection-reasons';
import { inRollbackTx, makeDb } from '../services/__support__';
import { PickableShipmentFixture } from '../services/__support__/logistics-fixtures';
import { seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from '../services/__support__/simple-outbound-wiring';
import { loadOpenScanRejections } from './scan-rejections';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('물류앱에서 막힌 상자', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 앞 작업자가 맡은(2개 중 아직 0개) 상자를 다른 작업자가 찍어 거절되면, 인터셉터가 하듯 그 거절을 남긴다. */
  async function blocked(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const owner = { id: first.actorId, roles: ['logistics_worker'] };
    expect((await wiring.simple.prepare(first.shipmentId, owner, `prep-${randomUUID()}`, tx)).outcome).toBe('ready');
    const manager = new OutboundScanRejectionManager(ambientDbService(tx), new BarcodeService(ambientDbService(tx)));
    const other = randomUUID();
    const key = randomUUID();
    const error = await wiring.simple
      .scan(
        first.shipmentId,
        { barcode: first.barcode, quantity: 1, actor: { id: other, roles: [] }, idempotencyKey: key },
        tx,
      )
      .then(
        () => undefined,
        (rejected: unknown) => rejected,
      );
    const rejection = recordableRejection(error);
    expect(rejection).toEqual({ code: 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER', reasonCode: null });
    if (!rejection) throw new Error('expected a recordable rejection');
    const input = {
      commandType: 'shipment.simple_outbound.scan',
      shipmentId: first.shipmentId,
      idempotencyKey: key,
      actorId: other,
      barcode: first.barcode,
      quantity: 1,
      rejection,
      rejectedAt: new Date(),
    };
    expect(await manager.record(input, tx)).toBe(true);
    const [sku] = await tx
      .select({ name: wmsTables.skus.name })
      .from(wmsTables.skus)
      .where(eq(wmsTables.skus.id, first.skuId));
    return { first, second, wiring, manager, input, owner, other, skuName: sku.name };
  }

  const open = async (tx: DbTx, box: PickableShipmentFixture) =>
    (await loadOpenScanRejections(tx, [box.shipmentId])).get(box.shipmentId) ?? null;

  it('거절된 상자에 사유·다음 할 일·상품·작업자를 싣고, 다른 상자는 비운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, other, skuName } = await blocked(tx);

      const detail = await wiring.planning.getShipmentDetail(first.shipmentId, tx);
      expect(detail.scanRejection).toMatchObject({
        code: 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER',
        action: 'handoff_worker',
        route: 'simple_scan',
        message: expect.stringContaining('다른 작업자가 맡은 상자'),
        barcode: first.barcode,
        skuName,
        quantity: 1,
        actorId: other,
        rejectedAt: expect.any(Date),
      });
      expect((await wiring.planning.getShipmentDetail(second.shipmentId, tx)).scanRejection).toBeNull();

      const batch = await wiring.batches.getBatch(first.batchId, tx);
      const byShipment = new Map(batch.workItems.map((item) => [item.shipmentId, item]));
      expect(byShipment.get(first.shipmentId)?.scanRejection?.code).toBe('SIMPLE_OUTBOUND_CLAIMED_BY_OTHER');
      expect(byShipment.get(second.shipmentId)?.scanRejection).toBeNull();
    });
  });

  const leaseOf = async (tx: DbTx, workItemId: string) =>
    (
      await tx
        .select({ leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion })
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId))
    )[0].leaseVersion;
  const supervisor = { id: randomUUID(), roles: ['logistics_manager'] };

  it('거절 뒤 담당을 넘기면 남은 채로 받은 작업자와 시각을 싣고, 그 작업자가 찍어 반영되면 사라진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, other } = await blocked(tx);
      expect((await open(tx, first))?.handedOff).toBeNull();

      await wiring.batches.handoff(
        first.workItemId,
        {
          claimType: 'picker',
          targetWorkerId: other,
          expectedLeaseVersion: await leaseOf(tx, first.workItemId),
          reason: 'handoff after rejection',
        },
        `handoff-${randomUUID()}`,
        supervisor,
        tx,
      );

      expect(await open(tx, first)).toMatchObject({
        code: 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER',
        actorId: other,
        handedOff: { at: expect.any(Date), workerId: other },
      });
      const batch = await wiring.batches.getBatch(first.batchId, tx);
      expect(batch.workItems.find((item) => item.shipmentId === first.shipmentId)?.scanRejection?.handedOff).toEqual({
        at: expect.any(Date),
        workerId: other,
      });

      await wiring.simple.scan(
        first.shipmentId,
        {
          barcode: first.barcode,
          quantity: 1,
          actor: { id: other, roles: ['logistics_worker'] },
          idempotencyKey: randomUUID(),
        },
        tx,
      );
      expect(await open(tx, first)).toBeNull();
    });
  });

  it('넘긴 뒤 담당이 또 바뀌었으면 넘긴 시각만 싣고 받은 작업자는 모른다고 둔다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, other } = await blocked(tx);
      await wiring.batches.handoff(
        first.workItemId,
        {
          claimType: 'picker',
          targetWorkerId: other,
          expectedLeaseVersion: await leaseOf(tx, first.workItemId),
          reason: 'handoff after rejection',
        },
        `handoff-${randomUUID()}`,
        supervisor,
        tx,
      );
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ pickerId: randomUUID(), pickerClaimedAt: fragment`CURRENT_TIMESTAMP + interval '5 minutes'` })
        .where(eq(wmsTables.outboundBatchWorkItems.id, first.workItemId));

      expect((await open(tx, first))?.handedOff).toEqual({ at: expect.any(Date), workerId: null });
    });
  });

  it('넘긴 뒤에 다시 거절되면 넘긴 것으로 보지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, other, manager, input } = await blocked(tx);
      const third = randomUUID();
      await wiring.batches.handoff(
        first.workItemId,
        {
          claimType: 'picker',
          targetWorkerId: third,
          expectedLeaseVersion: await leaseOf(tx, first.workItemId),
          reason: 'handoff to someone else',
        },
        `handoff-${randomUUID()}`,
        supervisor,
        tx,
      );
      expect((await open(tx, first))?.handedOff).toMatchObject({ workerId: third });

      expect(
        await manager.record({ ...input, idempotencyKey: randomUUID(), rejectedAt: new Date(Date.now() + 60_000) }, tx),
      ).toBe(true);
      expect(await open(tx, first)).toMatchObject({ actorId: other, handedOff: null });
    });
  });

  it('같은 키로 다시 보내 다른 사유로 거절되면 한 줄이 마지막 사유로 바뀐다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, manager, input } = await blocked(tx);

      expect(
        await manager.record(
          { ...input, rejection: { code: 'SHIPMENT_INVOICE_NOT_READY', reasonCode: null }, rejectedAt: new Date() },
          tx,
        ),
      ).toBe(true);

      const rows = await tx
        .select()
        .from(wmsTables.outboundScanRejections)
        .where(eq(wmsTables.outboundScanRejections.shipmentId, first.shipmentId));
      expect(rows.map((row) => row.code)).toEqual(['SHIPMENT_INVOICE_NOT_READY']);
      expect((await open(tx, first))?.action).toBe('check_waybill');
    });
  });

  it('같은 키의 앞 시도 기록이 늦게 와도 뒤 시도의 사유를 덮지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, manager, input } = await blocked(tx);
      const later = new Date(input.rejectedAt.getTime() + 5_000);
      await manager.record(
        { ...input, rejection: { code: 'SHIPMENT_INVOICE_NOT_READY', reasonCode: null }, rejectedAt: later },
        tx,
      );

      await manager.record(input, tx);

      const rows = await tx
        .select()
        .from(wmsTables.outboundScanRejections)
        .where(eq(wmsTables.outboundScanRejections.shipmentId, first.shipmentId));
      expect(rows.map((row) => [row.code, row.createdAt.getTime()])).toEqual([
        ['SHIPMENT_INVOICE_NOT_READY', later.getTime()],
      ]);
    });
  });

  it('거절된 요청이 도는 사이 다른 저장이 반영됐으면 풀린 것으로 본다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, manager, input } = await blocked(tx);
      const started = new Date(Date.now() - 60_000);
      await tx.insert(wmsTables.fulfillmentCommandRequests).values({
        commandType: 'shipment.simple_outbound.scan',
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
        status: 'completed',
        resourceType: 'shipment',
        resourceId: first.shipmentId,
        responseSnapshot: { lines: [] },
        completedAt: new Date(started.getTime() + 1_000),
      });

      await tx
        .delete(wmsTables.outboundScanRejections)
        .where(eq(wmsTables.outboundScanRejections.shipmentId, first.shipmentId));
      await manager.record({ ...input, idempotencyKey: randomUUID(), rejectedAt: started }, tx);

      expect(await open(tx, first)).toBeNull();
    });
  });

  it('그 뒤 그 상자에 출고 저장이 반영되면 사라진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, owner } = await blocked(tx);

      await wiring.simple.scan(
        first.shipmentId,
        { barcode: first.barcode, quantity: 1, actor: owner, idempotencyKey: randomUUID() },
        tx,
      );

      expect(await open(tx, first)).toBeNull();
    });
  });

  it('반영 없이 닫힌 명령(준비 막힘·강제출고 미반영)은 풀린 것으로 보지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await blocked(tx);
      const later = new Date(Date.now() + 60_000);
      for (const [commandType, snapshot] of [
        ['shipment.simple_outbound.scan', { outcome: 'preparation_blocked', code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED' }],
        ['shipment.location_outbound.force', { outcome: 'rejected', code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED' }],
      ] as const)
        await tx.insert(wmsTables.fulfillmentCommandRequests).values({
          commandType,
          idempotencyKey: randomUUID(),
          requestHash: 'a'.repeat(64),
          status: 'completed',
          resourceType: 'shipment',
          resourceId: first.shipmentId,
          responseSnapshot: snapshot,
          completedAt: later,
        });

      expect(await open(tx, first)).not.toBeNull();
    });
  });

  it('상자가 배치에서 빠졌거나 빼는 중이거나 상태가 바뀌면 사라진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await blocked(tx);
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'excluded', exclusionReason: 'manual' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, first.workItemId));
      expect(await open(tx, first)).toBeNull();
    });
    await inRollbackTx(db, async (tx) => {
      const { first } = await blocked(tx);
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'withdrawing', exitTo: 'draft' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, first.workItemId));
      expect(await open(tx, first)).toBeNull();
    });
    await inRollbackTx(db, async (tx) => {
      const { first } = await blocked(tx);
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.shipments.id, first.shipmentId));
      expect(await open(tx, first)).toBeNull();
    });
  });

  it('바구니 배정 때문에 막힌 상자는 배정이 풀리면 사라진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, manager, other } = await blocked(tx);
      const [tote] = await tx
        .insert(wmsTables.totes)
        .values({ warehouseId: first.warehouseId, barcode: `T-${randomUUID()}` })
        .returning();
      const [assignment] = await tx
        .insert(wmsTables.shipmentToteAssignments)
        .values({ shipmentId: first.shipmentId, toteId: tote.id, assignedBy: other })
        .returning();
      await tx
        .delete(wmsTables.outboundScanRejections)
        .where(eq(wmsTables.outboundScanRejections.shipmentId, first.shipmentId));
      await manager.record(
        {
          commandType: 'shipment.simple_outbound.scan',
          shipmentId: first.shipmentId,
          idempotencyKey: randomUUID(),
          actorId: other,
          barcode: first.barcode,
          quantity: 1,
          rejection: { code: 'SHIPMENT_TOTE_NOT_RELEASED', reasonCode: null },
          rejectedAt: new Date(),
        },
        tx,
      );
      expect((await open(tx, first))?.action).toBe('release_tote');

      await tx
        .update(wmsTables.shipmentToteAssignments)
        .set({ releasedAt: new Date() })
        .where(eq(wmsTables.shipmentToteAssignments.id, assignment.id));

      expect(await open(tx, first)).toBeNull();
    });
  });

  it('배치 상세의 줄은 기록의 작업 항목이 그 줄일 때만 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await blocked(tx);
      await tx
        .update(wmsTables.outboundScanRejections)
        .set({ workItemId: null })
        .where(eq(wmsTables.outboundScanRejections.shipmentId, first.shipmentId));

      const batch = await wiring.batches.getBatch(first.batchId, tx);
      const line = batch.workItems.find((item) => item.shipmentId === first.shipmentId);
      expect(line?.scanRejection).toBeNull();
      expect((await wiring.planning.getShipmentDetail(first.shipmentId, tx)).scanRejection).not.toBeNull();
    });
  });

  it('작업자가 그 자리에서 고칠 거절은 남기지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, owner } = await blocked(tx);
      const error = await wiring.simple
        .scan(
          first.shipmentId,
          { barcode: `nope-${randomUUID()}`, quantity: 1, actor: owner, idempotencyKey: randomUUID() },
          tx,
        )
        .then(
          () => undefined,
          (rejected: unknown) => rejected,
        );

      expect(error).toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_BARCODE_UNKNOWN' } });
      expect(recordableRejection(error)).toBeNull();
    });
  });
});
