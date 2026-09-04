/**
 * 쿠폰 자동발급 트리거 어휘. **정본은 `apps/medusa/src/modules/promotion-meta/service.ts` 의 `AutoIssueTrigger`**
 * 이고 여기는 사본이다 — ADR-0033 §7 이 공유 타입을 만들지 않기로 했다(Medusa 는 `@packages/*` 를 런타임에
 * 해석하지 못한다). 정합은 `coupon-vocabulary-drift.spec.ts` 가 지키고, 각 값의 «발행자» 는
 * `coupon-trigger-sources.ts` + `coupon-trigger-producers.spec.ts` 가 지킨다 (#775, ADR-0035).
 */
export const AUTO_ISSUE_TRIGGERS = ['customer_registered', 'membership_activated'] as const;

export type AutoIssueTrigger = (typeof AUTO_ISSUE_TRIGGERS)[number];
