export type PolicyFlag =
  | 'hideMembershipPriceForNonMembers'
  | 'isVisibleToMembersOnly'
  | 'isOverseas';

export type PolicyChoice = 'unchanged' | 'on' | 'off';

export type PolicyFlagValues = Record<PolicyFlag, boolean>;

export function flagStats(
  items: PolicyFlagValues[],
  flag: PolicyFlag
): { on: number; off: number } {
  let on = 0;
  for (const it of items) if (it[flag]) on += 1;
  return { on, off: items.length - on };
}

/** 선택(choice) 적용 시 값이 실제로 바뀌는 상품 수. */
export function flagImpact(
  stats: { on: number; off: number },
  choice: PolicyChoice
): number {
  if (choice === 'on') return stats.off; // 꺼진 것들이 켜짐
  if (choice === 'off') return stats.on; // 켜진 것들이 꺼짐
  return 0;
}
