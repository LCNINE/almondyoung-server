/**
 * 발급 시점의 룰 평가 (#488 `1-5`, P7).
 *
 * 엔진의 룰 평가(`areRulesValidForContext`)는 **카트 컨텍스트**에서 `rule.attribute` 경로를
 * 뽑아 비교한다. 그런데 **발급 시점에는 카트가 없다.** 그래서 「모든 룰을 평가한다」는 처방은
 * 그대로 쓰면 틀린다 — 룰을 두 부류로 갈라야 한다.
 *
 * - **고객 고유** — 카트 없이 평가할 수 있고 평가해야 의미가 있다. 오늘 `customer.groups.id` 하나뿐.
 * - **카트 문맥** — 발급 시점에 평가할 수 없고, **막아서도 안 된다.** 고객이 나중에 그 리전에서
 *   살 수 있다. 그래서 «의도적으로 무시»한다. 성능이 아니라 의미 때문이다.
 * - **그 외 전부** — **fail-closed.** 발급하지 않고 skip + 로그.
 *
 * 🔴 **fail-closed 의 근거는 «네이티브 대시보드가 나머지를 만들 수 있으니까»가 아니다.**
 * 네이티브 대시보드를 쓰지 않는 것이 우리 원칙이라 그 논거는 성립하지 않는다. 옳은 근거는
 * 반대 방향이다(#488 `N5`): 엔진이 지원하는 조건을 우리 화면이 안 만드는 것은 **admin-web 의
 * 기능 미비**이고, 언젠가 채워진다. **그날 이 파일이 준비돼 있지 않으면 그 순간부터 조건을
 * 무시한 발급이 조용히 시작된다.** fail-closed 는 그 창을 막고, 새 조건을 화면에 추가한 사람이
 * 발급 쪽도 함께 손봐야 한다는 것을 즉시 알게 한다.
 *
 * 목록을 닫아 두는 대가는 「엔진이 여섯 번째 속성을 추가하면 그 쿠폰이 아무에게도 안 나간다」
 * 인데, 그것을 프로덕션 전에 알아채라고 `__tests__/issuance-rules-engine-drift.unit.spec.ts` 가 있다.
 *
 * 컨테이너도 워크플로도 모르는 순수 함수다 — 라우트 안 클로저로 두면 Medusa 유닛 러너가
 * `__tests__/*.unit.spec.ts` 만 매치하므로 검증 대상 밖이 된다.
 */

export type PromotionRuleValueLike = { value?: string | null } | string | null | undefined;

export type PromotionRuleLike = {
  attribute?: string | null;
  operator?: string | null;
  values?: readonly PromotionRuleValueLike[] | null;
};

/**
 * 발급 시점에 평가하는 룰. **(속성, operator) 쌍으로 닫는다.**
 *
 * operator 까지 못 박는 이유: 엔진은 `gt|lt|eq|ne|in|lte|gte` 를 전부 허용하는데
 * (`@medusajs/types` `PromotionRuleOperatorValues`), 우리 폼이 만드는 것은 `in` 뿐이다
 * (`build-create-promotion-payload.ts:77-84`). `ne` 로 들어온 그룹 룰을 `in` 처럼 읽으면
 * **의미가 정반대로 뒤집힌 채 조용히 발급**된다 — 속성만 보는 분류표는 그 사고를 못 막는다.
 */
const CUSTOMER_SCOPED_RULES: readonly { attribute: string; operator: string }[] = [
  { attribute: 'customer.groups.id', operator: 'in' },
];

/** 위 목록의 속성 축. 드리프트 가드와 스펙이 읽는다. */
export const CUSTOMER_SCOPED_ATTRIBUTES: readonly string[] = ['customer.groups.id'];

/**
 * 발급 시점에 **의도적으로 무시**하는 속성.
 *
 * 앞 넷은 엔진이 어드민에 노출하는 ORDER 스코프 속성이고, `subtotal` 은 **엔진이 노출하지
 * 않는데 우리 폼이 만드는 값**이라 명시적으로 넣는다. 빼면 최소주문금액 쿠폰이 전부
 * fail-closed 로 떨어진다.
 */
export const CART_CONTEXT_ATTRIBUTES: readonly string[] = [
  'region.id',
  'shipping_address.country_code',
  'sales_channel_id',
  'currency_code',
  'subtotal',
];

export type IssuanceEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'group_mismatch' }
  | { eligible: false; reason: 'unsupported_rule'; attribute: string; operator: string };

function ruleValues(rule: PromotionRuleLike): string[] {
  return (rule.values ?? [])
    .map((v) => (typeof v === 'string' ? v : v?.value))
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * 이 고객에게 지금 이 쿠폰을 **발급**할 수 있는가.
 *
 * 카트 문맥 룰은 건너뛴다. 분류표 밖은 거부한다. 거부 사유는 호출부가 skip 사유·로그로 쓴다.
 */
export function evaluateIssuanceRules(
  rules: readonly PromotionRuleLike[] | null | undefined,
  customerGroupIds: ReadonlySet<string>,
): IssuanceEligibility {
  for (const rule of rules ?? []) {
    const attribute = rule?.attribute ?? '';
    const operator = rule?.operator ?? '';

    if (CART_CONTEXT_ATTRIBUTES.includes(attribute)) continue;

    const supported = CUSTOMER_SCOPED_RULES.some(
      (r) => r.attribute === attribute && r.operator === operator,
    );
    if (!supported) {
      return { eligible: false, reason: 'unsupported_rule', attribute, operator };
    }

    // 여기 도달하는 것은 오늘 `customer.groups.id` + `in` 하나뿐이다.
    const requiredIds = ruleValues(rule);
    if (!requiredIds.some((id) => customerGroupIds.has(id))) {
      return { eligible: false, reason: 'group_mismatch' };
    }
  }

  return { eligible: true };
}

/** `evaluateIssuanceRules` 의 boolean 판. 표시 경로의 필터가 쓴다. */
export function isIssuableToCustomer(
  rules: readonly PromotionRuleLike[] | null | undefined,
  customerGroupIds: ReadonlySet<string>,
): boolean {
  return evaluateIssuanceRules(rules, customerGroupIds).eligible;
}

/**
 * 이 쿠폰의 판정에 **고객이 누구인지**가 필요한가.
 *
 * 비로그인 프리뷰가 「로그인해야 알 수 있다」를 고르는 데 쓴다. 카트 문맥 룰만 있으면 고객과
 * 무관하므로 false 다. 분류표 밖 룰은 true 로 접는다 — 어차피 로그인해도 거부되지만, 비로그인
 * 응답에 새 어휘를 만들지 않기 위해 여기서 흡수한다.
 */
export function requiresCustomerContext(
  rules: readonly PromotionRuleLike[] | null | undefined,
): boolean {
  return (rules ?? []).some((rule) => !CART_CONTEXT_ATTRIBUTES.includes(rule?.attribute ?? ''));
}
