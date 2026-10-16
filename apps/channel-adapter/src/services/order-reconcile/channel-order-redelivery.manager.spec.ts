import type { OrderSyncFetch } from '../order-collection/channel-order-provider.interface';
import { ChannelOrderRedeliveryManager } from './channel-order-redelivery.manager';

const TX = Symbol('tx');
const createPayload = { orderId: 'fresh-uuid', externalOrderId: 'order_1', salesChannel: 'medusa' };
const cancelItem = {
  eventType: 'OrderCancelled' as const,
  externalOrderId: 'order_1',
  sourceUpdatedAt: '2026-10-16T00:00:00Z',
  eventKey: 'cancelled',
  rawEvent: {},
  payload: { reason: 'ADMIN_CANCEL', cancelledBy: 'medusa', cancelledAt: '2026-10-16T00:00:00Z', refundRequired: false },
};
const fetched = (lifecycle: unknown[] = [], eligibleForOrderCreation = true): OrderSyncFetch =>
  ({ outcome: { kind: 'order', order: { createPayload, eligibleForOrderCreation } }, lifecycle }) as unknown as OrderSyncFetch;

function setup(opts: { mapping?: string; fetch?: OrderSyncFetch | null; enqueueThrows?: boolean } = {}) {
  const enqueue = jest.fn(async (_event: { eventType: string }, _tx?: unknown) => {
    if (opts.enqueueThrows) throw new Error('outbox down');
  });
  const recordAttempt = jest.fn(async () => undefined);
  const repo = {
    mappingsByExternalOrderId: jest.fn(async () => new Map(opts.mapping ? [['order_1', opts.mapping]] : [])),
    recordAttempt,
  };
  const provider = { channel: 'medusa', fetchOrders: jest.fn(), fetchOrderForSync: jest.fn(async () => opts.fetch ?? null) };
  const orchestrator = { syncOrder: jest.fn(async () => ({ outcome: 'created' })) };
  const db = { run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) };
  const manager = new ChannelOrderRedeliveryManager(
    [provider] as never,
    { enqueue } as never,
    repo as never,
    orchestrator as never,
    db as never,
  );
  return { manager, enqueue, recordAttempt, orchestrator, provider };
}
const finding = (kind: 'missing_order' | 'cancel_not_applied') => ({
  id: 'f1',
  channel: 'medusa',
  externalOrderId: 'order_1',
  kind,
});

describe('ChannelOrderRedeliveryManager', () => {
  it('missing_order · 매핑 없음 → 폴링과 같은 syncOrder', async () => {
    const { manager, orchestrator, recordAttempt, enqueue } = setup();
    await expect(manager.redeliver(finding('missing_order'))).resolves.toBe('created');
    expect(orchestrator.syncOrder).toHaveBeenCalledWith('medusa', 'order_1');
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith('f1', 'created');
  });

  it('missing_order · 매핑 있음 → 기존 wmsOrderId 로 OrderCreated, 적재와 시도 기록이 같은 tx', async () => {
    const { manager, enqueue, recordAttempt } = setup({ mapping: 'wms-1', fetch: fetched() });
    await expect(manager.redeliver(finding('missing_order'))).resolves.toBe('enqueued');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OrderCreated',
        aggregateId: 'wms-1',
        payload: expect.objectContaining({ orderId: 'wms-1', externalOrderId: 'order_1' }),
        partitionKey: 'medusa',
      }),
      TX,
    );
    expect(recordAttempt).toHaveBeenCalledWith('f1', 'enqueued', TX);
  });

  it('missing_order · 매핑 있음 · 채널 취소 → OrderCreated 뒤 OrderCancelled', async () => {
    const { manager, enqueue } = setup({ mapping: 'wms-1', fetch: fetched([cancelItem]) });
    await manager.redeliver(finding('missing_order'));
    expect(enqueue.mock.calls.map((call) => call[0].eventType)).toEqual(['OrderCreated', 'OrderCancelled']);
  });

  it('cancel_not_applied → 처음 본 것 검사 없이 OrderCancelled 를 채널 키와 함께', async () => {
    const { manager, enqueue } = setup({ mapping: 'wms-1', fetch: fetched([cancelItem]) });
    await expect(manager.redeliver(finding('cancel_not_applied'))).resolves.toBe('enqueued');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OrderCancelled',
        aggregateId: 'wms-1',
        payload: expect.objectContaining({ orderId: 'wms-1', salesChannel: 'medusa', externalOrderId: 'order_1' }),
      }),
      TX,
    );
  });

  it('cancel_not_applied 인데 채널에 취소 관측이 없으면 nothing_to_send', async () => {
    const { manager, enqueue, recordAttempt } = setup({ mapping: 'wms-1', fetch: fetched([]) });
    await expect(manager.redeliver(finding('cancel_not_applied'))).resolves.toBe('nothing_to_send');
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith('f1', 'nothing_to_send');
  });

  it('채널에서 주문을 못 찾으면 not_found', async () => {
    const { manager } = setup({ mapping: 'wms-1', fetch: null });
    await expect(manager.redeliver(finding('missing_order'))).resolves.toBe('not_found');
  });

  it('적재가 던지면 시도 기록도 남기지 않고 던진다(같은 tx 롤백)', async () => {
    const { manager, recordAttempt } = setup({ mapping: 'wms-1', fetch: fetched(), enqueueThrows: true });
    await expect(manager.redeliver(finding('missing_order'))).rejects.toThrow('outbox down');
    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it('다시 가져온 주문이 이제 수집 대상이 아니면(취소 없는 환불 등) 보내지 않는다 (리뷰 I-4)', async () => {
    const { manager, enqueue, recordAttempt } = setup({ mapping: 'wms-1', fetch: fetched([], false) });
    await expect(manager.redeliver(finding('missing_order'))).resolves.toBe('not_eligible');
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith('f1', 'not_eligible');
  });

  it('수집 대상이 아니어도 채널 취소가 있으면 SO 를 만들고 바로 취소한다(스펙 §5.3)', async () => {
    const { manager, enqueue } = setup({ mapping: 'wms-1', fetch: fetched([cancelItem], false) });
    await expect(manager.redeliver(finding('missing_order'))).resolves.toBe('enqueued');
    expect(enqueue.mock.calls.map((call) => call[0].eventType)).toEqual(['OrderCreated', 'OrderCancelled']);
  });
});
