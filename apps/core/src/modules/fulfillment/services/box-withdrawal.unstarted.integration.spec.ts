import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from './__support__';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actorId = randomUUID();

describeIfDb('시작 전 배치에서 빼기·송장 로컬 무효화 (BoxWithdrawalService, #1016 30번)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function unstartedBox(tx: DbTx) {
    const box = await seedPickableShipment(tx, 2);
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    const lines = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, box.shipmentId));
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
    return { box, shipment, lines, workItem, wiring: assembleOutbound(tx) };
  }

  const waybillOf = async (tx: DbTx, waybillId: string) =>
    (await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, waybillId)))[0];

  it('막힘 없는 시작 전 배치 상자는 사유를 남기고 빠지며, 낡은 행으로 다시 빼면 WORK_ITEM_STALE_LEASE_VERSION', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, shipment, lines, workItem, wiring } = await unstartedBox(tx);

      await expect(wiring.withdrawals.unstartedExitBlocker({ shipment, lines }, tx)).resolves.toBeNull();
      await expect(wiring.withdrawals.hasLiveAllocation(box.shipmentId, tx)).resolves.toBe(false);

      const excluded = await wiring.withdrawals.excludeUnstarted(workItem, '고객 취소', tx);

      expect(excluded).toMatchObject({
        id: box.workItemId,
        status: 'excluded',
        exclusionReason: '고객 취소',
        leaseVersion: workItem.leaseVersion + 1,
      });
      await expect(wiring.withdrawals.excludeUnstarted(workItem, '고객 취소', tx)).rejects.toMatchObject({
        response: { code: 'WORK_ITEM_STALE_LEASE_VERSION' },
      });
    });
  });

  it('배치가 시작돼 배정이 생긴 상자는 살아 있는 배정으로 빼기가 막힌다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, shipment, lines, wiring } = await unstartedBox(tx);
      await wiring.picking.start(
        { batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );

      await expect(wiring.withdrawals.hasLiveAllocation(box.shipmentId, tx)).resolves.toBe(true);
      await expect(wiring.withdrawals.unstartedExitBlocker({ shipment, lines }, tx)).resolves.toMatchObject({
        code: 'WORK_ITEM_ALLOCATED',
      });
    });
  });

  it('registered 송장은 호출자의 키로 로컬 무효화하고, 활성 송장이 없으면 아무것도 하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring } = await unstartedBox(tx);
      const operationId = randomUUID();

      await wiring.withdrawals.voidWaybillForCancel(
        box.shipmentId,
        { actorId, idempotencyKey: `cancel-exit:${operationId}:${box.shipmentId}`, reason: 'canceled' },
        tx,
      );
      await wiring.withdrawals.voidWaybillForCancel(
        box.shipmentId,
        { actorId, idempotencyKey: `cancel-exit:${randomUUID()}:${box.shipmentId}`, reason: 'canceled' },
        tx,
      );

      const waybill = await waybillOf(tx, box.waybillId);
      expect(waybill.status).toBe('voided');
      expect(waybill.voidedAt).not.toBeNull();
      const voided = await tx
        .select({ id: wmsTables.waybills.id })
        .from(wmsTables.waybills)
        .where(and(eq(wmsTables.waybills.shipmentId, box.shipmentId), eq(wmsTables.waybills.status, 'voided')));
      expect(voided).toHaveLength(1);
    });
  });

  it('무효화할 수 없는 송장(발급 중 pending)은 WITHDRAWAL_WAYBILL_NOT_VOIDABLE 로 거절하고 그대로 둔다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring } = await unstartedBox(tx);
      await tx
        .update(wmsTables.waybills)
        .set({ source: 'carrier', status: 'pending' })
        .where(eq(wmsTables.waybills.id, box.waybillId));

      await expect(
        wiring.withdrawals.voidWaybillForCancel(
          box.shipmentId,
          { actorId, idempotencyKey: `cancel-exit:${randomUUID()}:${box.shipmentId}`, reason: 'canceled' },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'WITHDRAWAL_WAYBILL_NOT_VOIDABLE' } });
      expect((await waybillOf(tx, box.waybillId)).status).toBe('pending');
    });
  });
});
