import type { OrderView } from '../../settlement/load-order-view';
import { returnItemValue } from '../return-item-value';

const line = (id: string, unitPrice: number, quantity: number, adjustments: number[] = []): OrderView['lines'][number] => ({
  id,
  quantity,
  unitPrice,
  productId: `p_${id}`,
  requiresShipping: true,
  fulfilledQuantity: quantity,
  returnedQuantity: 0,
  adjustments: adjustments.map((amount) => ({ amount })),
});

describe('returnItemValue', () => {
  it('할인 없는 30,000×2 중 1 → 30,000', () => {
    expect(returnItemValue([line('a', 30000, 2)], [{ itemId: 'a', quantity: 1 }])).toBe(30000);
  });
  it('줄 할인 5,000(수량 2) 중 1 → 27,500 — 반품 수량 몫의 할인만 뺀다', () => {
    expect(returnItemValue([line('a', 30000, 2, [5000])], [{ itemId: 'a', quantity: 1 }])).toBe(27500);
  });
  it('여러 줄을 합친다, 반품 품목이 아닌 줄은 세지 않는다', () => {
    const lines = [line('a', 30000, 2, [5000]), line('b', 10000, 1), line('c', 99999, 3)];
    expect(
      returnItemValue(lines, [
        { itemId: 'a', quantity: 2 },
        { itemId: 'b', quantity: 1 },
      ]),
    ).toBe(60000 - 5000 + 10000);
  });
  it('소수 몫은 내림 — 주문 단위 할인이 줄에 소수로 나뉘어 있어도 원 단위로 낸다', () => {
    // 전량 반품이라 할인 714.29 전부가 빠진다: 30,000 − 714.29 = 29,285.71 → 29,285
    expect(returnItemValue([line('a', 30000, 1, [714.29])], [{ itemId: 'a', quantity: 1 }])).toBe(29285);
  });
  it('같은 줄이 여러 행이면 합쳐서 센다 — 반품 품목 행이 줄 하나에 둘일 수 있다', () => {
    const lines = [line('a', 30000, 3, [3000])];
    expect(
      returnItemValue(lines, [
        { itemId: 'a', quantity: 1 },
        { itemId: 'a', quantity: 1 },
      ]),
    ).toBe(returnItemValue(lines, [{ itemId: 'a', quantity: 2 }]));
  });
  it('수량 0 인 품목은 0 을 더한다', () => {
    expect(returnItemValue([line('a', 30000, 2)], [{ itemId: 'a', quantity: 0 }])).toBe(0);
  });
  it('주문에 없는 줄이거나 줄 수량보다 많으면 던진다 — 반품 품목은 주문 줄에서 왔다', () => {
    expect(() => returnItemValue([line('a', 30000, 2)], [{ itemId: 'x', quantity: 1 }])).toThrow();
    expect(() => returnItemValue([line('a', 30000, 2)], [{ itemId: 'a', quantity: 3 }])).toThrow();
  });
});
