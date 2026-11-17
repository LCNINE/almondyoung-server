import { summarizeOrders } from './report';

/** 전부 가짜 값이다. 실제 쿠팡 응답을 여기 붙여 넣지 말 것(공개 레포). */
function sheet(orderId: string, shipmentBoxId: string, status: string, vendorItemIds: number[]) {
  return {
    shipmentBoxId,
    orderId,
    status,
    orderedAt: '2026-11-11T09:00:00',
    paidAt: '2026-11-11T09:05:00',
    receiver: { name: '가짜 수취인', safeNumber: '050-0000-0000', addr1: '테스트시 1' },
    orderItems: vendorItemIds.map((vendorItemId) => ({
      vendorItemId,
      shippingCount: 1,
      salesPrice: { units: 1000 },
      orderPrice: { units: 1000 },
    })),
  };
}

describe('summarizeOrders', () => {
  it('결제완료 주문인데 출고(DEPARTURE 이후)된 상자가 있으면 주문번호를 센다', () => {
    const report = summarizeOrders({
      acceptOrderIds: new Set(['900001', '900002', '900003']),
      sheetsByOrder: new Map<string, readonly unknown[]>([
        ['900001', [sheet('900001', '100001', 'ACCEPT', [1]), sheet('900001', '100002', 'DEPARTURE', [2])]],
        ['900002', [sheet('900002', '100003', 'ACCEPT', [1])]],
        ['900003', [sheet('900003', '100004', 'FINAL_DELIVERY', [1])]],
        // 상품준비중 주문은 결제완료가 아니라 세지 않는다
        ['900004', [sheet('900004', '100005', 'INSTRUCT', [1]), sheet('900004', '100006', 'DELIVERING', [2])]],
      ]),
    });

    expect(report.acceptWithShippedBox).toEqual(['900001', '900003']);
  });

  it('같은 옵션 두 줄은 주문의 상자 전부를 합쳐 본다 — 상자마다가 아니다', () => {
    const report = summarizeOrders({
      acceptOrderIds: new Set(),
      sheetsByOrder: new Map<string, readonly unknown[]>([
        // 상자는 다르지만 같은 옵션 → source 가 격리한다
        ['900001', [sheet('900001', '100001', 'INSTRUCT', [7]), sheet('900001', '100002', 'INSTRUCT', [7])]],
        ['900002', [sheet('900002', '100003', 'INSTRUCT', [7, 8])]],
        // 같은 상자가 두 번 와도(스캔·단건이 겹침) 두 줄이 아니다
        ['900003', [sheet('900003', '100004', 'INSTRUCT', [7]), sheet('900003', '100004', 'INSTRUCT', [7])]],
      ]),
    });

    expect(report.twoLineOrders).toEqual(['900001']);
  });

  it('해석하지 못한 발주서는 주문번호와 함께 해석 실패로 모은다', () => {
    const report = summarizeOrders({
      acceptOrderIds: new Set(['900001']),
      sheetsByOrder: new Map<string, readonly unknown[]>([['900001', [{ orderId: '900001' }]]]),
    });

    expect(report.parseFailures).toEqual([expect.stringMatching(/^900001: 쿠팡 발주서 해석 실패/)]);
    expect(report.acceptWithShippedBox).toEqual([]);
  });
});
