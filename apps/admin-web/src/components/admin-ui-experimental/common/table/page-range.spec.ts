import { getPageRange } from './page-range';

describe('getPageRange', () => {
  it('한 페이지뿐이면 1만', () => {
    expect(getPageRange(1, 0)).toEqual([1]);
    expect(getPageRange(1, 1)).toEqual([1]);
  });

  it('앞쪽에서는 뒤쪽만 생략', () => {
    expect(getPageRange(1, 502)).toEqual([1, 2, 3, '...', 502]);
  });

  it('가운데에서는 양쪽 생략', () => {
    expect(getPageRange(50, 502)).toEqual([
      1,
      '...',
      48,
      49,
      50,
      51,
      52,
      '...',
      502,
    ]);
  });

  it('끝쪽에서는 앞쪽만 생략', () => {
    expect(getPageRange(502, 502)).toEqual([1, '...', 500, 501, 502]);
  });

  it('짧은 목록은 생략 없이 전부', () => {
    expect(getPageRange(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
