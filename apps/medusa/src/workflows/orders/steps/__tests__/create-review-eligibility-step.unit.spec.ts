import { lineAmount } from '../create-review-eligibility-step';

/**
 * 라인 결제금액은 정률 보상의 모수다. Medusa 의 계산 필드(`items.total`)는 필드를 지정해
 * 조회하면 응답에서 키째로 빠지므로(0 도 null 도 아니다) 저장된 값으로 직접 셈한다.
 * 그 셈이 어긋나면 고객에게 나가는 적립금이 어긋나므로 여기서 못 박는다.
 */
describe('lineAmount', () => {
  it('단가 × 수량', () => {
    expect(lineAmount({ id: 'l1', product_id: 'p1', unit_price: 12000, detail: { quantity: 1 } })).toBe(12000);
    expect(lineAmount({ id: 'l1', product_id: 'p1', unit_price: 12000, detail: { quantity: 3 } })).toBe(36000);
  });

  it('라인 할인을 뺀다', () => {
    expect(
      lineAmount({
        id: 'l1',
        product_id: 'p1',
        unit_price: 10000,
        detail: { quantity: 2 },
        adjustments: [{ amount: 3000 }, { amount: 1000 }],
      }),
    ).toBe(16000);
  });

  it('문자열로 와도 수로 읽는다', () => {
    expect(
      lineAmount({
        id: 'l1',
        product_id: 'p1',
        unit_price: '12000',
        detail: { quantity: '2' },
        adjustments: [{ amount: '2000' }],
      }),
    ).toBe(22000);
  });

  it('단가나 수량을 모르면 0 이 아니라 undefined 다', () => {
    // 0 으로 채우면 ugc 가 「0원짜리 주문」으로 읽어 정률 보상이 조용히 0원이 된다.
    expect(lineAmount({ id: 'l1', product_id: 'p1', detail: { quantity: 1 } })).toBeUndefined();
    expect(lineAmount({ id: 'l1', product_id: 'p1', unit_price: 12000 })).toBeUndefined();
    expect(lineAmount({ id: 'l1', product_id: 'p1', unit_price: null, detail: { quantity: null } })).toBeUndefined();
    expect(
      lineAmount({ id: 'l1', product_id: 'p1', unit_price: 'abc', detail: { quantity: 1 } }),
    ).toBeUndefined();
  });

  it('할인이 단가를 넘어 음수가 되면 넘기지 않는다', () => {
    expect(
      lineAmount({
        id: 'l1',
        product_id: 'p1',
        unit_price: 1000,
        detail: { quantity: 1 },
        adjustments: [{ amount: 5000 }],
      }),
    ).toBeUndefined();
  });

  it('전액 할인은 0원이 맞다 — 모르는 것과 다르다', () => {
    expect(
      lineAmount({
        id: 'l1',
        product_id: 'p1',
        unit_price: 5000,
        detail: { quantity: 1 },
        adjustments: [{ amount: 5000 }],
      }),
    ).toBe(0);
  });
});
