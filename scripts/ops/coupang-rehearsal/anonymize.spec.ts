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

  it('요청자·해외배송 칸까지 가리고 원래 값이 어디에도 남지 않는다', () => {
    const receipt = {
      code: 200,
      data: [
        {
          receiptId: 11112222,
          orderId: 33334444555566,
          originalShipmentBoxId: 777788889999,
          paymentId: 444455556666,
          shipmentBoxIds: [777788889999, 100200300400],
          receiptStatus: 'RU',
          cancelReason: '고객이 아파서 환불 원함',
          cancelReasonCategory1: '직접 입력한 사유',
          deliveryInvoiceNo: '555566667777',
          requesterName: '박요청',
          requesterPhoneNumber: '010-4444-5555',
          requesterRealPhoneNumber: '010-6666-7777',
          requesterAddress: '부산광역시 해운대구 센텀로 99',
          requesterAddressDetail: '센텀빌딩 1203호',
          requesterZipCode: '48000',
          overseaShippingInfoDto: {
            ordererPhoneNumber: '010-8888-0000',
            ordererSsn: '900101-1234567',
            personalCustomsClearanceCode: 'P123456789012',
          },
          returnItems: [{ vendorItemId: 7000000001, vendorItemName: '비밀상품명', cancelCount: 2 }],
        },
      ],
    };
    const out = anonymizeCoupangPayload(receipt, new Map()) as typeof receipt;
    const json = JSON.stringify(out);
    for (const secret of [
      '33334444555566',
      '777788889999',
      '100200300400',
      '11112222',
      '444455556666',
      '아파서',
      '직접 입력',
      '555566667777',
      '박요청',
      '010-4444-5555',
      '010-6666-7777',
      '해운대',
      '센텀',
      '48000',
      '010-8888-0000',
      '900101-1234567',
      'P123456789012',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(out.data[0].returnItems[0]).toEqual(receipt.data[0].returnItems[0]);
    expect(out.data[0].receiptStatus).toBe('RU');
  });

  it('상품명 칸은 그대로 두고, shipmentBoxIds 배열은 shipmentBoxId 와 같은 가짜값으로 바뀐다', () => {
    const out = anonymizeCoupangPayload(
      {
        shipmentBoxId: 777788889999,
        shipmentBoxIds: [777788889999, 100200300400],
        vendorItemName: '튼튼 컵',
        productName: '튼튼 컵 세트',
        sellerProductName: '컵',
        vendorItemPackageName: '컵 패키지',
      },
      new Map(),
    ) as Record<string, unknown>;
    const ids = out.shipmentBoxIds as number[];
    expect(ids[0]).toBe(out.shipmentBoxId);
    expect(String(ids[1])).toMatch(/^\d{12}$/);
    expect(out.vendorItemName).toBe('튼튼 컵');
    expect(out.productName).toBe('튼튼 컵 세트');
    expect(out.sellerProductName).toBe('컵');
    expect(out.vendorItemPackageName).toBe('컵 패키지');
  });

  it('바꾸지 않은 문자열 칸을 키 경로로 모은다', () => {
    const unchanged = new Set<string>();
    anonymizeCoupangPayload(
      { status: 'ACCEPT', receiver: { name: '가나다' }, items: [{ vendorItemName: 'x' }] },
      new Map(),
      unchanged,
    );
    expect([...unchanged].sort()).toEqual(['items[].vendorItemName', 'status']);
  });
});
