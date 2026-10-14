import { isPrintRefundBlocked } from './refund-print-gate';

describe('isPrintRefundBlocked', () => {
  it('제작 접수된 인쇄 줄이 없으면 막지 않는다', () => {
    expect(isPrintRefundBlocked(false, false)).toBe(false);
  });

  it('제작 접수된 인쇄 줄이 있으면 상품 하자 체크 전에는 막는다', () => {
    expect(isPrintRefundBlocked(true, false)).toBe(true);
  });

  it('상품 하자 체크가 있으면 연다', () => {
    expect(isPrintRefundBlocked(true, true)).toBe(false);
  });

  it('인쇄 상태를 아직 모르면 막는다', () => {
    expect(isPrintRefundBlocked(undefined, false)).toBe(true);
  });
});
