import { randomUUID } from 'crypto';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { ADDRESS, modifiedPayload, seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };
const NEXT_ADDRESS = { ...ADDRESS, roadAddress: '부산' };

async function rowOf(tx: DbTx, id: string) {
  const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
  return row;
}
async function cancellationsOf(tx: DbTx, salesOrderId: string) {
  return tx.select().from(wmsTables.salesOrderCancellations).where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
}
async function soCancelledEvents(tx: DbTx, salesOrderId: string) {
  return tx.execute<{ id: string }>(
    drizzleSql`SELECT id FROM event.outbox_events WHERE event_type = 'SalesOrderCancelled' AND aggregate_id = ${salesOrderId}`,
  );
}
const failure = (requestId: string, over: Partial<{ retryable: boolean; failureCode: string; message: string; at: string }> = {}) => ({
  requestId,
  retryable: false,
  failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
  message: '자동 환불할 수 없는 결제수단입니다',
  at: new Date(Date.now() + 1000).toISOString(),
  ...over,
});

describeIfDb('정산 중 요청의 사실 받기 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function confirmFull(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
    return { w, seed, id: view.id };
  }
  async function confirmPartial(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request(
      { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
      tx,
    );
    return { w, seed, id: view.id };
  }

  it('전체 — 수집된 OrderCancelled: 판매주문 취소는 아무것도 안 하고(이미 취소) 요청은 applied, 실패 기록은 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmFull(tx);
      await w.manager.recordSettlementFailure(failure(id, { retryable: true, failureCode: 'http_500' }), tx);
      // handleOrderCancelled 가 하는 일 그대로: cancel() → settleCancelled()
      await w.salesOrders.cancel(seed.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-1' } }, tx);
      await w.settler.settleCancelled(seed.salesOrderId, tx);
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
      expect(await soCancelledEvents(tx, seed.salesOrderId)).toHaveLength(1);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('applied');
      expect(row.metadata).toMatchObject({ settlement: { mode: 'auto' } });
      expect((row.metadata as { settlement: Record<string, unknown> }).settlement.lastFailure).toBeUndefined();
    });
  });

  it('정산 중 요청 둘 + 전체취소 수집 — 전체는 applied, 부분은 superseded(CHANNEL_FULL_CANCEL)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id: partialId } = await confirmPartial(tx);
      await w.manager.recordSettlementFailure(failure(partialId), tx);
      const full = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: { kind: 'customer', customerId: randomUUID() }, sourceKey: 'k2' },
        tx,
      );
      await w.salesOrders.cancel(seed.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-1' } }, tx);
      await w.settler.settleCancelled(seed.salesOrderId, tx);
      expect((await rowOf(tx, full.id)).status).toBe('applied');
      const partial = await rowOf(tx, partialId);
      expect(partial.status).toBe('superseded');
      expect(partial.metadata).toMatchObject({ supersededReason: 'CHANNEL_FULL_CANCEL' });
    });
  });

  it('전체 — OrderCancelled 를 놓쳐도 재수집 스냅샷의 orderCancelled 로 applied(PR 6 판정 3)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmFull(tx);
      await w.manager.recordSettlementFailure(failure(id, { retryable: true, failureCode: 'http_500' }), tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { orderCancelled: true }), 'm-1', tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('applied');
      expect(row.metadata).toMatchObject({ settlement: { mode: 'auto' } });
      expect((row.metadata as { settlement: Record<string, unknown> }).settlement.lastFailure).toBeUndefined();
      // 판매주문은 확정 때 이미 취소됐다 — 취소 기록이 늘지 않는다
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('부분 정산 중 + 채널 주문 취소 스냅샷 — superseded(CHANNEL_FULL_CANCEL), settleCancelled 와 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmPartial(tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { quantities: [1, 1], orderCancelled: true }), 'm-1', tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('superseded');
      expect(row.metadata).toMatchObject({ supersededReason: 'CHANNEL_FULL_CANCEL' });
    });
  });

  it('orderCancelled 가 없는 재수집은 전체 정산 중 행을 닫지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmFull(tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed), 'm-1', tx);
      expect((await rowOf(tx, id)).status).toBe('settling');
    });
  });

  it('부분 — refunded 기록: applied + 결과, 물리 적용은 다시 하지 않는다(취소 기록 그대로 하나)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmPartial(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, {
          quantities: [1, 1],
          cancelRequests: [
            { requestId: id, stage: 'refunded', refundAmount: 1000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false, externalRefundApplied: 500 },
          ],
        }),
        'm-1',
        tx,
      );
      const row = await rowOf(tx, id);
      expect(row.status).toBe('applied');
      expect(row.metadata).toMatchObject({ outcome: { refundAmount: 1000, externalRefundApplied: 500 } });
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
      const channelRows = (await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, seed.salesOrderId))).filter(
        (a) => a.origin === 'channel',
      );
      expect(channelRows.flatMap((a) => a.deltas as unknown[])).toEqual([]);
    });
  });

  it('부분 — edited 기록: 정산 중 그대로(환불이 남았다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmPartial(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, {
          quantities: [1, 1],
          cancelRequests: [{ requestId: id, stage: 'edited', refundAmount: 1000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false }],
        }),
        'm-1',
        tx,
      );
      expect((await rowOf(tx, id)).status).toBe('settling');
    });
  });

  it('진행 기록 없는 부분 정산 + 주소 변경 — 요청분의 «늘어남»은 먹고 주소만 반영(반영 대기 변경 없음, D10)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmPartial(tx);
      // Medusa 는 아직 안 줄였다 — 스냅샷 수량은 원래대로(2,1), core 유효 수량은 (1,1)
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { address: NEXT_ADDRESS }), 'm-1', tx);
      expect((await rowOf(tx, id)).status).toBe('settling');
      const channelRows = (await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, seed.salesOrderId))).filter(
        (a) => a.origin === 'channel',
      );
      expect(channelRows).toHaveLength(1);
      expect(channelRows[0].status).toBe('applied');
      expect((channelRows[0].deltas as Array<{ type: string }>).map((d) => d.type)).toEqual(['shipping_address_change']);
    });
  });

  it('진행 기록 없는 부분 정산 둘이 같은 줄 + 주소 변경 — 합친 «늘어남» 하나를 먹는다(반영 대기 변경 없음, D10)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      // 줄 0(수량 2)에서 1개씩 두 번 — 줄 1 이 남아 둘 다 부분이다. core 유효 수량은 (0,1)
      const ids: string[] = [];
      for (const sourceKey of ['k1', 'k2']) {
        const view = await w.manager.request(
          { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey },
          tx,
        );
        ids.push(view.id);
      }
      expect((await rowOf(tx, ids[1])).metadata).toMatchObject({ request: { scope: 'partial' } });
      // Medusa 는 둘 다 아직 안 줄였다 — 스냅샷 (2,1) 이라 diff 는 줄 0 에 0→2 하나를 낸다(요청 하나하나의 크기 1 과 다르다)
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { address: NEXT_ADDRESS }), 'm-1', tx);
      for (const id of ids) expect((await rowOf(tx, id)).status).toBe('settling');
      const channelRows = (await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, seed.salesOrderId))).filter(
        (a) => a.origin === 'channel',
      );
      expect(channelRows).toHaveLength(1);
      expect(channelRows[0].status).toBe('applied');
      expect((channelRows[0].deltas as Array<{ type: string }>).map((d) => d.type)).toEqual(['shipping_address_change']);
    });
  });

  it('정산 중 부분취소(refunded) + 채널이 남은 줄도 지움 — 요청은 applied, 남은 감소는 ALL_LINES_REMOVED 로 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      // 줄 0(수량 2) 전부 — 줄 1 이 남아 부분이다. core 유효 수량은 (0,1)
      const view = await w.manager.request(
        { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 2 }], requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, {
          quantities: [0, 0],
          cancelRequests: [{ requestId: view.id, stage: 'refunded', refundAmount: 2000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false }],
        }),
        'm-1',
        tx,
      );
      expect((await rowOf(tx, view.id)).status).toBe('applied');
      const channelRows = (await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, seed.salesOrderId))).filter(
        (a) => a.origin === 'channel',
      );
      expect(channelRows).toHaveLength(1);
      expect(channelRows[0].status).toBe('pending');
      expect(JSON.stringify(channelRows[0].deltas)).toContain('ALL_LINES_REMOVED');
    });
  });

  it('정산 실패 — 영구면 refused, 일시면 in_progress, 둘 다 마지막 실패를 적는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await confirmFull(tx);
      await w.manager.recordSettlementFailure(failure(id), tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({
        settlement: { state: 'refused', lastFailure: { code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE', retryable: false } },
      });
      await w.manager.recordSettlementFailure(failure(id, { retryable: true, failureCode: 'http_502', at: new Date(Date.now() + 2000).toISOString() }), tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ settlement: { state: 'in_progress', lastFailure: { code: 'http_502' } } });
    });
  });

  it('같은 요청의 사실이 순서 없이 온다 — 더 이른 at 은 버린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await confirmFull(tx);
      const later = new Date(Date.now() + 5000).toISOString();
      const earlier = new Date(Date.now() + 1000).toISOString();
      await w.manager.recordSettlementFailure(failure(id, { retryable: true, failureCode: 'http_500', at: later }), tx);
      await w.manager.recordSettlementFailure(failure(id, { at: earlier }), tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ settlement: { state: 'in_progress', lastFailure: { code: 'http_500' } } });
    });
  });

  it('since 보다 이른 사실은 지난 시도의 것 — 버린다(운영자 다시 시도 뒤 늦게 온 거절)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await confirmFull(tx);
      const before = new Date(Date.now() - 60_000).toISOString();
      await w.manager.recordSettlementFailure(failure(id, { at: before }), tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ settlement: { state: 'in_progress' } });
      expect((await rowOf(tx, id)).metadata).not.toHaveProperty('settlement.lastFailure');
    });
  });

  it('정산이 끝난 요청·없는 id 에 온 정산 실패는 버린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmFull(tx);
      await w.salesOrders.cancel(seed.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-1' } }, tx);
      await w.settler.settleCancelled(seed.salesOrderId, tx);
      await w.manager.recordSettlementFailure(failure(id), tx);
      expect((await rowOf(tx, id)).status).toBe('applied');
      await expect(w.manager.recordSettlementFailure(failure('not-a-uuid'), tx)).resolves.toBeUndefined();
    });
  });
});
