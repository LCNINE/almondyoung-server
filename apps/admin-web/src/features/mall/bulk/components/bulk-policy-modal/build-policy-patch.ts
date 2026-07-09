import type { PolicyFlag, PolicyChoice } from './policy-counts';

export type PolicyChoices = Record<PolicyFlag, PolicyChoice>;

/** 'unchanged' 아닌 플래그만 boolean 으로 담은 patch. 모두 unchanged 면 빈 객체. */
export function buildPolicyPatch(
  choices: PolicyChoices
): Partial<Record<PolicyFlag, boolean>> {
  const patch: Partial<Record<PolicyFlag, boolean>> = {};
  (Object.keys(choices) as PolicyFlag[]).forEach((flag) => {
    const c = choices[flag];
    if (c === 'on') patch[flag] = true;
    else if (c === 'off') patch[flag] = false;
  });
  return patch;
}

export function hasAnyChange(choices: PolicyChoices): boolean {
  return Object.keys(buildPolicyPatch(choices)).length > 0;
}
