import { pointedOrderNo } from './pointed-order';

const params = (q: Record<string, string>) => ({
  get: (n: string) => q[n] ?? null,
});

describe('pointedOrderNo', () => {
  it('orderNo 는 어느 스테이지에서나 읽는다', () => {
    expect(pointedOrderNo(params({ orderNo: 'order_01J' }), false)).toBe(
      'order_01J'
    );
  });
  it('externalOrderId 는 데모에서만', () => {
    expect(pointedOrderNo(params({ externalOrderId: 'X' }), false)).toBeNull();
    expect(pointedOrderNo(params({ externalOrderId: 'X' }), true)).toBe('X');
  });
  it('공백뿐이면 없음', () => {
    expect(pointedOrderNo(params({ orderNo: '  ' }), false)).toBeNull();
  });
});
