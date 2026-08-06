import {
  buildPolicyPatch,
  hasAnyChange,
  SHIPPING_GROUP_DEFAULT,
  SHIPPING_GROUP_UNCHANGED,
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

describe('buildPolicyPatch - 배송비 그룹', () => {
  const noFlags: PolicyChoices = {
    hideMembershipPriceForNonMembers: 'unchanged',
    isVisibleToMembersOnly: 'unchanged',
    isOverseas: 'unchanged',
  };

  it('변경 안 함이면 patch 에 넣지 않는다', () => {
    expect(buildPolicyPatch(noFlags, SHIPPING_GROUP_UNCHANGED)).toEqual({});
    expect(hasAnyChange(noFlags, SHIPPING_GROUP_UNCHANGED)).toBe(false);
  });

  it('기본 그룹 선택은 null 로 보낸다 (컬럼을 비워 기본값으로 되돌린다)', () => {
    expect(buildPolicyPatch(noFlags, SHIPPING_GROUP_DEFAULT)).toEqual({
      shippingGroupCode: null,
    });
    expect(hasAnyChange(noFlags, SHIPPING_GROUP_DEFAULT)).toBe(true);
  });

  it('그룹 코드를 그대로 담는다', () => {
    expect(buildPolicyPatch(noFlags, 'meal')).toEqual({ shippingGroupCode: 'meal' });
  });

  it('플래그 변경과 함께 담을 수 있다', () => {
    expect(
      buildPolicyPatch({ ...noFlags, isOverseas: 'on' }, 'meal')
    ).toEqual({ isOverseas: true, shippingGroupCode: 'meal' });
  });
});
