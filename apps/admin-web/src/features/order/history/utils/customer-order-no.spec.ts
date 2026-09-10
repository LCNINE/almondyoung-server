import { formatCustomerOrderNo } from './customer-order-no';

describe('formatCustomerOrderNo', () => {
  it('자사몰 주문은 주문일(KST) + 고객 주문번호', () => {
    expect(formatCustomerOrderNo('3900', '2026-09-10T01:00:00.000Z', 'order_01J8')).toBe(
      '20260910-3900'
    );
  });

  it('UTC 로 전날인 시각도 KST 달력일로 찍는다', () => {
    // UTC 2026-09-09 15:30 == KST 2026-09-10 00:30
    expect(formatCustomerOrderNo('3900', '2026-09-09T15:30:00.000Z', 'order_01J8')).toBe(
      '20260910-3900'
    );
  });

  it('고객 주문번호가 없는 채널은 채널 주문번호가 곧 주문번호다', () => {
    expect(formatCustomerOrderNo(null, '2026-09-10T01:00:00.000Z', '2026091012345')).toBe(
      '2026091012345'
    );
    expect(formatCustomerOrderNo(undefined, undefined, 'order_01J8')).toBe('order_01J8');
  });

  it('주문일을 모르면 번호만 남긴다 — 없는 날짜를 지어내지 않는다', () => {
    expect(formatCustomerOrderNo('3900', null, 'order_01J8')).toBe('3900');
    expect(formatCustomerOrderNo('3900', '이건 날짜가 아니다', 'order_01J8')).toBe('3900');
  });
});
