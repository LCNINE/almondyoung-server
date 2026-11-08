import { plannedOrderText } from './preparation-model';

const rows = [
  { shipmentId: 'a1111111-0000', orderNos: ['6321'] },
  { shipmentId: 'd4444444-0000', orderNos: [] },
];

describe('plannedOrderText', () => {
  it('주문번호가 없으면 상자 번호 앞 여덟 자를 쓴다', () => {
    expect(plannedOrderText(rows[1])).toBe('상자 d4444444');
    expect(plannedOrderText(rows[0])).toBe('#6321');
  });
});
