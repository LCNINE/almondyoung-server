import { eq, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedChannelOrder, seedLegacyRequest, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };

async function rowOf(tx: DbTx, id: string) {
  const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
  return row;
}
async function commandsOf(tx: DbTx, externalOrderId: string) {
  return tx.execute<{ payload: { payload: Record<string, unknown> } }>(
    drizzleSql`SELECT payload FROM event.outbox_events WHERE event_type = 'CancelChannelOrder' AND aggregate_id = ${`medusa:${externalOrderId}`} ORDER BY created_at`,
  );
}
/** 확정 시각을 과거로 민다 — «환불 지연»(30분 초과)을 만든다 */
async function ageRequest(tx: DbTx, id: string, minutes: number) {
  await tx
    .update(wmsTables.salesOrderAmendments)
    .set({ createdAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(wmsTables.salesOrderAmendments.id, id));
}

describeIfDb('정산 조치 — 다시 시도·계좌 송금 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function refused(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
    await w.manager.recordSettlementFailure(
      { requestId: view.id, retryable: false, failureCode: 'wallet_refund_refused:X', message: '거절', at: new Date(Date.now() + 1000).toISOString() },
      tx,
    );
    return { w, seed, id: view.id };
  }

  it('거절 → 다시 시도: 정산 중으로, since 를 새로 찍고, 같은 requestId·같은 방식(auto)의 명령을 하나 더 낸다. 마지막 실패는 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const before = (await rowOf(tx, id)).metadata as { settlement: { since: string } };
      const view = await w.manager.retrySettlement(seed.salesOrderId, id, tx);
      expect(view.settlement).toMatchObject({ phase: 'in_progress', mode: 'auto', lastFailure: { code: 'wallet_refund_refused:X' } });
      const after = (await rowOf(tx, id)).metadata as { settlement: { since: string } };
      expect(Date.parse(after.settlement.since)).toBeGreaterThan(Date.parse(before.settlement.since));
      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands).toHaveLength(2);
      expect(commands[1].payload.payload).toMatchObject({ requestId: id, refundMode: 'auto' });
    });
  });

  it('거절 → 계좌 송금으로 환불: mode manual, 명령의 refundMode manual', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const view = await w.manager.switchToManualRefund(seed.salesOrderId, id, tx);
      expect(view).toMatchObject({ refundMode: 'manual', settlement: { phase: 'in_progress', mode: 'manual' } });
      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands[commands.length - 1].payload.payload).toMatchObject({ requestId: id, refundMode: 'manual' });
    });
  });

  it('지연(30분 초과·일시 실패만) → 다시 시도할 수 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await ageRequest(tx, view.id, 31);
      await expect(w.manager.retrySettlement(seed.salesOrderId, view.id, tx)).resolves.toMatchObject({ status: 'settling' });
    });
  });

  it('정산 중(30분 안)엔 409 — 막 보낸 명령과 겹치지 않게(D8)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await expect(w.manager.retrySettlement(seed.salesOrderId, view.id, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(w.manager.switchToManualRefund(seed.salesOrderId, view.id, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('이미 계좌 송금이면 계좌 송금은 409, 다시 시도는 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      await w.manager.switchToManualRefund(seed.salesOrderId, id, tx);
      await w.manager.recordSettlementFailure(
        { requestId: id, retryable: false, failureCode: 'not_found', message: '주문 없음', at: new Date(Date.now() + 5000).toISOString() },
        tx,
      );
      await expect(w.manager.switchToManualRefund(seed.salesOrderId, id, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(w.manager.retrySettlement(seed.salesOrderId, id, tx)).resolves.toMatchObject({ refundMode: 'manual' });
    });
  });

  it('다른 주문의 요청 id·없는 id 는 404, 옛 requested 행은 409', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const other = await seedChannelOrder(tx, w, { withFo: true });
      await expect(w.manager.retrySettlement(other.salesOrderId, id, tx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(w.manager.retrySettlement(seed.salesOrderId, 'nope', tx)).rejects.toBeInstanceOf(NotFoundError);
      const legacy = await seedLegacyRequest(tx, other);
      await expect(w.manager.retrySettlement(other.salesOrderId, legacy, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('판매주문 상세의 취소 요청 뷰에 정산이 실린다 — admin-web 이 사유·조치를 그린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const so = await w.salesOrders.getOne(seed.salesOrderId, tx);
      expect(so?.cancelRequest).toMatchObject({ id, status: 'settling', settlement: { phase: 'refused', lastFailure: { message: '거절' } } });
    });
  });
});
