import { Logger } from '@nestjs/common';
import type { GetReturnRequestsParams } from '../../zods/coupang';
import { CoupangCancelReceiptReader, CoupangOrderSheetReader, CoupangOrderSource } from './coupang-order.source';

// 🔒 전부 가짜 값이다 — 실제 쿠팡 응답(수취인·주소·연락처·주문번호)을 커밋하지 않는다.
const NOW = new Date('2026-11-11T03:00:00.000Z'); // KST 2026-11-11 12:00
const ORDER_A = '200000000000000001';
const ORDER_B = '200000000000000002';
const BOX_A1 = '100000000000000001';
const BOX_A2 = '100000000000000002';
const BOX_B1 = '100000000000000003';

const money = (units: number) => ({ currencyCode: 'KRW', units, nanos: 0 });

const item = (vendorItemId: number, overrides: Record<string, unknown> = {}) => ({
  vendorItemId,
  vendorItemName: `테스트 상품 ${vendorItemId}`,
  shippingCount: 2,
  cancelCount: 0,
  holdCountForCancel: 0,
  salesPrice: money(10000),
  orderPrice: money(20000),
  ...overrides,
});

const sheet = (
  orderId: string,
  shipmentBoxId: string,
  status: string,
  orderItems: unknown[],
  overrides: Record<string, unknown> = {},
) => ({
  shipmentBoxId,
  orderId,
  status,
  orderedAt: '2026-11-11T09:00:00',
  paidAt: '2026-11-11T09:05:00',
  shippingPrice: money(3000),
  receiver: {
    name: '테스트수취인',
    safeNumber: '050-0000-0000',
    receiverNumber: null,
    addr1: '서울시 테스트구 1',
    addr2: '2층',
    postCode: '00000',
  },
  orderItems,
  ...overrides,
});

const receipt = (
  receiptId: string,
  orderId: string,
  receiptStatus: string,
  returnItems: Array<{ vendorItemId: number; cancelCount: number }>,
) => ({
  receiptId,
  orderId,
  receiptType: 'CANCEL',
  receiptStatus,
  createdAt: '2026-11-11T10:00:00',
  cancelCountSum: returnItems.reduce((sum, entry) => sum + entry.cancelCount, 0),
  returnItems: returnItems.map((entry) => ({ ...entry, vendorItemName: '테스트 상품', purchaseCount: 2 })),
});

describe('CoupangOrderSource', () => {
  let sheetsByStatus: Record<string, unknown[]>;
  let singleSheets: Record<string, unknown[]>;
  let stopRequests: unknown[];
  let instantCancels: unknown[];
  let getAllOrderSheetsByStatus: jest.Mock<Promise<readonly unknown[]>, [string, string, string]>;
  let getSingleOrderSheetByOrderId: jest.Mock<Promise<{ data?: readonly unknown[] | null }>, [string]>;
  let getReturnRequests: jest.Mock<
    Promise<{ data?: readonly unknown[] | null; nextToken?: string }>,
    [GetReturnRequestsParams]
  >;
  let source: CoupangOrderSource;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    sheetsByStatus = { ACCEPT: [], INSTRUCT: [] };
    singleSheets = {};
    stopRequests = [];
    instantCancels = [];
    getAllOrderSheetsByStatus = jest.fn((_from: string, _to: string, status: string) =>
      Promise.resolve(sheetsByStatus[status] ?? []),
    );
    getSingleOrderSheetByOrderId = jest.fn((orderId: string) => Promise.resolve({ data: singleSheets[orderId] ?? [] }));
    getReturnRequests = jest.fn((params: GetReturnRequestsParams) =>
      Promise.resolve({ data: params.cancelType === 'CANCEL' ? instantCancels : stopRequests }),
    );
    const orderClient: CoupangOrderSheetReader = { getAllOrderSheetsByStatus, getSingleOrderSheetByOrderId };
    const returnClient: CoupangCancelReceiptReader = { getReturnRequests };
    source = new CoupangOrderSource(orderClient, returnClient);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('결제완료 주문은 accepted, 줄 키는 orderId:vendorItemId', async () => {
    sheetsByStatus.ACCEPT = [
      sheet(ORDER_A, BOX_A1, 'ACCEPT', [
        item(300000001),
        item(300000002, { shippingCount: 1, orderPrice: money(10000) }),
      ]),
    ];

    const { snapshots, fetchFailures } = await source.fetchOrdersInWindow(new Date('2026-11-11T02:00:00.000Z'));

    expect(fetchFailures).toEqual([]);
    expect(snapshots).toHaveLength(1);
    const [snapshot] = snapshots;
    expect(snapshot.externalOrderId).toBe(ORDER_A);
    expect(snapshot.paymentState).toBe('accepted');
    expect(snapshot.customerId).toBeNull();
    expect(snapshot.lines).toEqual([
      {
        channelOrderItemId: `${ORDER_A}:300000001`,
        channelProductId: '300000001',
        productName: '테스트 상품 300000001',
        quantity: 2,
        unitPrice: 10000,
      },
      {
        channelOrderItemId: `${ORDER_A}:300000002`,
        channelProductId: '300000002',
        productName: '테스트 상품 300000002',
        quantity: 1,
        unitPrice: 10000,
      },
    ]);
    expect(snapshot.amounts).toEqual({
      total: 33000,
      subtotal: 30000,
      shipping: 3000,
      discount: 0,
      currency: 'KRW',
      allLinesTotal: 33000,
    });
    expect(snapshot.shippingAddress).toEqual({
      recipientName: '테스트수취인',
      phone: '050-0000-0000',
      postalCode: '00000',
      roadAddress: '서울시 테스트구 1',
      detailAddress: '2층',
    });
    // 첫 상자 결제 시각(offset 없음 → KST) 을 UTC ISO 로.
    expect(snapshot.createdAt).toBe('2026-11-11T00:05:00.000Z');
    expect(snapshot.sourceUpdatedAt).toBe(NOW.toISOString());
    expect(snapshot.lifecycle).toEqual([]);
    expect(snapshot.orderCancelled).toBeUndefined();
    expect(snapshot.raw).toEqual({ externalOrderId: ORDER_A, orderSheets: sheetsByStatus.ACCEPT, cancelReceipts: [] });

    // 결제완료·상품준비중은 지금−31일 ~ 지금, 일 단위(KST).
    expect(getAllOrderSheetsByStatus).toHaveBeenCalledWith('2026-10-11+09:00', '2026-11-11+09:00', 'ACCEPT');
    expect(getAllOrderSheetsByStatus).toHaveBeenCalledWith('2026-10-11+09:00', '2026-11-11+09:00', 'INSTRUCT');
    expect(getReturnRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RU',
        cancelType: 'RETURN',
        createdAtFrom: '2026-10-11',
        createdAtTo: '2026-11-11',
      }),
    );
  });

  it('상품준비중뿐인 주문은 pending — 셀메이트 몫이면 만들지 않는다', async () => {
    sheetsByStatus.INSTRUCT = [sheet(ORDER_A, BOX_A1, 'INSTRUCT', [item(300000001)])];

    const { snapshots } = await source.fetchOrdersInWindow(null);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].paymentState).toBe('pending');
  });

  it('상자 둘 중 하나가 아직 결제완료면 주문은 accepted', async () => {
    sheetsByStatus.ACCEPT = [sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001)])];
    sheetsByStatus.INSTRUCT = [
      sheet(ORDER_A, BOX_A2, 'INSTRUCT', [item(300000002)], { shippingPrice: money(2500) }),
      sheet(ORDER_B, BOX_B1, 'INSTRUCT', [item(300000003)]),
    ];

    const { snapshots } = await source.fetchOrdersInWindow(null);

    const orderA = snapshots.find((snapshot) => snapshot.externalOrderId === ORDER_A);
    expect(orderA?.paymentState).toBe('accepted');
    expect(orderA?.lines.map((line) => line.channelOrderItemId)).toEqual([
      `${ORDER_A}:300000001`,
      `${ORDER_A}:300000002`,
    ]);
    expect(orderA?.amounts.shipping).toBe(5500);
    expect(snapshots.find((snapshot) => snapshot.externalOrderId === ORDER_B)?.paymentState).toBe('pending');
  });

  it('같은 상자가 두 스캔에 다 잡혀도(스캔 사이 상태 전이) 한 번만 센다', async () => {
    sheetsByStatus.ACCEPT = [sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001)])];
    sheetsByStatus.INSTRUCT = [sheet(ORDER_A, BOX_A1, 'INSTRUCT', [item(300000001)])];

    const { snapshots, fetchFailures } = await source.fetchOrdersInWindow(null);

    expect(fetchFailures).toEqual([]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].lines).toHaveLength(1);
  });

  it('부분 취소 확정은 줄 단위 OrderCancelled, 수량은 cancelCount', async () => {
    sheetsByStatus.INSTRUCT = [
      sheet(ORDER_A, BOX_A1, 'INSTRUCT', [
        item(300000001, { shippingCount: 3, cancelCount: 1, orderPrice: money(30000) }),
        item(300000002, { shippingCount: 1, cancelCount: 1, orderPrice: money(10000) }),
        item(300000003, { shippingCount: 1, orderPrice: money(10000) }),
      ]),
    ];

    const { snapshots } = await source.fetchOrdersInWindow(null);

    const [snapshot] = snapshots;
    expect(snapshot.paymentState).toBe('pending');
    // 줄 수량은 원 수량, 전량 취소된 줄만 cancelled.
    expect(snapshot.lines.map((line) => [line.channelOrderItemId, line.quantity, line.cancelled ?? false])).toEqual([
      [`${ORDER_A}:300000001`, 3, false],
      [`${ORDER_A}:300000002`, 1, true],
      [`${ORDER_A}:300000003`, 1, false],
    ]);
    // 살아 있는 수량(2 + 0 + 1) × 10000 + 배송비 3000 / 전 품목 orderPrice 합 + 배송비.
    expect(snapshot.amounts.total).toBe(33000);
    expect(snapshot.amounts.allLinesTotal).toBe(53000);
    expect(snapshot.orderCancelled).toBeUndefined();
    expect(snapshot.lifecycle).toEqual([
      {
        eventType: 'OrderCancelled',
        eventKey: `cancelled:${ORDER_A}:300000001:1`,
        payload: {
          reason: 'CUSTOMER_REQUEST',
          reasonDetail: expect.any(String),
          cancelledBy: 'coupang',
          cancelledAt: NOW.toISOString(),
          refundRequired: false,
          cancelledLines: [{ channelOrderItemId: `${ORDER_A}:300000001`, quantity: 1 }],
        },
        rawEvent: expect.objectContaining({ vendorItemId: '300000001', cancelCount: 1 }),
      },
      {
        eventType: 'OrderCancelled',
        eventKey: `cancelled:${ORDER_A}:300000002:1`,
        payload: expect.objectContaining({
          cancelledLines: [{ channelOrderItemId: `${ORDER_A}:300000002`, quantity: 1 }],
        }),
        rawEvent: expect.objectContaining({ vendorItemId: '300000002' }),
      },
    ]);
  });

  it('전 품목 전량 취소면 주문 단위 OrderCancelled 한 건과 terminal', async () => {
    singleSheets[ORDER_A] = [sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001, { cancelCount: 2 })])];
    instantCancels = [
      receipt('500000000000000001', ORDER_A, 'CANCEL_REQUEST', [{ vendorItemId: 300000001, cancelCount: 2 }]),
    ];

    const { snapshots } = await source.fetchOrdersInWindow(null);

    const [snapshot] = snapshots;
    // 상자가 결제완료로 남아 있어도 전량 취소된 주문은 만들 판매주문이 없다.
    expect(snapshot.paymentState).toBe('terminal');
    expect(snapshot.orderCancelled).toBe(true);
    expect(snapshot.amounts.total).toBe(3000);
    expect(snapshot.lifecycle).toEqual([
      {
        eventType: 'OrderCancelled',
        eventKey: 'cancelled',
        payload: {
          reason: 'CUSTOMER_REQUEST',
          reasonDetail: expect.any(String),
          cancelledBy: 'coupang',
          cancelledAt: NOW.toISOString(),
          refundRequired: false,
        },
        rawEvent: expect.any(Object),
      },
    ]);
  });

  it('holdCountForCancel 만 있으면 취소 관측을 내지 않는다', async () => {
    sheetsByStatus.INSTRUCT = [sheet(ORDER_A, BOX_A1, 'INSTRUCT', [item(300000001, { holdCountForCancel: 1 })])];

    const { snapshots } = await source.fetchOrdersInWindow(null);

    expect(snapshots[0].lifecycle).toEqual([]);
    expect(snapshots[0].lines[0].cancelled).toBeUndefined();
  });

  it('출고중지요청은 receiptId 를 참조·키로 한 ChannelCancelRequested', async () => {
    sheetsByStatus.INSTRUCT = [sheet(ORDER_A, BOX_A1, 'INSTRUCT', [item(300000001), item(300000002)])];
    stopRequests = [
      receipt('500000000000000001', ORDER_A, 'RELEASE_STOP_UNCHECKED', [
        { vendorItemId: 300000001, cancelCount: 2 },
        { vendorItemId: 300000002, cancelCount: 0 },
      ]),
      receipt('500000000000000002', ORDER_A, 'RETURNS_UNCHECKED', [{ vendorItemId: 300000002, cancelCount: 1 }]),
    ];

    const { snapshots } = await source.fetchOrdersInWindow(null);

    expect(getSingleOrderSheetByOrderId).not.toHaveBeenCalled();
    const [snapshot] = snapshots;
    expect(snapshot.lifecycle).toEqual([
      {
        eventType: 'ChannelCancelRequested',
        eventKey: 'cancel-request:500000000000000001',
        payload: {
          channelRequestRef: '500000000000000001',
          channelRequestKey: '500000000000000001',
          needsApproval: true,
          requestedAt: '2026-11-11T01:00:00.000Z',
          // 수량 0 인 품목은 싣지 않는다(계약은 양수).
          items: [{ channelOrderItemId: `${ORDER_A}:300000001`, quantity: 2 }],
        },
        rawEvent: expect.objectContaining({ receiptId: '500000000000000001', cancelCountSum: 2 }),
      },
      {
        eventType: 'ChannelCancelRequested',
        eventKey: 'cancel-request:500000000000000002',
        payload: expect.objectContaining({
          channelRequestRef: '500000000000000002',
          needsApproval: false,
          items: [{ channelOrderItemId: `${ORDER_A}:300000002`, quantity: 1 }],
        }),
        rawEvent: expect.any(Object),
      },
    ]);
    expect(snapshot.raw).toEqual({
      externalOrderId: ORDER_A,
      orderSheets: sheetsByStatus.INSTRUCT,
      cancelReceipts: stopRequests,
    });
  });

  it('스캔에 없는 주문의 출고중지요청은 단건 조회로 스냅샷을 만든다', async () => {
    singleSheets[ORDER_B] = [sheet(ORDER_B, BOX_B1, 'DEPARTURE', [item(300000003)])];
    stopRequests = [
      receipt('500000000000000003', ORDER_B, 'RELEASE_STOP_UNCHECKED', [{ vendorItemId: 300000003, cancelCount: 2 }]),
    ];

    const { snapshots, fetchFailures } = await source.fetchOrdersInWindow(null);

    expect(getSingleOrderSheetByOrderId).toHaveBeenCalledWith(ORDER_B);
    expect(fetchFailures).toEqual([]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].externalOrderId).toBe(ORDER_B);
    expect(snapshots[0].paymentState).toBe('pending');
    expect(snapshots[0].lifecycle.map((observation) => observation.eventKey)).toEqual([
      'cancel-request:500000000000000003',
    ]);
  });

  it('단건 조회가 실패하면 그 주문만 fetchFailures 로 간다', async () => {
    sheetsByStatus.ACCEPT = [sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001)])];
    stopRequests = [
      receipt('500000000000000003', ORDER_B, 'RELEASE_STOP_UNCHECKED', [{ vendorItemId: 300000003, cancelCount: 1 }]),
    ];
    getSingleOrderSheetByOrderId.mockRejectedValue(new Error('쿠팡 500'));

    const { snapshots, fetchFailures, completedWindowEnd } = await source.fetchOrdersInWindow(null);

    expect(snapshots.map((snapshot) => snapshot.externalOrderId)).toEqual([ORDER_A]);
    expect(fetchFailures).toEqual([
      { externalOrderId: ORDER_B, changedAt: NOW.toISOString(), error: expect.stringContaining('쿠팡 500') },
    ]);
    expect(completedWindowEnd).toBeNull();
  });

  it('즉시취소 스캔은 since(없으면 지금−24h) 부터 일 단위로 묻고, 스캔에 없는 주문은 단건 조회한다', async () => {
    singleSheets[ORDER_B] = [sheet(ORDER_B, BOX_B1, 'ACCEPT', [item(300000003, { cancelCount: 2 })])];
    instantCancels = [
      receipt('500000000000000004', ORDER_B, 'CANCEL_REQUEST', [{ vendorItemId: 300000003, cancelCount: 2 }]),
    ];

    const { snapshots } = await source.fetchOrdersInWindow(null);

    expect(getReturnRequests).toHaveBeenCalledWith(
      expect.objectContaining({ cancelType: 'CANCEL', createdAtFrom: '2026-11-10', createdAtTo: '2026-11-11' }),
    );
    expect(getReturnRequests.mock.calls.find(([params]) => params.cancelType === 'CANCEL')?.[0].status).toBeUndefined();
    expect(getSingleOrderSheetByOrderId).toHaveBeenCalledWith(ORDER_B);
    // 즉시취소는 승인할 요청이 아니다 — 취소 관측은 발주서의 cancelCount 가 낸다.
    expect(snapshots[0].lifecycle.map((observation) => observation.eventType)).toEqual(['OrderCancelled']);

    getReturnRequests.mockClear();
    // KST 2026-11-08 10:00 — 31일 상한 안이라 since 의 KST 날짜가 그대로 시작일.
    await source.fetchOrdersInWindow(new Date('2026-11-08T01:00:00.000Z'));
    expect(getReturnRequests).toHaveBeenCalledWith(
      expect.objectContaining({ cancelType: 'CANCEL', createdAtFrom: '2026-11-08' }),
    );

    getReturnRequests.mockClear();
    await source.fetchOrdersInWindow(new Date('2026-08-01T00:00:00.000Z'));
    expect(getReturnRequests).toHaveBeenCalledWith(
      expect.objectContaining({ cancelType: 'CANCEL', createdAtFrom: '2026-10-11' }),
    );
  });

  it('취소 접수 목록은 nextToken 을 따라 끝까지 받는다', async () => {
    sheetsByStatus.INSTRUCT = [sheet(ORDER_A, BOX_A1, 'INSTRUCT', [item(300000001), item(300000002)])];
    getReturnRequests.mockImplementation((params: GetReturnRequestsParams) => {
      if (params.cancelType === 'CANCEL') return Promise.resolve({ data: [] });
      if (!params.nextToken) {
        return Promise.resolve({
          data: [
            receipt('500000000000000001', ORDER_A, 'RELEASE_STOP_UNCHECKED', [
              { vendorItemId: 300000001, cancelCount: 1 },
            ]),
          ],
          nextToken: 'page-2',
        });
      }
      return Promise.resolve({
        data: [
          receipt('500000000000000002', ORDER_A, 'RELEASE_STOP_UNCHECKED', [
            { vendorItemId: 300000002, cancelCount: 1 },
          ]),
        ],
        nextToken: '',
      });
    });

    const { snapshots } = await source.fetchOrdersInWindow(null);

    expect(snapshots[0].lifecycle.map((observation) => observation.eventKey)).toEqual([
      'cancel-request:500000000000000001',
      'cancel-request:500000000000000002',
    ]);
  });

  it('같은 vendorItemId 두 줄인 주문은 fetchFailures 로 간다', async () => {
    sheetsByStatus.ACCEPT = [
      sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001)]),
      sheet(ORDER_A, BOX_A2, 'ACCEPT', [item(300000001)]),
      sheet(ORDER_B, BOX_B1, 'ACCEPT', [item(300000003)]),
    ];

    const { snapshots, fetchFailures } = await source.fetchOrdersInWindow(null);

    expect(snapshots.map((snapshot) => snapshot.externalOrderId)).toEqual([ORDER_B]);
    expect(fetchFailures).toEqual([
      { externalOrderId: ORDER_A, changedAt: NOW.toISOString(), error: expect.stringContaining('같은 옵션 두 줄') },
    ]);
  });

  it('해석할 수 없는 발주서는 그 주문만 fetchFailures 로 간다', async () => {
    sheetsByStatus.ACCEPT = [
      sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001, { shippingCount: undefined })]),
      sheet(ORDER_B, BOX_B1, 'ACCEPT', [item(300000003)]),
    ];

    const { snapshots, fetchFailures } = await source.fetchOrdersInWindow(null);

    expect(snapshots.map((snapshot) => snapshot.externalOrderId)).toEqual([ORDER_B]);
    expect(fetchFailures).toEqual([
      { externalOrderId: ORDER_A, changedAt: NOW.toISOString(), error: expect.stringContaining('shippingCount') },
    ]);
  });

  it('스캔 중 하나라도 실패하면 throw 하고 부분 결과를 내지 않는다', async () => {
    sheetsByStatus.ACCEPT = [sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001)])];
    getReturnRequests.mockImplementation((params: GetReturnRequestsParams) =>
      params.cancelType === 'CANCEL' ? Promise.reject(new Error('쿠팡 429')) : Promise.resolve({ data: [] }),
    );

    await expect(source.fetchOrdersInWindow(null)).rejects.toThrow('쿠팡 429');

    getReturnRequests.mockResolvedValue({ data: [] });
    getAllOrderSheetsByStatus.mockImplementation((_from: string, _to: string, status: string) =>
      status === 'INSTRUCT' ? Promise.reject(new Error('쿠팡 500')) : Promise.resolve(sheetsByStatus[status] ?? []),
    );

    await expect(source.fetchOrdersInWindow(null)).rejects.toThrow('쿠팡 500');
  });

  it('completedWindowEnd 는 주기 시작 시각', async () => {
    const empty = await source.fetchOrdersInWindow(new Date('2026-11-11T02:00:00.000Z'));
    expect(empty).toEqual({ snapshots: [], fetchFailures: [], completedWindowEnd: NOW });

    sheetsByStatus.ACCEPT = [sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001)])];
    const withOrder = await source.fetchOrdersInWindow(null);
    expect(withOrder.completedWindowEnd).toEqual(NOW);
    expect(withOrder.snapshots[0].sourceUpdatedAt).toBe(NOW.toISOString());
  });

  describe('fetchOrder', () => {
    it('단건 조회로 같은 스냅샷을 만든다', async () => {
      singleSheets[ORDER_A] = [sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001)])];

      const snapshot = await source.fetchOrder(ORDER_A);

      expect(snapshot?.externalOrderId).toBe(ORDER_A);
      expect(snapshot?.paymentState).toBe('accepted');
      expect(snapshot?.lines.map((line) => line.channelOrderItemId)).toEqual([`${ORDER_A}:300000001`]);
      expect(snapshot?.sourceUpdatedAt).toBe(NOW.toISOString());
    });

    it('0건이면 null', async () => {
      await expect(source.fetchOrder(ORDER_A)).resolves.toBeNull();
    });

    it('같은 vendorItemId 두 줄이면 throw 한다 — 재처리도 추측하지 않는다', async () => {
      singleSheets[ORDER_A] = [
        sheet(ORDER_A, BOX_A1, 'ACCEPT', [item(300000001)]),
        sheet(ORDER_A, BOX_A2, 'ACCEPT', [item(300000001)]),
      ];

      await expect(source.fetchOrder(ORDER_A)).rejects.toThrow('같은 옵션 두 줄');
    });
  });
});
