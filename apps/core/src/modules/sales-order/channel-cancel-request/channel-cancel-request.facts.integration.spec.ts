import { eq, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };
const LEDGER = { kind: 'ledger_mismatch' as const, walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL' };
const REFUSED = { kind: 'refused' as const, walletCode: 'REFUND_NOT_AUTOMATABLE' };

async function rowOf(tx: DbTx, id: string) {
  const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
  return row;
}

describeIfDb('거절·정체 사실과 운영자 조치 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function open(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
    return { w, seed, id: view.id };
  }

  it('37번 거절 — 미해결 외부 환불 금액을 함께 적는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.reject(
        { requestId: id, reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: '외부 환불 10,000원', unresolvedRefundAmount: 10000 },
        tx,
      );
      expect((await rowOf(tx, id)).metadata).toMatchObject({
        rejection: { reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', unresolvedRefundAmount: 10000 },
      });
    });
  });

  it('거절 — rejected + 사유, 같은 사실이 다시 와도 그대로(시각도 그대로)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.reject({ requestId: id, reasonCode: 'NOT_CANCELABLE', message: '이미 출고' }, tx);
      const first = await rowOf(tx, id);
      expect(first.status).toBe('rejected');
      expect(first.metadata).toMatchObject({ rejection: { reasonCode: 'NOT_CANCELABLE', message: '이미 출고' } });
      await w.manager.reject({ requestId: id, reasonCode: 'ORDER_NOT_FOUND', message: '다른 사유' }, tx);
      expect((await rowOf(tx, id)).metadata).toEqual(first.metadata);
    });
  });

  it('거절 — 이미 applied 인 요청엔 아무것도 안 한다 · uuid 아닌 requestId 는 무시', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await tx.update(wmsTables.salesOrderAmendments).set({ status: 'applied' }).where(eq(wmsTables.salesOrderAmendments.id, id));
      await w.manager.reject({ requestId: id, reasonCode: 'NOT_CANCELABLE', message: 'x' }, tx);
      expect((await rowOf(tx, id)).status).toBe('applied');
      await expect(w.manager.reject({ requestId: 'not-a-uuid', reasonCode: 'NOT_CANCELABLE', message: 'x' }, tx)).resolves.toBeUndefined();
    });
  });

  it('정체 — requested 를 유지한 채 stage=edited, 두 번 와도 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.markStalled({ requestId: id }, tx);
      await w.manager.markStalled({ requestId: id }, tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('requested');
      expect(row.metadata).toMatchObject({ request: { stage: 'edited' } });
    });
  });

  it('다시 보내기 — 같은 requestId·같은 본문의 명령을 하나 더 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.resend(seed.salesOrderId, tx);
      const commands = await tx.execute<{ idempotency_key: string; payload: { payload: Record<string, unknown> } }>(
        drizzleSql`SELECT idempotency_key, payload FROM event.outbox_events WHERE aggregate_id = ${`medusa:${seed.externalOrderId}`} ORDER BY created_at, id`,
      );
      expect(commands).toHaveLength(2);
      expect(commands[1].payload.payload).toEqual(commands[0].payload.payload);
      expect(commands[1].payload.payload).toMatchObject({ requestId: id });
    });
  });

  it('요청 접기 — rejected(OPERATOR_WITHDRAWN) · 열린 요청이 없으면 409', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      const view = await w.manager.withdraw(seed.salesOrderId, OPERATOR.actorId, tx);
      expect(view).toMatchObject({ id, status: 'rejected', rejection: { reasonCode: 'OPERATOR_WITHDRAWN' } });
      await expect(w.manager.withdraw(seed.salesOrderId, OPERATOR.actorId, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(w.manager.resend(seed.salesOrderId, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('요청 접기 — 수정됨·미반영이면 409 로 거절하고 행은 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.markStalled({ requestId: id }, tx);
      await expect(w.manager.withdraw(seed.salesOrderId, OPERATOR.actorId, tx)).rejects.toBeInstanceOf(ConflictError);
      expect((await rowOf(tx, id)).status).toBe('requested');
    });
  });

  it('요청 접기 — 수정됨이어도 반영(appliedAt)이 끝났으면 접을 수 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.markStalled({ requestId: id }, tx);
      const row = await rowOf(tx, id);
      const meta = row.metadata as { request: Record<string, unknown> };
      await tx
        .update(wmsTables.salesOrderAmendments)
        .set({ metadata: { ...meta, request: { ...meta.request, appliedAt: new Date().toISOString() } } })
        .where(eq(wmsTables.salesOrderAmendments.id, id));
      const view = await w.manager.withdraw(seed.salesOrderId, OPERATOR.actorId, tx);
      expect(view.status).toBe('rejected');
    });
  });

  it('36번 환불 거절 — 닫지 않고(보류 유지) 갈래·사유를 요청에 적는다, 같은 사유가 다시 와도 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '장부 불일치', refundFailure: LEDGER }, tx);
      const first = await rowOf(tx, id);
      expect(first.status).toBe('requested');
      expect(first.metadata).toMatchObject({ request: { refundFailure: { ...LEDGER, message: '장부 불일치' } } });
      expect(first.metadata).not.toHaveProperty('rejection');
      // 보류 = 열린 요청. 송장 발급·배치 시작·발송 사전검사가 이것을 본다
      expect((await w.reader.findOpen(seed.salesOrderId, tx))?.id).toBe(id);

      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '장부 불일치', refundFailure: LEDGER }, tx);
      expect((await rowOf(tx, id)).metadata).toEqual(first.metadata);

      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '환불 불가', refundFailure: REFUSED }, tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ request: { refundFailure: { ...REFUSED, message: '환불 불가' } } });
    });
  });

  it('36번 정체 — 분류된 거절이면 edited 와 사유를 함께, 사유 없는 정체 사실은 저장된 사유를 지우지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.markStalled({ requestId: id, message: 'PG down' }, tx);
      await w.manager.markStalled({ requestId: id, message: '장부 불일치', refundFailure: LEDGER }, tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('requested');
      expect(row.metadata).toMatchObject({ request: { stage: 'edited', refundFailure: { ...LEDGER, message: '장부 불일치' } } });

      await w.manager.markStalled({ requestId: id, message: 'PG down' }, tx);
      expect((await rowOf(tx, id)).metadata).toEqual(row.metadata);
    });
  });

  it('36번 다시 보내기 — 사유를 지우고, 같은 거절이 다시 오면 다시 붙는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '환불 불가', refundFailure: REFUSED }, tx);
      const view = await w.manager.resend(seed.salesOrderId, tx);
      expect(view.refundFailure).toBeNull();
      expect((await rowOf(tx, id)).metadata).not.toMatchObject({ request: { refundFailure: expect.anything() } });

      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '환불 불가', refundFailure: REFUSED }, tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ request: { refundFailure: REFUSED } });
    });
  });

  it('36번 — 이미 닫힌 요청엔 환불 거절도 아무것도 안 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.withdraw(seed.salesOrderId, OPERATOR.actorId, tx);
      const closed = await rowOf(tx, id);
      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: 'x', refundFailure: LEDGER }, tx);
      expect(await rowOf(tx, id)).toEqual(closed);
    });
  });
});
