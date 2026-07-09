import { flagStats, flagImpact, type PolicyFlagValues } from './policy-counts';

const item = (over: Partial<PolicyFlagValues> = {}): PolicyFlagValues => ({
  hideMembershipPriceForNonMembers: false,
  isVisibleToMembersOnly: false,
  isOverseas: false,
  ...over,
});

describe('flagStats', () => {
  it('플래그의 켜짐/꺼짐 개수를 센다', () => {
    const items = [
      item({ isOverseas: true }),
      item({ isOverseas: true }),
      item(),
    ];
    expect(flagStats(items, 'isOverseas')).toEqual({ on: 2, off: 1 });
  });
  it('빈 목록은 0/0', () => {
    expect(flagStats([], 'isVisibleToMembersOnly')).toEqual({ on: 0, off: 0 });
  });
});

describe('flagImpact', () => {
  it("'on' 은 꺼진 개수만큼 변경", () => {
    expect(flagImpact({ on: 2, off: 3 }, 'on')).toBe(3);
  });
  it("'off' 는 켜진 개수만큼 변경", () => {
    expect(flagImpact({ on: 2, off: 3 }, 'off')).toBe(2);
  });
  it("'unchanged' 는 0", () => {
    expect(flagImpact({ on: 2, off: 3 }, 'unchanged')).toBe(0);
  });
});
