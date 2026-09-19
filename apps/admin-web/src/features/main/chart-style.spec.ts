import { yDomainMax } from './chart-style';

describe('yDomainMax', () => {
  it('최댓값 위로 여유를 두고 눈금 4칸이 떨어지는 수로 올린다', () => {
    expect(yDomainMax(24)).toBe(32);
    expect(yDomainMax(598)).toBe(800);
    expect(yDomainMax(3)).toBe(4);
  });

  it('데이터가 없으면 0~4 로 둔다', () => {
    expect(yDomainMax(0)).toBe(4);
  });
});
