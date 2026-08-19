import { NaverOrderSource } from './naver-order.source';

const changed = (productOrderId: string, orderId: string) => ({
  orderId,
  productOrderId,
  lastChangedType: 'PAYED' as const,
  lastChangedDate: '2026-08-19T01:00:00.000+09:00',
  productOrderStatus: 'PAYED' as const,
});

const detail = (productOrderId: string, orderId: string, overrides: Record<string, unknown> = {}) => ({
  order: { orderId, paymentDate: '2026-08-19T00:00:00.000+09:00', ordererName: '홍길동' },
  productOrder: {
    productOrderId,
    productOrderStatus: 'PAYED',
    productId: '13700000002',
    productName: '세럼',
    quantity: 1,
    unitPrice: 10000,
    totalPaymentAmount: 10000,
    shippingAddress: { name: '홍길동', tel1: '010', zipCode: '06236', baseAddress: '서울', detailedAddress: '1층' },
    ...overrides,
  },
});

describe('NaverOrderSource', () => {
  let client: any;
  let source: NaverOrderSource;

  beforeEach(() => {
    client = {
      getLastChangedStatuses: jest.fn(),
      getProductOrderIdsByOrderId: jest.fn(),
      getOrderDetails: jest.fn(),
    };
    source = new NaverOrderSource(client);
  });

  it('한 라인만 변경돼도 형제 라인을 복원해 주문 전체를 조립한다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2', 'po-3'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1'), detail('po-3', 'ord-1')],
    });

    const snapshots = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].lines.map((l) => l.channelOrderItemId)).toEqual(['po-1', 'po-2', 'po-3']);
    expect(snapshots[0].paymentState).toBe('accepted');
  });

  it('상세 응답이 요청보다 적으면 throw 한다 — 라인이 빠진 주문을 만들지 않는다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({ data: [detail('po-1', 'ord-1')] });

    await expect(source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'))).rejects.toThrow(/누락/);
  });

  it('more 를 따라 다음 페이지를 이어 받는다', async () => {
    client.getLastChangedStatuses
      .mockResolvedValueOnce({
        data: {
          count: 300,
          lastChangeStatuses: [changed('po-1', 'ord-1')],
          more: { moreFrom: '2026-08-19T02:00:00.000+09:00', moreSequence: '17' },
        },
      })
      .mockResolvedValueOnce({ data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-2')] } });
    client.getProductOrderIdsByOrderId.mockImplementation(async (orderId: string) => ({
      data: [orderId === 'ord-1' ? 'po-1' : 'po-2'],
    }));
    client.getOrderDetails.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) => detail(id, id === 'po-1' ? 'ord-1' : 'ord-2')),
    }));

    const snapshots = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(client.getLastChangedStatuses).toHaveBeenCalledTimes(2);
    expect(client.getLastChangedStatuses.mock.calls[1][0]).toMatchObject({
      lastChangedFrom: '2026-08-19T02:00:00.000+09:00',
      moreSequence: '17',
    });
    expect(snapshots.map((s) => s.externalOrderId).sort()).toEqual(['ord-1', 'ord-2']);
  });

  it('취소 요청 중이면 accepted 로 보지 않는다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1', { claimStatus: 'CANCEL_REQUEST' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));
    expect(snapshot.paymentState).toBe('pending');
  });

  it('일부 라인만 취소면 라인 단위 부분취소 관측을 낸다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1', { productOrderStatus: 'CANCELED' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshot.paymentState).toBe('accepted');
    expect(snapshot.lines.find((l) => l.channelOrderItemId === 'po-2')?.cancelled).toBe(true);
    expect(snapshot.lifecycle).toHaveLength(1);
    expect(snapshot.lifecycle[0].eventKey).toBe('cancelled:po-2');
    expect(snapshot.lifecycle[0].payload).toMatchObject({
      cancelledLines: [{ channelOrderItemId: 'po-2', quantity: 1 }],
    });
  });

  it('전 라인 취소면 전체 취소 1건이고 terminal 이다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1', { productOrderStatus: 'CANCELED' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshot.paymentState).toBe('terminal');
    expect(snapshot.lifecycle).toHaveLength(1);
    expect(snapshot.lifecycle[0].eventKey).toBe('cancelled');
    expect((snapshot.lifecycle[0].payload as Record<string, unknown>).cancelledLines).toBeUndefined();
  });

  it('sourceUpdatedAt 은 채널이 말한 변경 시각이다 — 현재 시각을 쓰면 워터마크가 창을 건너뛴다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: {
        count: 1,
        lastChangeStatuses: [
          { ...changed('po-1', 'ord-1'), lastChangedDate: '2026-08-19T01:00:00.000+09:00' },
          { ...changed('po-2', 'ord-1'), lastChangedDate: '2026-08-19T03:00:00.000+09:00' },
        ],
      },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({ data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1')] });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    // 한 주문의 여러 라인이 바뀌면 가장 늦은 시각을 취한다.
    expect(snapshot.sourceUpdatedAt).toBe('2026-08-19T03:00:00.000+09:00');
  });

  it('워터마크가 없으면 최근 1시간을, 오래됐으면 24시간 창을 조회한다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({ data: { count: 0, lastChangeStatuses: [] } });

    await source.fetchOrders(null);
    const firstCall = client.getLastChangedStatuses.mock.calls[0][0];
    expect(firstCall.lastChangedTo).toBeUndefined();

    const old = new Date(Date.now() - 72 * 60 * 60 * 1000);
    await source.fetchOrders(old);
    const secondCall = client.getLastChangedStatuses.mock.calls[1][0];
    const from = new Date(secondCall.lastChangedFrom).getTime();
    const to = new Date(secondCall.lastChangedTo).getTime();
    expect(to - from).toBe(24 * 60 * 60 * 1000);
  });
});
