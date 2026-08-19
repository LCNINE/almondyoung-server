import { Logger } from '@nestjs/common';
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

  // FIX 2 이후 `fetchOrders` 는 개별 주문 실패를 삼키고 건너뛴다(throw 하지 않는다) — 그래서
  // 이 throw 자체를 검증하려면 워터마크 경로가 아닌 replay 전용 `fetchOrder` 를 직접 불러야
  // 한다. `fetchOrder` 는 사람이 트리거하는 replay 라 여전히 그대로 throw 한다.
  it('상세 응답이 요청보다 적으면 throw 한다 — 라인이 빠진 주문을 만들지 않는다 (replay 경로 fetchOrder 로 검증)', async () => {
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({ data: [detail('po-1', 'ord-1')] });

    await expect(source.fetchOrder('ord-1')).rejects.toThrow(/누락/);
  });

  // 개수는 요청과 같지만(2건) 요청한 po-2 자리에 엉뚱한 po-9 가 대신 왔다 — 결손 쪽(po-2 없음)
  // 만으로도 throw 는 되지만, 이 케이스는 "신원 불일치" 를 대표하기보다 결손의 한 변형이다.
  // 개수는 같은데 응답이 요청보다 **많아지는**(초과분) 케이스는 별도 테스트가 따로 막는다.
  it('상세 응답 개수는 맞아도 요청한 id 대신 엉뚱한 id 가 왔으면(결손+치환) throw 하고 누락/예상외 id 를 메시지에 남긴다', async () => {
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    // 개수는 요청과 같은 2건이지만, 요청한 po-2 대신 엉뚱한 po-9 가 섞여 있다.
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1'), detail('po-9', 'ord-1')],
    });

    await expect(source.fetchOrder('ord-1')).rejects.toThrow(/누락.*\[po-2\].*예상외.*\[po-9\]/s);
  });

  // FIX 5 재보강: 신원(집합 포함) 검사만으로는 "요청한 id 가 응답에 다 있는가" 밖에 못 본다 —
  // 응답이 요청 전부 + 엉뚱한 id 하나(상위집합)여도 그 조건은 그대로 통과해, 요청하지 않은
  // 라인이 주문에 섞여 들어간다. 개수 비교를 다시 더해야 이 방향도 막힌다.
  it('상세 응답이 요청한 id 를 전부 포함하면서 엉뚱한 id 까지 더 얹혀 오면(초과분) throw 한다', async () => {
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1'), detail('po-9', 'ord-1')],
    });

    await expect(source.fetchOrder('ord-1')).rejects.toThrow(/누락.*예상외.*\[po-9\]/s);
  });

  it('세 주문 중 하나의 상세가 깨져도 나머지는 계속 수집하고 throw 하지 않는다 (한 주문 실패가 주기 전체를 막지 않는다, FIX 2)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: {
        count: 3,
        lastChangeStatuses: [changed('po-1', 'ord-1'), changed('po-2', 'ord-2'), changed('po-3', 'ord-3')],
      },
    });
    client.getProductOrderIdsByOrderId.mockImplementation(async (orderId: string) => ({
      data: [orderId === 'ord-1' ? 'po-1' : orderId === 'ord-2' ? 'po-2' : 'po-3'],
    }));
    client.getOrderDetails.mockImplementation(async (ids: string[]) => {
      const id = ids[0];
      if (id === 'po-2') {
        // 필수 필드(quantity) 가 없어 parseNaverProductOrderInfo 가 throw 하는 응답.
        return { data: [detail('po-2', 'ord-2', { quantity: undefined })] };
      }
      return { data: [detail(id, id === 'po-1' ? 'ord-1' : 'ord-3')] };
    });

    const snapshots = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshots.map((s) => s.externalOrderId).sort()).toEqual(['ord-1', 'ord-3']);
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

  it('부분취소면 금액 합계가 취소된 라인을 빼고 산출된다 — 안 그러면 Core 총액이 부풀려진다 (FIX 3)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1', { productOrderStatus: 'CANCELED' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    // 두 라인 다 포함하면 20000/20000 이 나온다 — 취소된 po-2 를 빼고 po-1 몫만 남아야 한다.
    expect(snapshot.amounts.total).toBe(10000);
    expect(snapshot.amounts.subtotal).toBe(10000);
    expect(snapshot.amounts.shipping).toBe(0);
  });

  it('ADMIN_CANCELING(관리자 취소 진행중) claim 도 취소요청과 같이 accepted 로 보지 않는다 (FIX 6)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1', { claimStatus: 'ADMIN_CANCELING' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));
    expect(snapshot.paymentState).toBe('pending');
  });

  it('라인별 배송지가 서로 다르면 경고 로그를 남기고 첫 라인 배송지를 대표값으로 쓴다 (FIX 7)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      client.getLastChangedStatuses.mockResolvedValue({
        data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
      });
      client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
      client.getOrderDetails.mockResolvedValue({
        data: [
          detail('po-1', 'ord-1'),
          detail('po-2', 'ord-1', {
            shippingAddress: {
              name: '김철수',
              tel1: '011',
              zipCode: '12345',
              baseAddress: '부산',
              detailedAddress: '2층',
            },
          }),
        ],
      });

      const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

      // Core 계약은 주문당 배송지 하나 — infos[0](po-1) 이 대표값으로 유지된다.
      expect(snapshot.shippingAddress.roadAddress).toBe('서울');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('배송지가 서로 다르다'));
    } finally {
      warnSpy.mockRestore();
    }
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

  // FIX B: 반품/교환은 취소가 아니다. `OrderCancelled` 로 내보내면 Core 의 출고 증거 가드가
  // BadRequestException 을 던지고, non-retryable 이라 DLQ 로 사라진다 — 신호가 소멸한다.
  it('반품/교환 라인은 계약에서 빠지지만 취소 관측을 내지 않는다 (FIX B)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2', 'po-3'] });
    client.getOrderDetails.mockResolvedValue({
      data: [
        detail('po-1', 'ord-1'),
        detail('po-2', 'ord-1', { productOrderStatus: 'RETURNED' }),
        detail('po-3', 'ord-1', { productOrderStatus: 'EXCHANGED' }),
      ],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    // 계약에서는 빠진다(살아있는 라인은 po-1 뿐).
    expect(snapshot.lines.find((l) => l.channelOrderItemId === 'po-2')?.cancelled).toBe(true);
    expect(snapshot.lines.find((l) => l.channelOrderItemId === 'po-3')?.cancelled).toBe(true);
    expect(snapshot.amounts.total).toBe(10000);
    // 하지만 취소 관측은 하나도 나가지 않는다.
    expect(snapshot.lifecycle).toEqual([]);
  });

  it('전 라인이 반품이면 terminal 이되 취소 이벤트는 없다 (FIX B)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1', { productOrderStatus: 'RETURNED' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshot.paymentState).toBe('terminal');
    expect(snapshot.lifecycle).toEqual([]);
  });

  it('취소와 반품이 섞이면 취소된 라인만 라인 단위 관측을 낸다 (FIX B)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({
      data: [
        detail('po-1', 'ord-1', { productOrderStatus: 'CANCELED' }),
        detail('po-2', 'ord-1', { productOrderStatus: 'RETURNED' }),
      ],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    // 전 라인이 계약에서 빠졌으므로 terminal 이지만, 전체취소 1건으로 접으면 반품 라인까지
    // 취소하는 셈이 된다 — 취소로 관측된 라인만 부분취소로 낸다.
    expect(snapshot.paymentState).toBe('terminal');
    expect(snapshot.lifecycle).toHaveLength(1);
    expect(snapshot.lifecycle[0].eventKey).toBe('cancelled:po-1');
  });

  // FIX C: `changes.totalAmount` 는 해시 입력이라 취소로 흔들리면 안 된다.
  it('allLinesTotal 은 취소 라인을 포함해 취소 전후로 값이 같다 (FIX C)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });

    client.getOrderDetails.mockResolvedValueOnce({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1')],
    });
    const [before] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    client.getOrderDetails.mockResolvedValueOnce({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1', { productOrderStatus: 'CANCELED' })],
    });
    const [after] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(before.amounts.allLinesTotal).toBe(20000);
    expect(after.amounts.allLinesTotal).toBe(20000);
    // 계약 총액은 반대로 취소분을 뺀다 — 두 값의 목적이 다르다는 것이 요점이다.
    expect(after.amounts.total).toBe(10000);
  });

  // FIX G: 조용한 null 은 그 주문을 영영 잃는다 — 같은 폴의 다른 항목이 워터마크를 밀기 때문.
  it('상품주문 id 목록이 비면 경고를 남기고 throw 한다 (FIX G)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      client.getProductOrderIdsByOrderId.mockResolvedValue({ data: [] });

      await expect(source.fetchOrder('ord-1')).rejects.toThrow(/id 목록이 비었다/);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('상품주문 id 목록이 비어 있다'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('id 목록이 빈 주문은 주기를 멈추지 않고 건너뛴다 — 워터마크는 그 주문 뒤로 가지 않는다 (FIX G)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 2, lastChangeStatuses: [changed('po-1', 'ord-1'), changed('po-2', 'ord-2')] },
    });
    client.getProductOrderIdsByOrderId.mockImplementation(async (orderId: string) => ({
      data: orderId === 'ord-1' ? [] : ['po-2'],
    }));
    client.getOrderDetails.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) => detail(id, 'ord-2')),
    }));

    const snapshots = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshots.map((s) => s.externalOrderId)).toEqual(['ord-2']);
  });

  // FIX H: shadow 점검이 `raw_order` 로 네이버 실제 필드명을 확정한다 — 파싱 결과를 넣으면
  // 우리가 이미 안다고 가정한 이름만 되비쳐 그 점검이 성립하지 않는다.
  it('raw 에는 파싱 결과가 아니라 채널 원본 응답이 담긴다 (FIX H)', async () => {
    const rawDetail = detail('po-1', 'ord-1', { 옵션단위식별자후보: 'opt-9', 알수없는필드: { a: 1 } });
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1'] });
    client.getOrderDetails.mockResolvedValue({ data: [rawDetail] });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    const raw = snapshot.raw as { productOrders: unknown[] };
    expect(raw.productOrders).toEqual([rawDetail]);
    // 파서가 만들어내는 평면 필드(channelProductId 등)가 raw 에 섞이면 안 된다.
    expect(raw.productOrders[0]).not.toHaveProperty('channelProductId');
    expect((raw.productOrders[0] as Record<string, any>).productOrder).toHaveProperty('옵션단위식별자후보', 'opt-9');
  });

  // FIX I: `OrderCancelledSchema.cancelledLines[].quantity` 는 양수를 요구한다.
  it('수량이 0 인 취소 라인은 취소 관측을 내지 않는다 (FIX I)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1', { productOrderStatus: 'CANCELED', quantity: 0 })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshot.lines.find((l) => l.channelOrderItemId === 'po-2')?.cancelled).toBe(true);
    expect(snapshot.lifecycle).toEqual([]);
  });

  // FIX F: 닫힌 창에 변경이 0건이면 워터마크가 영원히 그 창에 묶인다.
  it('닫힌 창을 끝까지 훑었으면 항목이 없어도 창의 끝을 보고한다 (FIX F)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({ data: { count: 0, lastChangeStatuses: [] } });

    const since = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const { snapshots, completedWindowEnd } = await source.fetchOrdersInWindow(since);

    expect(snapshots).toEqual([]);
    expect(completedWindowEnd?.getTime()).toBe(since.getTime() + 24 * 60 * 60 * 1000);
  });

  it('창이 아직 열려 있으면(now 에서 끝나면) 창의 끝을 보고하지 않는다 (FIX F)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({ data: { count: 0, lastChangeStatuses: [] } });

    const { completedWindowEnd } = await source.fetchOrdersInWindow(new Date(Date.now() - 10 * 60 * 1000));

    expect(completedWindowEnd).toBeNull();
  });

  // FIX F × FIX G 의 접점: 창의 주문이 전부 실패하면 스냅샷이 0건이라 오케스트레이터가
  // "변경 없음" 갈래로 들어간다. 거기서 창의 끝까지 워터마크를 밀면 실패한 주문이 조회 범위
  // 밖으로 빠져 영영 사라진다 — FIX G 가 막으려던 손실이 다른 문으로 되돌아온다.
  it('주문 수집이 실패한 주기에는 창을 다 봤다고 말하지 않는다 (FIX F × FIX G)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: [] });

    const { snapshots, completedWindowEnd } = await source.fetchOrdersInWindow(
      new Date(Date.now() - 72 * 60 * 60 * 1000),
    );

    expect(snapshots).toEqual([]);
    expect(completedWindowEnd).toBeNull();
  });

  it('페이징이 상한에서 잘리면 창을 다 봤다고 말하지 않는다 (FIX F)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: {
        count: 300,
        lastChangeStatuses: [],
        more: { moreFrom: '2026-08-19T02:00:00.000+09:00', moreSequence: '17' },
      },
    });

    const { completedWindowEnd } = await source.fetchOrdersInWindow(new Date(Date.now() - 72 * 60 * 60 * 1000));

    expect(completedWindowEnd).toBeNull();
  });

  it('워터마크가 없으면 최근 1시간을, 오래됐으면 24시간 창을 조회한다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({ data: { count: 0, lastChangeStatuses: [] } });

    await source.fetchOrders(null);
    const firstCall = client.getLastChangedStatuses.mock.calls[0][0];
    expect(firstCall.lastChangedTo).toBeUndefined();

    const old = new Date(Date.now() - 72 * 60 * 60 * 1000);
    await source.fetchOrders(old);
    const secondCall = client.getLastChangedStatuses.mock.calls[1][0];
    // 24시간은 한 창의 "길이" 이지 "허용 과거" 가 아니다 — `since` 를 `now - 24h` 로 앞당기면
    // 안 되고, 실제로 넘긴 워터마크 값 그대로에서 창을 시작해야 한다 (FIX 4). 창 길이만 보면
    // `since` 를 `now - 24h` 로 클램프하는 회귀도 통과해버린다 — 시작점 자체를 값으로 고정한다.
    expect(secondCall.lastChangedFrom).toBe(old.toISOString());
    const from = new Date(secondCall.lastChangedFrom).getTime();
    const to = new Date(secondCall.lastChangedTo).getTime();
    expect(to - from).toBe(24 * 60 * 60 * 1000);
  });
});
