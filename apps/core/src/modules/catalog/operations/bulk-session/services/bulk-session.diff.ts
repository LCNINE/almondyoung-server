import type { ConflictMap, FlatFields } from './bulk-session.types';

/**
 * 변경분 = 업로드 값이 스냅샷과 다른 필드.
 *
 * **업로드 맵에 있는 키만 돈다.** 스냅샷에만 있는 키는 그 열이 파일에 없었다는 뜻이고,
 * 그건 "변경 없음"이다(§F2).
 */
export function computeChanges(base: FlatFields, mine: FlatFields): FlatFields {
  const out: FlatFields = {};
  for (const [key, value] of Object.entries(mine)) {
    if (value !== (base[key] ?? '')) out[key] = value;
  }
  return out;
}

/**
 * 충돌 = 내가 바꾼 필드 ∩ 스냅샷 이후 남이 바꾼 필드.
 *
 * 셋째 조건(`current !== mine`)이 있는 이유: 둘이 같은 값으로 바꿨으면 사람이 판단할 것이
 * 없다. 결정 화면에 뜨는 것은 정말 판단이 필요한 것만이어야 한다 — "덮어쓰기"를 고르는
 * 것은 **항상 남의 편집을 되돌리는 결정**이고, 그 무게가 노이즈에 묻히면 안 된다.
 */
export function detectConflicts(base: FlatFields, mine: FlatFields, current: FlatFields): ConflictMap {
  const out: ConflictMap = {};
  for (const [key, mineValue] of Object.entries(mine)) {
    const baseValue = base[key] ?? '';
    const currentValue = current[key] ?? '';
    if (mineValue !== baseValue && currentValue !== baseValue && currentValue !== mineValue) {
      out[key] = { base: baseValue, mine: mineValue, current: currentValue };
    }
  }
  return out;
}

/** 결정을 반영한 최종 적용분. 'skip' 인 필드는 남의 값을 그대로 둔다(포크가 이미 들고 있다). */
export function applyDecisions(changes: FlatFields, decisions: Record<string, string>): FlatFields {
  const out: FlatFields = {};
  for (const [key, value] of Object.entries(changes)) {
    if (decisions[key] === 'skip') continue;
    out[key] = value;
  }
  return out;
}
