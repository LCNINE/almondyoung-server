import { pageSlice } from './client-page';

describe('pageSlice', () => {
  const rows = Array.from({ length: 45 }, (_, i) => i);

  it('20건씩 자르고 쪽 수를 센다', () => {
    expect(pageSlice(rows, 2, 20)).toEqual({ rows: rows.slice(20, 40), page: 2, pages: 3 });
  });

  it('목록이 줄어 지금 쪽이 사라지면 마지막 쪽을 보여준다', () => {
    expect(pageSlice(rows.slice(0, 10), 3, 20)).toEqual({ rows: rows.slice(0, 10), page: 1, pages: 1 });
  });

  it('빈 목록은 1쪽 빈 목록이다', () => {
    expect(pageSlice([], 1, 20)).toEqual({ rows: [], page: 1, pages: 1 });
  });
});
