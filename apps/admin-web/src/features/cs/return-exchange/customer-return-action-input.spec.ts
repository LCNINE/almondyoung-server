import { parseNonNegativeAmount, parsePrepayAmount, requiredMemo } from './customer-return-action-input';

describe('customer-return-action-input', () => {
  it('0 이상 정수만 받고 콤마는 허용한다', () => {
    expect(parseNonNegativeAmount('0')).toBe(0);
    expect(parseNonNegativeAmount('1,500')).toBe(1500);
    expect(parseNonNegativeAmount(' 30 ')).toBe(30);
    expect(parseNonNegativeAmount('')).toBeNull();
    expect(parseNonNegativeAmount('-1')).toBeNull();
    expect(parseNonNegativeAmount('1.5')).toBeNull();
    expect(parseNonNegativeAmount('12a')).toBeNull();
  });

  it('선환불 금액은 1 이상 품목 값 이하다', () => {
    expect(parsePrepayAmount('1', 1000)).toBe(1);
    expect(parsePrepayAmount('1000', 1000)).toBe(1000);
    expect(parsePrepayAmount('0', 1000)).toBeNull();
    expect(parsePrepayAmount('1001', 1000)).toBeNull();
    expect(parsePrepayAmount('500', undefined)).toBeNull();
    expect(parsePrepayAmount('abc', 1000)).toBeNull();
  });

  it('메모는 공백만이면 거절한다', () => {
    expect(requiredMemo('  ')).toBeNull();
    expect(requiredMemo(' 확인함 ')).toBe('확인함');
  });
});
