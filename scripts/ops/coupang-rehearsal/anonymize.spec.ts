import { anonymizeCoupangPayload } from './anonymize';

/** 전부 가짜 값이다. 실제 쿠팡 응답을 여기 붙여 넣지 말 것(공개 레포). */
function sampleSheet() {
  return {
    shipmentBoxId: 123456789012,
    orderId: '98765432109876',
    status: 'ACCEPT',
    orderedAt: '2026-11-10T10:00:00',
    parcelPrintMessage: '문 앞에 두세요 비밀번호 1234',
    orderer: {
      name: '홍길동',
      email: 'hong@real-mail.test',
      safeNumber: '0502-1234-5678',
      ordererNumber: '010-1111-2222',
    },
    receiver: {
      name: '김철수',
      safeNumber: '0507-1111-2222',
      receiverNumber: '010-9999-8888',
      addr1: '서울특별시 강남구 테헤란로 1',
      addr2: '101동 202호',
      postCode: '06000',
    },
    orderItems: [
      {
        vendorItemId: 7000000001,
        vendorItemName: '옵션 A',
        shippingCount: 2,
        orderPrice: { units: 12000 },
        cancelCount: 0,
      },
      {
        vendorItemId: 7000000002,
        vendorItemName: '옵션 B',
        shippingCount: 1,
        orderPrice: { units: 3000 },
        cancelCount: 1,
      },
    ],
  };
}

describe('anonymizeCoupangPayload', () => {
  it('개인정보 칸을 가짜 값으로, 같은 주문번호는 같은 가짜 번호로 바꾼다', () => {
    const ids = new Map<string, string>();
    const sheet = sampleSheet();
    const out = anonymizeCoupangPayload([sheet, { receiptId: 55555555, orderId: sheet.orderId }], ids) as Array<
      Record<string, unknown>
    >;
    const [first, second] = out;
    expect(first.orderId).toMatch(/^\d{14}$/);
    expect(first.orderId).not.toBe(sheet.orderId);
    expect(second.orderId).toBe(first.orderId);
    expect(String(first.shipmentBoxId)).toMatch(/^\d{12}$/);
    expect(String(first.shipmentBoxId)).not.toBe('123456789012');
    expect(String(second.receiptId)).toMatch(/^\d{8}$/);

    const receiver = first.receiver as Record<string, unknown>;
    expect(receiver.name).toBe('테스트고객2');
    expect(receiver.safeNumber).toMatch(/^050-0000-\d{4}$/);
    expect(receiver.receiverNumber).toMatch(/^050-0000-\d{4}$/);
    expect(receiver.addr1).toBe('서울시 테스트구 1');
    expect(receiver.addr2).toBe('1호');
    const orderer = first.orderer as Record<string, unknown>;
    expect(orderer.name).toBe('테스트고객1');
    expect(orderer.email).toBe('user-1@example.com');
    expect(first.parcelPrintMessage).toBe('배송 메모');
  });

  it('상태·수량·금액·vendorItemId 는 그대로 둔다', () => {
    const out = anonymizeCoupangPayload(sampleSheet(), new Map()) as ReturnType<typeof sampleSheet>;
    expect(out.status).toBe('ACCEPT');
    expect(out.orderedAt).toBe('2026-11-10T10:00:00');
    expect(out.receiver.postCode).toBe('06000');
    expect(out.orderItems).toEqual(sampleSheet().orderItems);
  });

  it('결과 JSON 문자열 어디에도 원래 이름·전화·주소가 남지 않는다', () => {
    const json = JSON.stringify(
      anonymizeCoupangPayload({ data: [sampleSheet()], nested: { deeper: [sampleSheet()] } }, new Map()),
    );
    for (const secret of [
      '홍길동',
      '김철수',
      'hong@real-mail.test',
      '0502-1234-5678',
      '010-1111-2222',
      '0507-1111-2222',
      '010-9999-8888',
      '테헤란로',
      '101동',
      '98765432109876',
      '123456789012',
      '비밀번호',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('원본을 바꾸지 않고, 모르는 칸도 중첩 채로 그대로 지나간다', () => {
    const input = { unknownKey: { a: [1, 'x', null, { receiver: { name: '이영희' } }] }, count: 3 };
    const out = anonymizeCoupangPayload(input, new Map()) as typeof input;
    expect(out.count).toBe(3);
    expect(out.unknownKey.a.slice(0, 3)).toEqual([1, 'x', null]);
    expect(JSON.stringify(out)).not.toContain('이영희');
    expect(input.unknownKey.a[3]).toEqual({ receiver: { name: '이영희' } });
  });
});
