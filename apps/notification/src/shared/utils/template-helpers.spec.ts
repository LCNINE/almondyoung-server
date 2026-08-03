import { formatAmount, formatDueDate, formatOrderTotal } from './template-helpers';

describe('formatOrderTotal', () => {
  it('포인트 미사용이면 총액만 적는다', () => {
    expect(formatOrderTotal(5990)).toBe('5,990');
    expect(formatOrderTotal(5990, 0)).toBe('5,990');
  });

  it('포인트 전액 결제는 실결제 0 을 명시한다', () => {
    expect(formatOrderTotal(5990, 5990)).toBe('5,990원 · 포인트 5,990원 사용 · 실결제 0');
  });

  it('일부 사용은 차액을 실결제로 적는다', () => {
    expect(formatOrderTotal(78000, 5000)).toBe('78,000원 · 포인트 5,000원 사용 · 실결제 73,000');
  });

  it("템플릿이 '원' 을 덧붙이므로 반환값은 숫자로 끝난다", () => {
    expect(formatOrderTotal(78000, 5000)).toMatch(/\d$/);
    expect(formatOrderTotal(78000)).toMatch(/\d$/);
  });
});

describe('formatAmount', () => {
  it('천단위 구분을 넣는다', () => {
    expect(formatAmount(49900)).toBe('49,900');
    expect(formatAmount(1000000)).toBe('1,000,000');
    expect(formatAmount(0)).toBe('0');
  });

  it('이미 포맷된 문자열도 이중 포맷하지 않는다', () => {
    expect(formatAmount('49,900')).toBe('49,900');
  });

  it('숫자가 아니면 원본을 돌려준다 (정보 유실 방지)', () => {
    expect(formatAmount(undefined)).toBe('-');
    expect(formatAmount('N/A')).toBe('N/A');
  });
});

describe('formatDueDate', () => {
  it('ISO 를 KST 기준 사람이 읽는 형태로 바꾼다', () => {
    // 2026-07-24T23:59:59+09:00 = 금요일 23:59 KST
    expect(formatDueDate('2026-07-24T23:59:59+09:00')).toBe('7월 24일(금) 23:59');
  });

  it('UTC 입력도 KST 로 환산한다', () => {
    // 2026-07-24T14:59:59Z = KST 23:59
    expect(formatDueDate('2026-07-24T14:59:59Z')).toBe('7월 24일(금) 23:59');
  });

  it('파싱 못하면 원본을 그대로 둔다', () => {
    expect(formatDueDate('언젠가')).toBe('언젠가');
    expect(formatDueDate(undefined)).toBe('-');
  });
});
