import { StoreReturnExchangeService } from './store-return-exchange.service';

function harness(soRow: Record<string, unknown> | undefined) {
  const query = {
    from: () => query,
    where: () => query,
    limit: () => Promise.resolve(soRow ? [soRow] : []),
  };
  const tx = { select: jest.fn(() => query) };
  const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new StoreReturnExchangeService({} as never, {} as never, publisher as never);
  const progress = (claim: Record<string, unknown>) =>
    (
      service as unknown as { enqueueClaimProgress: (tx: unknown, claim: unknown) => Promise<void> }
    ).enqueueClaimProgress(tx, { salesOrderId: 'so-1', occurredAt: new Date('2026-09-22T01:00:00.000Z'), ...claim });
  return { publisher, progress };
}

const medusaOrder = {
  channelOrderId: 'order_01',
  displayOrderNo: '3900',
  salesChannel: 'medusa',
  customerId: 'user-1',
  customerEmail: 'buyer@example.com',
  customerName: '홍길동',
};

describe('반품·교환 진행 → SalesOrderClaimProgressed', () => {
  it('자사몰 회원 주문이면 종류·단계·요청 주체와 받는 사람을 담아 싣는다', async () => {
    const { publisher, progress } = harness(medusaOrder);

    await progress({ kind: 'return', stage: 'requested', requestId: 'rr-1', requestedBy: 'admin' });

    expect(publisher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'so-claim:return:rr-1:requested',
        eventType: 'SalesOrderClaimProgressed',
        payload: expect.objectContaining({
          displayOrderNo: '3900',
          customerEmail: 'buyer@example.com',
          kind: 'return',
          stage: 'requested',
          requestedBy: 'admin',
        }),
      }),
      expect.anything(),
    );
  });

  it('외부 채널 주문이나 회원이 아닌 주문은 싣지 않는다', async () => {
    const naver = harness({ ...medusaOrder, salesChannel: 'naver' });
    await naver.progress({ kind: 'exchange', stage: 'collected', requestId: 'er-1' });
    expect(naver.publisher.enqueue).not.toHaveBeenCalled();

    const guest = harness({ ...medusaOrder, customerId: null });
    await guest.progress({ kind: 'exchange', stage: 'completed', requestId: 'er-1' });
    expect(guest.publisher.enqueue).not.toHaveBeenCalled();
  });
});
