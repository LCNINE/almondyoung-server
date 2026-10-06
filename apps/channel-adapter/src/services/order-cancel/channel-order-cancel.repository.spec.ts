// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.spec.ts
import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';

function makeRepository(rows: unknown[] = []) {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn((_condition: unknown) => ({ limit }));
  const select = jest.fn(() => ({ from: jest.fn(() => ({ where })) }));
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx'));
  const repository = new ChannelOrderCancelRepository({ db: { select, transaction } } as never, { enqueue } as never);
  return { repository, enqueue, where };
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

  it('거절 사실은 같은 전달에서 한 번만, 채널 단위 파티션으로 적재한다', async () => {
    const { repository, enqueue } = makeRepository();
    const payload = { ...key, reasonCode: 'NOT_CANCELABLE' as const, message: '출고됨' };
    await repository.recordRejected(payload, 'd1');
    expect(enqueue).toHaveBeenCalledWith(
      {
        eventType: 'ChannelOrderCancelRejected',
        aggregateId: 'medusa:order_1',
        partitionKey: 'medusa',
        metadata: { partitionKey: 'medusa' },
        idempotencyKey: 'cancel-rejected:req-1:d1',
        payload,
      },
      'tx',
    );
  });

  it('정체 사실도 같은 전달에서 한 번만 적재한다', async () => {
    const { repository, enqueue } = makeRepository();
    const payload = { ...key, stage: 'edited' as const, message: '환불 미완' };
    await repository.recordStalled(payload, 'd1');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ChannelOrderCancelStalled',
        idempotencyKey: 'cancel-stalled:req-1:d1',
        partitionKey: 'medusa',
        payload,
      }),
      'tx',
    );
  });

  it('같은 requestId 도 전달(messageId)이 다르면 멱등 키가 달라 다시 보내기가 사실을 다시 낸다', async () => {
    const { repository, enqueue } = makeRepository();
    const rejected = { ...key, reasonCode: 'NOT_CANCELABLE' as const, message: '출고됨' };
    const stalled = { ...key, stage: 'edited' as const, message: '환불 미완' };
    await repository.recordRejected(rejected, 'd1');
    await repository.recordRejected(rejected, 'd2');
    await repository.recordStalled(stalled, 'd1');
    await repository.recordStalled(stalled, 'd2');
    const keys = enqueue.mock.calls.map(([event]) => event.idempotencyKey);
    expect(keys).toEqual([
      'cancel-rejected:req-1:d1',
      'cancel-rejected:req-1:d2',
      'cancel-stalled:req-1:d1',
      'cancel-stalled:req-1:d2',
    ]);
    expect(new Set(keys).size).toBe(4);
  });
});
