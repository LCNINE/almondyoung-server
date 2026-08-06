import type { PolicyFlag, PolicyChoice } from './policy-counts';

export type PolicyChoices = Record<PolicyFlag, PolicyChoice>;

/** 배송비 그룹은 on/off 가 아니라 코드 선택이라 플래그와 별도 sentinel 을 쓴다. */
export const SHIPPING_GROUP_UNCHANGED = '__unchanged__';
export const SHIPPING_GROUP_DEFAULT = 'default';

export type PolicyPatch = Partial<Record<PolicyFlag, boolean>> & {
  shippingGroupCode?: string | null;
};

/** 'unchanged' 아닌 항목만 담은 patch. 모두 unchanged 면 빈 객체. */
export function buildPolicyPatch(
  choices: PolicyChoices,
  shippingGroupChoice: string = SHIPPING_GROUP_UNCHANGED
): PolicyPatch {
  const patch: PolicyPatch = {};
  (Object.keys(choices) as PolicyFlag[]).forEach((flag) => {
    const c = choices[flag];
    if (c === 'on') patch[flag] = true;
    else if (c === 'off') patch[flag] = false;
  });

  if (shippingGroupChoice !== SHIPPING_GROUP_UNCHANGED) {
    patch.shippingGroupCode =
      shippingGroupChoice === SHIPPING_GROUP_DEFAULT
        ? null
        : shippingGroupChoice;
  }

  return patch;
}

export function hasAnyChange(
  choices: PolicyChoices,
  shippingGroupChoice: string = SHIPPING_GROUP_UNCHANGED
): boolean {
  return Object.keys(buildPolicyPatch(choices, shippingGroupChoice)).length > 0;
}
