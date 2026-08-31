import { formatDiscountLabel } from './format-discount-label';

const percentage = { type: 'percentage' as const, value: 10 };
const fixed = { type: 'fixed' as const, value: 5000 };

describe('formatDiscountLabel', () => {
  it('application_method 가 없으면 대시', () => {
    expect(formatDiscountLabel(null, null)).toBe('-');
  });

  it('정률은 퍼센트로', () => {
    expect(formatDiscountLabel(percentage, null)).toBe('10%');
  });

  it('정액은 원화로', () => {
    expect(formatDiscountLabel(fixed, null)).toBe('5,000원');
  });

  it('정률 + 캡이면 상한을 덧붙인다', () => {
    expect(formatDiscountLabel(percentage, 30000)).toBe('10% (최대 30,000원)');
  });

  it('정액에 캡이 있어도 덧붙이지 않는다 — 정액의 상한은 할인액 자신이다', () => {
    expect(formatDiscountLabel(fixed, 30000)).toBe('5,000원');
  });

  it('캡 0 은 상한이 있다는 뜻이다 — falsy 로 흘리지 않는다', () => {
    expect(formatDiscountLabel(percentage, 0)).toBe('10% (최대 0원)');
  });
});
