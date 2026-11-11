import { parseCoupangCancelReceipt, parseCoupangOrderSheet, toCoupangContractTimestamp } from './coupang-order-fields';

const money = (units: number) => ({ currencyCode: 'KRW', units, nanos: 0 });

const rawSheet = (receiverNumber: string | null = null) => ({
  shipmentBoxId: '100000000000000001',
  orderId: '200000000000000001',
  orderedAt: '2026-11-11T09:00:00',
  paidAt: '2026-11-11T09:05:00+09:00',
  status: 'ACCEPT',
  shippingPrice: money(3000),
  orderer: { name: '홍길동', safeNumber: '050-0000-0001', ordererNumber: null },
  receiver: {
    name: '홍길동',
    safeNumber: '050-0000-0000',
    receiverNumber,
    addr1: '서울시 테스트구 1',
    addr2: '2층',
    postCode: '00000',
  },
  parcelPrintMessage: '문 앞에 두세요',
  unknownField: 1,
  orderItems: [
    {
      vendorItemId: 300000001,
      vendorItemName: '테스트 상품 A',
      shippingCount: 2,
      salesPrice: money(10000),
      orderPrice: money(20000),
      cancelCount: 1,
      holdCountForCancel: 0,
    },
    {
      vendorItemId: 300000002,
      vendorItemName: '테스트 상품 B',
      shippingCount: 1,
      salesPrice: money(5000),
      orderPrice: money(5000),
    },
  ],
});

describe('toCoupangContractTimestamp', () => {
  it('offset 없는 시각을 KST 로 읽어 UTC ISO 로 싣는다', () => {
    expect(toCoupangContractTimestamp('2026-11-11T09:00:00')).toBe('2026-11-11T00:00:00.000Z');
    expect(toCoupangContractTimestamp('2026-11-11T09:00:00+09:00')).toBe('2026-11-11T00:00:00.000Z');
    expect(toCoupangContractTimestamp('2026-11-11T00:00:00Z')).toBe('2026-11-11T00:00:00.000Z');
  });
});

describe('parseCoupangOrderSheet', () => {
  it('발주서를 해석한다 — 수취인 실번호가 없으면 안심번호', () => {
    const info = parseCoupangOrderSheet(rawSheet());
    expect(info.shipmentBoxId).toBe('100000000000000001');
    expect(info.orderId).toBe('200000000000000001');
    expect(info.status).toBe('ACCEPT');
    expect(info.orderedAt).toBe('2026-11-11T00:00:00.000Z');
    expect(info.paidAt).toBe('2026-11-11T00:05:00.000Z');
    expect(info.shippingPrice).toBe(3000);
    expect(info.shippingAddress).toEqual({
      recipientName: '홍길동',
      phone: '050-0000-0000',
      postalCode: '00000',
      roadAddress: '서울시 테스트구 1',
      detailAddress: '2층',
    });
    expect(info.items).toEqual([
      {
        vendorItemId: '300000001',
        productName: '테스트 상품 A',
        shippingCount: 2,
        cancelCount: 1,
        holdCountForCancel: 0,
        unitPrice: 10000,
        orderPrice: 20000,
      },
      {
        vendorItemId: '300000002',
        productName: '테스트 상품 B',
        shippingCount: 1,
        cancelCount: 0,
        holdCountForCancel: 0,
        unitPrice: 5000,
        orderPrice: 5000,
      },
    ]);
  });

  it('수취인 실번호가 있으면 그것을 쓴다', () => {
    const raw = rawSheet('010-0000-0000');
    expect(parseCoupangOrderSheet(raw).shippingAddress.phone).toBe('010-0000-0000');
  });

  it('vendorItemId 가 없는 품목이면 칸 이름을 담아 throw', () => {
    const raw = rawSheet();
    delete (raw.orderItems[0] as { vendorItemId?: number }).vendorItemId;
    expect(() => parseCoupangOrderSheet(raw)).toThrow('orderItems[0].vendorItemId');
  });

  it('shippingCount 가 없으면 칸 이름을 담아 throw', () => {
    const raw = rawSheet();
    delete (raw.orderItems[1] as { shippingCount?: number }).shippingCount;
    expect(() => parseCoupangOrderSheet(raw)).toThrow('orderItems[1].shippingCount');
  });

  it('orderId 가 숫자(긴 ID 를 number 로 들고 있음)면 throw', () => {
    expect(() => parseCoupangOrderSheet({ ...rawSheet(), orderId: 20000000000 })).toThrow('orderId');
  });
});

describe('parseCoupangCancelReceipt', () => {
  it('출고중지요청 접수를 해석한다', () => {
    const info = parseCoupangCancelReceipt({
      receiptId: '400000000000000001',
      orderId: '200000000000000001',
      receiptStatus: 'RELEASE_STOP_UNCHECKED',
      createdAt: '2026-11-11T10:00:00',
      cancelCountSum: 3,
      returnItems: [
        { vendorItemId: 300000001, cancelCount: 2 },
        { vendorItemId: 300000002, cancelCount: 1 },
      ],
    });
    expect(info).toEqual({
      receiptId: '400000000000000001',
      orderId: '200000000000000001',
      receiptStatus: 'RELEASE_STOP_UNCHECKED',
      createdAt: '2026-11-11T01:00:00.000Z',
      cancelCountSum: 3,
      items: [
        { vendorItemId: '300000001', cancelCount: 2 },
        { vendorItemId: '300000002', cancelCount: 1 },
      ],
    });
  });

  it('returnItems 의 vendorItemId 가 없으면 칸 이름을 담아 throw', () => {
    expect(() =>
      parseCoupangCancelReceipt({
        receiptId: '400000000000000001',
        orderId: '200000000000000001',
        receiptStatus: 'X',
        createdAt: '2026-11-11T10:00:00',
        cancelCountSum: 1,
        returnItems: [{ cancelCount: 1 }],
      }),
    ).toThrow('returnItems[0].vendorItemId');
  });
});
