import { eq, sql as drizzleSql } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

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
/** 확정 시각을 과거로 민다 — «환불 지연»(30분 초과)을 만든다. 첫 정산의 since 는 확정 시각과 같으니 함께 민다 */
async function ageRequest(tx: DbTx, id: string, minutes: number) {
  const past = new Date(Date.now() - minutes * 60_000);
  const row = await rowOf(tx, id);
  const meta = row.metadata as { settlement: { since: string } };
  await tx
    .update(wmsTables.salesOrderAmendments)
    .set({ createdAt: past, metadata: { ...meta, settlement: { ...meta.settlement, since: past.toISOString() } } })
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
      const view = await w.manager.retrySettlement(seed.salesOrderId, id, {}, tx);
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

  it('지연(확정 뒤 30분 초과) → 다시 시도할 수 있고, since 가 새로 찍히고 명령이 하나 더 나간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await ageRequest(tx, view.id, 31);
      const before = (await rowOf(tx, view.id)).metadata as { settlement: { since: string } };
      await expect(w.manager.retrySettlement(seed.salesOrderId, view.id, {}, tx)).resolves.toMatchObject({ status: 'settling' });
      const after = (await rowOf(tx, view.id)).metadata as { settlement: { since: string } };
      expect(Date.parse(after.settlement.since)).toBeGreaterThan(Date.parse(before.settlement.since));
      expect(await commandsOf(tx, seed.externalOrderId)).toHaveLength(2);
    });
  });

  it('지연 요청을 다시 시도한 직후의 두 번째 조치는 409 — 더블클릭·겹침(재발행 유예)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await ageRequest(tx, view.id, 31);
      await w.manager.retrySettlement(seed.salesOrderId, view.id, {}, tx);
      await expect(w.manager.retrySettlement(seed.salesOrderId, view.id, {}, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(w.manager.switchToManualRefund(seed.salesOrderId, view.id, tx)).rejects.toBeInstanceOf(ConflictError);
      expect(await commandsOf(tx, seed.externalOrderId)).toHaveLength(2);
    });
  });

  it('지연 요청을 다시 시도한 뒤 거절 사실이 오면 곧바로 다시 조치할 수 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await ageRequest(tx, view.id, 31);
      await w.manager.retrySettlement(seed.salesOrderId, view.id, {}, tx);
      await w.manager.recordSettlementFailure(
        { requestId: view.id, retryable: false, failureCode: 'wallet_refund_refused:X', message: '거절', at: new Date(Date.now() + 1000).toISOString() },
        tx,
      );
      await expect(w.manager.switchToManualRefund(seed.salesOrderId, view.id, tx)).resolves.toMatchObject({ refundMode: 'manual' });
    });
  });

  it('정산 중(30분 안)엔 409 — 막 보낸 명령과 겹치지 않게(D8)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await expect(w.manager.retrySettlement(seed.salesOrderId, view.id, {}, tx)).rejects.toBeInstanceOf(ConflictError);
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
      await expect(w.manager.retrySettlement(seed.salesOrderId, id, {}, tx)).resolves.toMatchObject({ refundMode: 'manual' });
    });
  });

  it('다른 주문의 요청 id·없는 id 는 404, 정산이 끝난 요청은 409', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const other = await seedChannelOrder(tx, w, { withFo: true });
      await expect(w.manager.retrySettlement(other.salesOrderId, id, {}, tx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(w.manager.retrySettlement(seed.salesOrderId, 'nope', {}, tx)).rejects.toBeInstanceOf(NotFoundError);
      // 확정된 전체취소가 수집(OrderCancelled)으로 닫혔다 — settling 이 아니면 다시 낼 정산이 없다
      const done = await w.manager.request({ salesOrderId: other.salesOrderId, requester: OPERATOR, sourceKey: 'k2' }, tx);
      await w.settler.settleCancelled(other.salesOrderId, tx);
      expect((await rowOf(tx, done.id)).status).toBe('applied');
      await expect(w.manager.retrySettlement(other.salesOrderId, done.id, {}, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  /** 부분취소를 확정하고 채널이 «이미 환불한 금액»을 물으며 거절한 상태(#1016 37번) — 품목은 core 에서 이미 취소됐다 */
  async function askedForRefundedAmount(tx: DbTx, failureCode: string) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request(
      {
        salesOrderId: seed.salesOrderId,
        lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
        requester: OPERATOR,
        sourceKey: 'k1',
      },
      tx,
    );
    await w.manager.recordSettlementFailure(
      { requestId: view.id, retryable: false, failureCode, message: '품목에 연결 안 된 외부 환불 3,000원이 있습니다', at: new Date(Date.now() + 1000).toISOString() },
      tx,
    );
    return { w, seed, id: view.id };
  }

  it('«이미 환불한 금액» 거절 → 금액을 적어 다시 시도: 명령에 금액이 실리고, 저장된 명령도 바뀌어 뒤의 조치·재발행이 같은 금액을 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await askedForRefundedAmount(tx, 'external_refund_unresolved');
      await w.manager.retrySettlement(seed.salesOrderId, id, { alreadyRefundedAmount: 3000 }, tx);
      let commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands).toHaveLength(2);
      expect(commands[0].payload.payload.alreadyRefundedAmount).toBeUndefined();
      expect(commands[1].payload.payload).toMatchObject({ requestId: id, scope: 'partial', alreadyRefundedAmount: 3000 });

      // 금액 없이 누른 다음 조치(여기선 계좌 송금)도 그 금액을 잃지 않는다 — Medusa 는 금액이 바뀐 같은 requestId 를 다른 요청으로 거절한다
      await w.manager.recordSettlementFailure(
        { requestId: id, retryable: false, failureCode: 'wallet_refund_refused:X', message: '거절', at: new Date(Date.now() + 5000).toISOString() },
        tx,
      );
      await w.manager.switchToManualRefund(seed.salesOrderId, id, tx);
      commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands[commands.length - 1].payload.payload).toMatchObject({ refundMode: 'manual', alreadyRefundedAmount: 3000 });
    });
  });

  it('«품목에 연결할 외부 환불 없음»·«금액 초과» 거절도 금액을 고쳐 다시 시도할 수 있다(0 = 상계 없음)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await askedForRefundedAmount(tx, 'external_refund_exceeds');
      await w.manager.retrySettlement(seed.salesOrderId, id, { alreadyRefundedAmount: 0 }, tx);
      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands[commands.length - 1].payload.payload).toMatchObject({ alreadyRefundedAmount: 0 });
    });
  });

  it('«이미 환불한 금액» 거절이 아닌 정산엔 금액을 받지 않는다(400) — 수정이 끝난 뒤 금액이 바뀌면 Medusa 가 영구 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await askedForRefundedAmount(tx, 'wallet_refund_refused:X');
      await expect(w.manager.retrySettlement(seed.salesOrderId, id, { alreadyRefundedAmount: 3000 }, tx)).rejects.toBeInstanceOf(BadRequestError);
      expect(await commandsOf(tx, seed.externalOrderId)).toHaveLength(1);
    });
  });

  it('판매주문 상세의 취소 요청 뷰에 정산이 실린다 — admin-web 이 사유·조치를 그린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const so = await w.salesOrders.getOne(seed.salesOrderId, tx);
      expect(so?.cancelRequest).toMatchObject({ id, status: 'settling', settlement: { phase: 'refused', lastFailure: { message: '거절' } } });
    });
  });

  it('리컨실러 재발행 — 1분 안엔 안 내고, 지나면 같은 requestId·방식으로 하나 더. 거절은 안 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      const since = Date.parse(((await rowOf(tx, view.id)).metadata as { settlement: { since: string } }).settlement.since);
      expect(await w.manager.hasSettlementToReissue(seed.salesOrderId, new Date(since + 30_000), tx)).toBe(false);
      const later = new Date(since + 61_000);
      expect(await w.manager.hasSettlementToReissue(seed.salesOrderId, later, tx)).toBe(true);
      expect(await w.manager.reissueSettlements(seed.salesOrderId, later, tx)).toBe(1);
      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands).toHaveLength(2);
      expect(commands[1].payload.payload).toMatchObject({ requestId: view.id, refundMode: 'auto' });

      const fp = await w.manager.settlementFingerprint(seed.salesOrderId, tx);
      await w.manager.recordSettlementFailure(
        { requestId: view.id, retryable: false, failureCode: 'wallet_refund_refused:X', message: '거절', at: new Date(since + 62_000).toISOString() },
        tx,
      );
      expect(await w.manager.hasSettlementToReissue(seed.salesOrderId, new Date(since + 3_600_000), tx)).toBe(false);
      expect(await w.manager.settlementFingerprint(seed.salesOrderId, tx)).not.toBe(fp);
    });
  });
});
