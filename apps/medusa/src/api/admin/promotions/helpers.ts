import { ContainerRegistrationKeys, MedusaError, remoteQueryObjectFromString } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';

export const PROMOTION_FIELDS = [
  'id', 'code', 'is_automatic', 'is_tax_inclusive', 'type', 'status',
  'campaign_id', 'created_at', 'updated_at', 'deleted_at',
  'limit', 'used',
  '*campaign', '*campaign.budget',
  '*application_method',
  '*application_method.target_rules',
  'application_method.target_rules.values.value',
  '*application_method.buy_rules',
  'application_method.buy_rules.values.value',
  'rules.id', 'rules.attribute', 'rules.operator', 'rules.values.value',
];

/**
 * `additional_data` ↔ `promotion_meta` 사이를 오가는 키 전부.
 *
 * ⚠️ 이 배열은 **`additional-data-schema.ts` 의 검증 스키마와 같은 집합**이어야 한다.
 * 프레임워크가 검증기를 `z.object(shape)` 로 감싸는데 그 기본이 **strip** 이라, 스키마에 없는
 * 키는 400 이 아니라 **조용히 버려져** 훅까지 도달하지 못한다(2026-08-31 실측). 그 정합은
 * `__tests__/additional-data-schema.unit.spec.ts` 가 지킨다.
 */
export const META_KEYS = [
  'name',
  'max_discount_amount',
  'created_by',
  'visibility',
  'max_claims',
  'auto_issue_trigger',
  // 유효기간 «정책 축» (#488 결정 1). 인스턴스 축(링크 행 expires_at)은 발급 경로가 계산해 박는다.
  'starts_at',
  'ends_at',
  'validity_days',
] as const;

/**
 * `starts_at`/`ends_at`/`validity_days` 는 명시적 `null` 로 «비움» 을 표현할 수 있다(W3,
 * 2026-08-31) — 「30일로 정했다가 무기한으로」를 삭제·재생성(발급된 인스턴스 전부 무효화) 없이
 * 할 수 있어야 한다. 나머지 키는 옛 write-once 의미론 그대로다.
 */
const NULLABLE_META_KEYS = new Set<(typeof META_KEYS)[number]>([
  'starts_at',
  'ends_at',
  'validity_days',
]);

export function extractMetaFromAdditionalData(
  additional_data: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!additional_data) return null;
  const result: Record<string, unknown> = {};
  for (const key of META_KEYS) {
    if (NULLABLE_META_KEYS.has(key)) {
      // 🔴 「키 없음(안 건드림)」과 「키=null(비움)」을 반드시 구분한다 — 상태 토글(`{ status }`
      // 만 보낸다)이 이 키들을 갖고 있지 않은 것과, 관리자가 명시적으로 비운 것을 truthiness나
      // `!= null` 로는 가를 수 없다(그러면 상태 토글이 메타를 지워버린다 — P10-A 가 막아둔 구멍).
      if (key in additional_data) result[key] = additional_data[key] ?? null;
    } else if (additional_data[key] != null) {
      result[key] = additional_data[key];
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function toMetadataShape(record: any): Record<string, unknown> | null {
  if (!record) return null;
  const result: Record<string, unknown> = {};
  if (record.name != null) result.name = record.name;
  if (record.max_discount_amount != null) result.max_discount_amount = record.max_discount_amount;
  if (record.created_by != null) result.created_by = record.created_by;
  result.visibility = record.visibility ?? 'public';
  if (record.max_claims != null) result.max_claims = record.max_claims;
  if (record.auto_issue_trigger != null) result.auto_issue_trigger = record.auto_issue_trigger;
  if (record.starts_at != null) result.starts_at = record.starts_at;
  if (record.ends_at != null) result.ends_at = record.ends_at;
  if (record.validity_days != null) result.validity_days = record.validity_days;
  // 읽기 전용 발급 카운터 — 관리자 발급 현황 표시용(클라 write 대상 아님)
  if (record.issued_count != null) result.issued_count = record.issued_count;
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * `promotion_meta` **행이 없을 때** 의 `visibility`.
 *
 * 오늘 이 자리의 기본값은 전부 `'public'` 이었고, 그것이 #488 `N7` 의 손해를 키웠다 —
 * 메타 쓰기가 실패해 행이 안 남으면 「발급받은 사람만」 쿠폰이 **아무나 쓰는 쿠폰**이 됐다.
 * 검증기(`additional-data-schema.ts`)를 걸어도 `additional_data` **객체 자체를 생략**하면
 * 메타 0행 쿠폰은 계속 만들어진다(2026-08-31 실측) — 그 구멍을 막는 것이 이 상수다.
 *
 * 부수 효과는 의도한 것이다: 네이티브 Medusa 대시보드(`/app/promotions`)로 만든 쿠폰은
 * 메타가 없으므로 아무도 못 쓴다. 감사되지 않은 쓰기 경로가 **위험**에서 **무해**로 바뀐다.
 */
export const VISIBILITY_WHEN_META_MISSING = 'assigned_only' as const;

export type CouponVisibilityValue = 'public' | 'claimable' | 'assigned_only';

const KNOWN_VISIBILITIES: readonly CouponVisibilityValue[] = [
  'public',
  'claimable',
  'assigned_only',
];

/**
 * 메타 레코드에서 `visibility` 를 꺼낸다. **행이 없거나 어휘 밖이면 닫힌 쪽으로 접는다.**
 *
 * 행이 **있고** 컬럼만 비어 있는 경우는 `'public'` 이다 — 그 컬럼은
 * `NOT NULL DEFAULT 'public'`(`Migration20260526140000`) 이라 「비어 있음 = 공개」가 맞다.
 * `toMetadataShape` 안의 `?? 'public'` 이 그 의미론이고, 그래서 그 줄은 바꾸지 않는다.
 */
export function resolveVisibility(metaRecord: unknown): CouponVisibilityValue {
  const shape = toMetadataShape(metaRecord);
  if (!shape) return VISIBILITY_WHEN_META_MISSING;
  const value = shape.visibility as CouponVisibilityValue | undefined;
  return value && KNOWN_VISIBILITIES.includes(value) ? value : VISIBILITY_WHEN_META_MISSING;
}

/**
 * 「이 쿠폰은 발급받은 고객만 쓸 수 있는가」. 카트 게이트와 주문 확정 백스톱이 묻는 질문이다.
 *
 * 옛 코드는 `visibility === 'assigned_only' || === 'claimable'` 였는데, 메타가 없으면
 * `undefined` 라 **게이트를 통과**했다. 「공개가 아니면 발급 필요」로 뒤집으면 그 구멍이 닫힌다.
 */
export function requiresIssuance(metaRecord: unknown): boolean {
  return resolveVisibility(metaRecord) !== 'public';
}

async function remoteQueryPromotions(
  scope: any,
  variables: Record<string, unknown>,
  fields: string[] = PROMOTION_FIELDS,
): Promise<any[]> {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const queryObject = remoteQueryObjectFromString({
    entryPoint: 'promotion',
    variables,
    fields,
  });
  return remoteQuery(queryObject);
}

export async function fetchPromotionWithMeta(id: string, scope: any, fields?: string[]) {
  const promotionMetaService = scope.resolve(PROMOTION_META_MODULE);

  const promotions = await remoteQueryPromotions(
    scope,
    { filters: { $or: [{ id }, { code: id }] } },
    fields,
  );

  if (!promotions?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion with id or code: ${id} was not found`);
  }

  const promotion = promotions[0];
  const meta = await promotionMetaService.getByPromotionId(promotion.id);
  return { ...promotion, metadata: toMetadataShape(meta) };
}

// `meetsGroupRule` 은 삭제됐다 (P7, #488 1-5). 발급 시점 룰 평가는
// `../../../modules/promotion-meta/issuance-rules` 의 `evaluateIssuanceRules` /
// `isIssuableToCustomer` 하나뿐이다. 이 함수는 그룹 룰만 봐서 나머지 조건을 **조용히 통과**시켰다.

export { remoteQueryPromotions };

// 발급된 «한 장» 리더는 여기 없다 — `coupon_grant` 모델로 이관됐다(#488, Task 3~10).
// `../../../modules/promotion-meta/service` 의 `listGrantsForCustomer`/`listGrantsForPromotion` 을
// 쓸 것. 옛 링크 리더(`issued-link.ts`, W5 2026-08-31 도입)는 Task 10 이 걷어냈다.
