import { mergeGroupFees } from '../group-fees';

describe('mergeGroupFees', () => {
  const a = { orderVersion: 2, groupFees: { p1: 3000, p2: 1000 } };
  const b = { orderVersion: 5, groupFees: { p1: 0 } };
  it('버전 오름차순으로 겹친다 — 나중 것이 이긴다', () => {
    expect(mergeGroupFees([a, b])).toEqual({ p1: 0, p2: 1000 });
  });
  it('역순 입력도 같은 결과', () => {
    expect(mergeGroupFees([b, a])).toEqual({ p1: 0, p2: 1000 });
  });
  it('기록이 없으면 빈 객체', () => {
    expect(mergeGroupFees([])).toEqual({});
  });
});
