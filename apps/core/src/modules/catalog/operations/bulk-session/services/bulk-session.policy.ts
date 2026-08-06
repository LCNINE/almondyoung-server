import type { UpdateVariantStockPolicyDto } from '../../../../product-matching/dto/variant-matching-batch.dto';
import { applyDecisions } from './bulk-session.diff';
import { parseFieldPath } from './bulk-session.fields';
import type { ConflictDecisionMap, FlatFields, PrefillRow } from './bulk-session.types';

/**
 * `판매상태재정의`·`출시예정일` 은 **한 단위**다 — `upsertSalesVariantPolicy` 가 날짜를
 * override 키의 *존재*로 게이팅하므로(product-sku-mapping.service.ts:47-56) 둘을 따로
 * 다루면 날짜가 조용히 버려지거나(보내는 쪽) 지운 값이 되살아난다(거르는 쪽).
 *
 * 이 목록을 아래 두 곳이 공유한다: `extractVariantPolicies`(둘 중 하나만 바뀌어도 둘 다 싣는다)
 * 와 `applyPolicyDecisions`(둘 중 하나만 skip 이어도 둘 다 뺀다). 두 벌이 되면 한쪽만
 * 고쳤을 때 정확히 그 비대칭이 사고가 된다.
 */
const OVERRIDE_PAIR_KEYS = ['availabilityOverride', 'comingSoonDate'] as const;

/**
 * 조합 시트의 판매정책 열. **이 목록이 유일한 출처다** — 버전 적용기에서 빼는 쪽과
 * 정책으로 뽑는 쪽이 같은 집합을 봐야 한다. 두 벌이 되면 한쪽만 고쳤을 때 정책이 버전
 * 데이터로 새거나 그 반대가 된다.
 */
export const VARIANT_POLICY_KEYS: ReadonlySet<string> = new Set<string>([
  ...OVERRIDE_PAIR_KEYS,
  'preStockSellable',
  'alwaysSellableZeroStock',
]);

function isPolicyPath(path: string): boolean {
  const parsed = parseFieldPath(path);
  return parsed?.scope === 'variant' && VARIANT_POLICY_KEYS.has(parsed.key);
}

/** 버전 적용기에 넘길 적용분 — 정책 경로를 뺀 나머지. */
export function stripPolicyFields(fields: FlatFields): FlatFields {
  const out: FlatFields = {};
  for (const [path, value] of Object.entries(fields)) {
    if (isPolicyPath(path)) continue;
    out[path] = value;
  }
  return out;
}

export function hasPolicyFields(fields: FlatFields): boolean {
  return Object.keys(fields).some(isPolicyPath);
}

/**
 * 충돌 결정을 **정책 경로에도** 반영한다. 버전 경로는 `bulk-draft.applier.ts` 가
 * `applyDecisions` 로 이미 하는 일인데(스펙 §4.2 — "충돌 검사는 코드 추가 없이 정책 필드에
 * 적용된다"), 정책은 버전에 담기지 않아 그 단계를 지나치지 않으므로 여기서 같은 결정을 건다.
 *
 * **`applyDecisions` 만으로는 부족하다.** `extractVariantPolicies` 의 짝 칸 규약이
 * `comingSoonDate` 하나만 남아도 override 값을 **시트 원본에서 다시 읽으므로**, skip 한 값이
 * 그 경로로 되살아난다. 그래서 짝(`OVERRIDE_PAIR_KEYS`) 중 하나라도 skip 이면 그 조합의
 * override 축을 통째로 뺀다 — 그 조합의 `선판매`·`항상판매` 는 별개 축이라 남는다.
 *
 * 필터를 새로 발명하지 않고 `applyDecisions` 를 재사용한다 — skip 의 의미론이 두 벌이 되면
 * 버전과 정책이 서로 다른 결정을 따르게 된다.
 */
export function applyPolicyDecisions(fields: FlatFields, decisions: ConflictDecisionMap): FlatFields {
  const decided = applyDecisions(fields, decisions);

  const skippedOverrideCombos = new Set<string>();
  for (const [path, decision] of Object.entries(decisions)) {
    if (decision !== 'skip') continue;
    const parsed = parseFieldPath(path);
    if (parsed?.scope !== 'variant') continue;
    if (OVERRIDE_PAIR_KEYS.some((key) => key === parsed.key)) skippedOverrideCombos.add(parsed.scopeKey);
  }
  if (skippedOverrideCombos.size === 0) return decided;

  const out: FlatFields = {};
  for (const [path, value] of Object.entries(decided)) {
    const parsed = parseFieldPath(path);
    if (
      parsed?.scope === 'variant' &&
      OVERRIDE_PAIR_KEYS.some((key) => key === parsed.key) &&
      skippedOverrideCombos.has(parsed.scopeKey)
    ) {
      continue;
    }
    out[path] = value;
  }
  return out;
}

/** 워크북 표기 → DB enum. 빈칸은 해제(null). */
function toOverride(cell: string): 'manual_out_of_stock' | 'coming_soon' | null {
  const raw = cell.trim();
  if (raw === '품절') return 'manual_out_of_stock';
  if (raw === '출시예정') return 'coming_soon';
  return null;
}

/**
 * 차분에서 조합별 정책 패치를 뽑는다.
 *
 * **`판매상태재정의` 와 `출시예정일` 은 한 단위다.** 둘 중 하나라도 차분에 있으면 둘 다
 * **시트 행에서** 읽어 싣는다 — `upsertSalesVariantPolicy` 가 날짜를 override 키의
 * *존재*로 게이팅하므로(product-sku-mapping.service.ts:47-56) 날짜만 보내면 조용히
 * 버려진다. 차분에는 안 바뀐 키가 없으니 시트가 필요하다.
 *
 * **`선판매`·`항상판매` 의 빈칸은 지시 없음이다**(설계 스펙 §4.1) — Y/N 두 상태뿐인 칸을
 * 비우는 것은 해제가 아니다. 키를 만들지 않는다.
 */
export function extractVariantPolicies(
  fields: FlatFields,
  variantRows: PrefillRow[],
): Map<string, UpdateVariantStockPolicyDto> {
  const cellsByCombo = new Map<string, PrefillRow>();
  for (const row of variantRows) cellsByCombo.set((row.combination ?? '').trim(), row);

  const touched = new Map<string, Set<string>>();
  for (const path of Object.keys(fields)) {
    const parsed = parseFieldPath(path);
    if (!parsed || parsed.scope !== 'variant' || !VARIANT_POLICY_KEYS.has(parsed.key)) continue;
    const keys = touched.get(parsed.scopeKey) ?? new Set<string>();
    keys.add(parsed.key);
    touched.set(parsed.scopeKey, keys);
  }

  const out = new Map<string, UpdateVariantStockPolicyDto>();
  for (const [combo, keys] of touched) {
    const cells = cellsByCombo.get(combo);
    const patch: UpdateVariantStockPolicyDto = {};

    if (OVERRIDE_PAIR_KEYS.some((key) => keys.has(key))) {
      const override = toOverride(cells?.availabilityOverride ?? fields[`variant:${combo}.availabilityOverride`] ?? '');
      patch.availabilityOverride = override;
      patch.comingSoonDate = override === 'coming_soon' ? (cells?.comingSoonDate ?? '').trim() || null : null;
    }

    for (const key of ['preStockSellable', 'alwaysSellableZeroStock'] as const) {
      if (!keys.has(key)) continue;
      const raw = (fields[`variant:${combo}.${key}`] ?? '').trim();
      if (raw === '') continue; // 빈칸 = 지시 없음
      patch[key] = raw === 'Y';
    }

    if (Object.keys(patch).length > 0) out.set(combo, patch);
  }

  return out;
}
