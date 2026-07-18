import {
  buildPolicyPatch,
  hasAnyChange,
  type PolicyChoices,
} from './build-policy-patch';

const choices = (over: Partial<PolicyChoices> = {}): PolicyChoices => ({
  hideMembershipPriceForNonMembers: 'unchanged',
  isVisibleToMembersOnly: 'unchanged',
  isOverseas: 'unchanged',
  ...over,
});

describe('buildPolicyPatch', () => {
  it("'unchanged' 아닌 플래그만 boolean 으로 담는다", () => {
    expect(
      buildPolicyPatch(
        choices({ isOverseas: 'on', isVisibleToMembersOnly: 'off' })
      )
    ).toEqual({
      isOverseas: true,
      isVisibleToMembersOnly: false,
    });
  });
  it('모두 unchanged 면 빈 객체', () => {
    expect(buildPolicyPatch(choices())).toEqual({});
  });
});

describe('hasAnyChange', () => {
  it('하나라도 변경이면 true', () => {
    expect(hasAnyChange(choices({ isOverseas: 'off' }))).toBe(true);
  });
  it('전부 unchanged 면 false', () => {
    expect(hasAnyChange(choices())).toBe(false);
  });
});
