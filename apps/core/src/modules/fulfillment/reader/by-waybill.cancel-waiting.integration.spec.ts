import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentWaybillReader } from './shipment-waybill.reader';
import { inRollbackTx, makeDb } from '../services/__support__';
import { PickableShipmentFixture } from '../services/__support__/logistics-fixtures';
import { seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from '../services/__support__/simple-outbound-wiring';
import { assembleLabels } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('송장 스캔 — 취소를 기다리는 박스', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const readerFor = (tx: DbTx) => {
    const dbService = ambientDbService(tx);
    return new ShipmentWaybillReader(dbService, assembleLabels(dbService).states);
  };

  async function cancel(
    wiring: ReturnType<typeof assembleOutbound>,
    box: PickableShipmentFixture,
    qty: number,
    tx: DbTx,
  ) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
    return wiring.planning.cancelOutstanding(
      box.shipmentId,
      {
        expectedManifestVersion: shipment.manifestVersion,
        reason: '고객 취소',
        lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty }],
      },
      `c-${randomUUID()}`,
      actor,
      null,
      tx,
    );
  }

  async function started(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    return { first, second, wiring };
  }

  it('시작된 배치에서 부분 취소된 박스는 사유와 줄마다 취소될 수량을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await started(tx);
      expect((await cancel(wiring, first, 1, tx)).operationStatus).toBe('pending');

      const found = await readerFor(tx).byTrackingNo(first.trackingNo);

      expect(found).toMatchObject({
        shipmentStatus: 'recovery_required',
        recoveryCode: 'CANCEL_REPLAN_PENDING',
        pendingCancellation: [{ shipmentLineId: first.shipmentLineId, qty: 1 }],
      });
    });
  });

  async function withdrawnWhileWaiting(tx: DbTx) {
    const { first, wiring } = await started(tx);
    await cancel(wiring, first, 1, tx);
    await wiring.batches.excludeShipment(
      first.batchId,
      first.shipmentId,
      { reason: 'x' },
      `x-${randomUUID()}`,
      actor,
      tx,
    );
    return first;
  }

  it('담은 게 없는 채 배치에서 빼 기다리던 취소가 끝나면, 옛 송장 번호는 빠진 박스(draft)로 찾는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const first = await withdrawnWhileWaiting(tx);
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, first.shipmentId));
      expect(shipment.status).toBe('draft');

      const found = await readerFor(tx).byTrackingNo(first.trackingNo);

      expect(found).toMatchObject({ labelState: 'withdrawn', exitTo: 'draft', recoveryCode: null });
    });
  });

  it('그 상자가 취소로 끝났으면 canceled 로 찾는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const first = await withdrawnWhileWaiting(tx);
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.shipments.id, first.shipmentId));

      const found = await readerFor(tx).byTrackingNo(first.trackingNo);

      expect(found).toMatchObject({ labelState: 'withdrawn', exitTo: 'canceled' });
    });
  });

  it('같은 상자의 더 오래전에 무효화된 송장은 빠진 박스로 보지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const first = await withdrawnWhileWaiting(tx);
      const [current] = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.trackingNo, first.trackingNo));
      const older = `OLD-${randomUUID()}`;
      await tx.insert(wmsTables.waybills).values({
        ...current,
        id: randomUUID(),
        trackingNo: older,
        voidedAt: new Date(Date.now() - 3_600_000),
        createdAt: new Date(Date.now() - 7_200_000),
      });

      await expect(readerFor(tx).byTrackingNo(older)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('뺀 뒤 다시 계획돼 새 송장이 무효화돼도, 빼면서 무효화된 송장만 빠진 박스다', async () => {
    await inRollbackTx(db, async (tx) => {
      const first = await withdrawnWhileWaiting(tx);
      const [current] = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.trackingNo, first.trackingNo));
      const later = `NEW-${randomUUID()}`;
      await tx.insert(wmsTables.waybills).values({
        ...current,
        id: randomUUID(),
        trackingNo: later,
        voidedAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(Date.now() + 1_800_000),
      });

      await expect(readerFor(tx).byTrackingNo(first.trackingNo)).resolves.toMatchObject({
        labelState: 'withdrawn',
        exitTo: 'draft',
      });
      await expect(readerFor(tx).byTrackingNo(later)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('관리자가 송장 무효화까지 해서 뺀 박스도 그 송장으로 빠진 박스를 찾는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const first = await withdrawnWhileWaiting(tx);
      const [waybill] = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.trackingNo, first.trackingNo));
      // 그 경로는 커밋 뒤 따로 무효화한다 — 기록된 무효화 명령의 키만 그 모양으로 바꿔 둔다
      await tx
        .update(wmsTables.fulfillmentCommandRequests)
        .set({ idempotencyKey: `withdrawal-void:${first.workItemId}:${waybill.id}` })
        .where(
          and(
            eq(wmsTables.fulfillmentCommandRequests.commandType, 'shipment.waybill.void'),
            eq(wmsTables.fulfillmentCommandRequests.resourceId, waybill.id),
          ),
        );

      await expect(readerFor(tx).byTrackingNo(first.trackingNo)).resolves.toMatchObject({
        labelState: 'withdrawn',
        exitTo: 'draft',
      });
    });
  });

  it('취소를 기다리지 않는 박스는 둘 다 null', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second } = await started(tx);

      const found = await readerFor(tx).byTrackingNo(second.trackingNo);

      expect(found).toMatchObject({ shipmentStatus: 'planned', recoveryCode: null, pendingCancellation: null });
    });
  });
});
