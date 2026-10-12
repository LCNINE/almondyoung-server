// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.spec.ts
import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';

function makeRepository(rows: unknown[] = []) {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn((_condition: unknown) => ({ limit }));
  const select = jest.fn(() => ({ from: jest.fn(() => ({ where })) }));
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx'));
  const repository = new ChannelOrderCancelRepository({ db: { select, transaction } } as never, { enqueue } as never);
  return { repository, enqueue, where, transaction };
}

// and(eq(), eq()) 의 SQL 객체를 재귀로 걸어 컬럼 이름을 모은다 — 청크 중첩 깊이에 기대지 않는다
function collectColumnNames(node: unknown, seen = new Set<unknown>()): string[] {
  if (typeof node !== 'object' || node === null || seen.has(node)) return [];
  seen.add(node);
  const { name, queryChunks } = node as { name?: unknown; queryChunks?: unknown[] };
  const own = typeof name === 'string' ? [name] : [];
  return [...own, ...(queryChunks ?? []).flatMap((chunk) => collectColumnNames(chunk, seen))];
}

describe('ChannelOrderCancelRepository (#1016 35번 PR-B)', () => {
  const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };

  it('수집 매핑이 있으면 true, 없으면 false', async () => {
    await expect(makeRepository([{ id: 'm1' }]).repository.hasCollectedOrder('medusa', 'order_1')).resolves.toBe(true);
    await expect(makeRepository([]).repository.hasCollectedOrder('medusa', 'order_1')).resolves.toBe(false);
  });

  it('매핑은 채널과 채널 주문 id 둘 다로 찾는다', async () => {
    const { repository, where } = makeRepository([]);
    await repository.hasCollectedOrder('medusa', 'order_1');
    const columns = collectColumnNames(where.mock.calls[0][0]);
    expect(columns).toEqual(expect.arrayContaining(['sales_channel', 'channel_order_id']));
  });

  const fact = {
    ...key,
    scope: 'full' as const,
    retryable: false,
    failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
    message: '자동 환불할 수 없는 결제수단입니다',
    at: '2026-10-12T00:00:00.000Z',
  };

  it('정산 실패 사실을 채널 단위 파티션으로, 전달·코드 단위 멱등 키로 적재한다', async () => {
    const { repository, enqueue } = makeRepository();
    await repository.recordSettlementFailure(fact, 'd1');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      {
        eventType: 'ChannelOrderSettlementFailed',
        aggregateId: 'medusa:order_1',
        partitionKey: 'medusa',
        metadata: { partitionKey: 'medusa' },
        idempotencyKey: 'settlement-failed:req-1:d1:wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        payload: fact,
      },
      'tx',
    );
  });

  it('정산 실패 사실 하나만 적재한다 — 옛 사실(Rejected·Stalled)은 더 내지 않는다(PR 6)', async () => {
    const { repository, enqueue } = makeRepository();
    await repository.recordSettlementFailure(fact, 'd1');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({ eventType: 'ChannelOrderSettlementFailed' });
  });

  it('같은 전달이라도 failureCode 가 다르면 키가 다르다 — 재시도 중 일시 → 영구로 바뀐 결과를 먹지 않는다', async () => {
    const { repository, enqueue } = makeRepository();
    await repository.recordSettlementFailure({ ...fact, retryable: true, failureCode: 'http_500' }, 'd1');
    await repository.recordSettlementFailure(fact, 'd1');
    await repository.recordSettlementFailure(fact, 'd2');
    expect(enqueue.mock.calls.map(([event]) => event.idempotencyKey)).toEqual([
      'settlement-failed:req-1:d1:http_500',
      'settlement-failed:req-1:d1:wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
      'settlement-failed:req-1:d2:wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
    ]);
  });

  it('긴 failureCode 는 키에서 120자로 자른다 — 키 칸은 varchar(255)라 넘치면 적재가 매번 실패한다. 사실의 코드는 그대로다', async () => {
    const { repository, enqueue } = makeRepository();
    const longCode = `wallet_refund_refused:${'X'.repeat(400)}`;
    const requestId = '0192f0aa-0000-7000-8000-000000000001';
    const deliveryId = '0192f0aa-0000-7000-8000-000000000002';
    await repository.recordSettlementFailure({ ...fact, requestId, failureCode: longCode }, deliveryId);
    const [event] = enqueue.mock.calls[0];
    expect(event.idempotencyKey.length).toBeLessThanOrEqual(255);
    expect(event.idempotencyKey).toBe(`settlement-failed:${requestId}:${deliveryId}:${longCode.slice(0, 120)}`);
    expect(event.payload.failureCode).toBe(longCode);
  });

  it('적재가 실패하면 던진다 — 명령을 ack 하지 않고 재배달을 탄다', async () => {
    const { repository, enqueue } = makeRepository();
    enqueue.mockRejectedValueOnce(new Error('outbox down'));
    await expect(repository.recordSettlementFailure(fact, 'd1')).rejects.toThrow('outbox down');
  });
});
