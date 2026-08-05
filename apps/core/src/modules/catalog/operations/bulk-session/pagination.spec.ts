import { parseLimit, parsePage } from './pagination';

describe('페이지 파라미터 파싱', () => {
  it('빈 값·쓰레기 값은 기본값으로 떨어진다', () => {
    expect(parsePage('')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parseLimit('')).toBe(20);
    expect(parseLimit('abc')).toBe(20);
  });

  it('page 는 1 미만으로 내려가지 않는다', () => {
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-5')).toBe(1);
    expect(parsePage('3')).toBe(3);
  });

  it('limit 은 1~100 으로 잘린다', () => {
    expect(parseLimit('0')).toBe(1);
    expect(parseLimit('500')).toBe(100);
    expect(parseLimit('50')).toBe(50);
  });
});
