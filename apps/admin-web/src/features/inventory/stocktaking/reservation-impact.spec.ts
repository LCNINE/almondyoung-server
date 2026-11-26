import { reservationImpactLines } from './reservation-impact';

describe('reservationImpactLines', () => {
  const preview = [{ skuId: 'sku-1', skuName: '코튼셔츠' }];

  it('놓는 예약과 못 놓는 예약을 상품 이름과 함께 한 문장으로 쓴다', () => {
    expect(
      reservationImpactLines(
        [{ skuId: 'sku-1', orderCount: 2, quantity: 3, missingQty: 1, heldBy: [{ orderNo: 'AY-100', quantity: 1 }] }],
        preview
      )
    ).toEqual([
      '코튼셔츠: 주문 2건이 잡아 둔 3개를 놓아요. 그 주문은 재고가 들어오면 다시 잡아요. 출고 준비에 들어간 주문(AY-100 1개)은 예약을 놓지 못해 1개가 모자라요. 출고 준비에서 그 주문을 배치에서 빼거나 피킹 때 결품으로 처리해 주세요.',
    ]);
  });

  it('놓을 예약이 없으면 «0건» 문장을 쓰지 않는다', () => {
    const [line] = reservationImpactLines(
      [{ skuId: 'sku-2', orderCount: 0, quantity: 0, missingQty: 2, heldBy: [{ orderNo: null, quantity: 2 }] }],
      preview
    );
    expect(line).toMatch(/^이 상품: 출고 준비에 들어간 주문\(주문번호 없음 2개\)/);
    expect(line).not.toContain('0건');
  });
});
