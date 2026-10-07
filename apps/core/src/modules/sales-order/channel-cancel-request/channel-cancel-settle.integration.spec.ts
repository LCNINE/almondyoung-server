import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { markLineShipped, modifiedPayload, seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };
const NEXT_ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '부산', detailAddress: '202' };

const progress = (requestId: string, stage: 'edited' | 'refunded') => [
  { requestId, stage, refundAmount: 1000, shippingCharge: 3000, shippingRefund: 0, shippingNotAdjusted: false },
];

async function amendmentsOf(tx: DbTx, salesOrderId: string) {
  return tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId));
}
async function requestOf(tx: DbTx, id: string) {
  const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
  return row;
}
async function cancellationsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderCancellations)
    .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
}

describeIfDb('채널 취소 확정 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function partialRequest(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request(
      { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
      tx,
    );
    return { w, seed, requestId: view.id };
  }

  it('refunded — 요청을 applied 로 닫고 결과를 채운다. 그 감소로 채널 행을 만들지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [1, 1], cancelRequests: progress(requestId, 'refunded') }),
        'm-1',
        tx,
      );
      const row = await requestOf(tx, requestId);
      expect(row.status).toBe('applied');
      expect(row.metadata).toMatchObject({
        outcome: { refundAmount: 1000, shippingCharge: 3000, shippingRefund: 0, shippingNotAdjusted: false },
      });
      expect((await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel')).toHaveLength(0);
      const cancellations = await cancellationsOf(tx, seed.salesOrderId);
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0].metadata).toMatchObject({ sourceEventId: `cancel-request:${requestId}` });
    });
  });

  it('edited 다음 refunded(델타 0) — 물리 취소는 한 번, 요청은 두 번째에 닫힌다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [1, 1], cancelRequests: progress(requestId, 'edited') }),
        'm-1',
        tx,
      );
      const mid = await requestOf(tx, requestId);
      expect(mid.status).toBe('requested');
      expect(mid.metadata).toMatchObject({ request: { stage: 'edited', appliedAt: expect.any(String) } });
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);

      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [1, 1], cancelRequests: progress(requestId, 'refunded') }),
        'm-2',
        tx,
      );
      expect((await requestOf(tx, requestId)).status).toBe('applied');
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('채널이 아직 이 요청을 처리하지 않았다(기록 없음) — 요청은 그대로, 델타는 5번 규칙', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { quantities: [1, 1] }), 'm-1', tx);
      expect((await requestOf(tx, requestId)).status).toBe('requested');
      expect((await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel')).toHaveLength(1);
    });
  });

  it('기록은 있는데 델타가 어긋남 — 요청 superseded(CHANNEL_CHANGE_MISMATCH), 델타는 5번 규칙', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [0, 1], cancelRequests: progress(requestId, 'refunded') }),
        'm-1',
        tx,
      );
      const row = await requestOf(tx, requestId);
      expect(row.status).toBe('superseded');
      expect(row.metadata).toMatchObject({ supersededReason: 'CHANNEL_CHANGE_MISMATCH' });
      expect((await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel')).toHaveLength(1);
    });
  });

  it('열린 요청이 있어도 주소만 바뀐 변경은 5번 규칙대로, 요청 행은 대기 목록·superseded 처리에 섞이지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { address: NEXT_ADDRESS }), 'm-1', tx);
      expect((await requestOf(tx, requestId)).status).toBe('requested');
      const channelRows = (await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel');
      expect(channelRows).toHaveLength(1);
      expect(channelRows[0].status).toBe('applied');
      const after = await requestOf(tx, requestId);
      expect(after.supersededById).toBeNull();
      expect(after.metadata).not.toHaveProperty('supersededReason');
      const pending = await w.amendments.list({ status: 'pending', limit: 200 }, tx);
      expect(pending.items.some((item) => item.id === requestId)).toBe(false);
    });
  });

  it('요청이 먹은 감소 + 채널이 더 지운 감소로 전 라인이 0 이면 남은 감소는 ALL_LINES_REMOVED 로 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request(
        { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 2 }], requester: OPERATOR, sourceKey: 'k-all' },
        tx,
      );
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [0, 0], cancelRequests: progress(view.id, 'refunded') }),
        'm-1',
        tx,
      );
      expect((await requestOf(tx, view.id)).status).toBe('applied');
      const channelRows = (await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel');
      expect(channelRows).toHaveLength(1);
      expect(channelRows[0].status).toBe('pending');
      expect(JSON.stringify(channelRows[0].deltas)).toContain('ALL_LINES_REMOVED');
    });
  });

  it('물리 취소가 거절되면 요청 superseded(APPLY_REFUSED), 취소 행 없음, 같은 감소는 5번이 대기로 둔다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await markLineShipped(tx, seed.lineIds[0], 1);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [1, 1], cancelRequests: progress(requestId, 'refunded') }),
        'm-1',
        tx,
      );
      const row = await requestOf(tx, requestId);
      expect(row.status).toBe('superseded');
      expect(row.metadata).toMatchObject({ supersededReason: 'APPLY_REFUSED' });
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(0);
      const channelRows = (await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel');
      expect(channelRows).toHaveLength(1);
      expect(channelRows[0].status).toBe('pending');
      expect(JSON.stringify(channelRows[0].deltas)).toContain('CANCEL_NOT_IMMEDIATE');
    });
  });

  it('전체 요청 + 수집된 전체취소 → applied / 부분 요청 + 전체취소 → superseded', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const full = await seedChannelOrder(tx, w, { withFo: true });
      const fullView = await w.manager.request({ salesOrderId: full.salesOrderId, requester: OPERATOR, sourceKey: 'kf' }, tx);
      await w.salesOrders.cancel(full.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-1' } }, tx);
      await w.settler.settleCancelled(full.salesOrderId, tx);
      expect((await requestOf(tx, fullView.id)).status).toBe('applied');

      const { seed, requestId } = await partialRequest(tx);
      await w.salesOrders.cancel(seed.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-2' } }, tx);
      await w.settler.settleCancelled(seed.salesOrderId, tx);
      const row = await requestOf(tx, requestId);
      expect(row.status).toBe('superseded');
      expect(row.metadata).toMatchObject({ supersededReason: 'CHANNEL_FULL_CANCEL' });
    });
  });
});
