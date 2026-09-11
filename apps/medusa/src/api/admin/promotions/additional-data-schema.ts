import { z } from '@medusajs/framework/zod';

/**
 * `POST /admin/promotions*` 의 `additional_data` 검증 스키마 (#488 N7).
 *
 * **왜 필요한가.** 코어 zod 는 `additional_data` **안쪽을 보지 않는다** —
 * `WithAdditionalData` 가 검증기 없을 때 `z.record(z.unknown()).nullish()` 로 열어둔다
 * (`@medusajs/medusa/dist/api/utils/validators.js:12-15`). 그 결과 어휘 밖 `visibility` 가
 * DB CHECK 까지 가서 500 이 나고, 그 시점에 프로모션은 이미 active 로 만들어져 있었다.
 * 여기 검증기를 걸면 워크플로 이전에 **400** 이 나고 프로모션 행이 남지 않는다(2026-08-31 실측).
 *
 * ⚠️ **`@packages/domain-types` 의 `COUPON_VISIBILITIES` 를 import 하지 않는다.** Medusa 빌드에는
 * 번들러가 없어 `@packages/*` 별칭이 런타임에 해석되지 않는다. 아래 리터럴은 **의도된 사본**이고,
 * 정본과의 정합은 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 지킨다.
 *
 * ⚠️ **키를 더하려면 `helpers.ts` 의 `META_KEYS` 와 함께 더할 것.** 프레임워크가 이 shape 을
 * `z.object(...)` 로 감싸는데 그 기본이 **strip** 이라, 여기 없는 키는 400 이 아니라 조용히
 * 버려져 훅까지 도달하지 못한다. `__tests__/additional-data-schema.unit.spec.ts` 가 두 집합의
 * 일치를 강제한다.
 */

const visibility = z.enum(['public', 'claimable', 'assigned_only']);
const autoIssueTrigger = z.enum(['customer_registered', 'membership_activated']);
const maxClaims = z.number().int().positive();
const maxDiscountAmount = z.number().int().positive();
/** ISO 8601 문자열. 폼의 `datetime-local` 값을 `toISOString()` 한 것이 온다. */
const isoDateTime = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
  message: 'must be a parseable ISO date-time string',
});
const validityDays = z.number().int().positive();
/**
 * 「쿠폰 이름」 (#789). 이제 **고객이 보는 제목**이라 상한이 필요하다 — 카드·체크아웃
 * 드롭다운은 한 줄에 `truncate` 로 가두므로, 상한이 없으면 문단을 붙여 넣어도 400 이 안 나고
 * 화면에서 조용히 잘린다. 운영자는 무엇이 잘렸는지 모른다.
 *
 * 🔴 `.optional()` 은 유지한다. 필수화는 **admin-web 폼에서만** 한다 — 여기서 required 로
 * 바꾸면 `additional_data` 를 보내는 다른 경로(시드·스크립트·자동발급 훅)가 400 으로 깨진다.
 */
const couponName = z.string().max(60);

/**
 * 생성용. `visibility` 만 **필수**다 — 이 값이 없으면 「발급 정책 없는 쿠폰」이 되고
 * 그 기본값 판단을 읽기 계층이 떠안게 된다.
 *
 * 🔴 이 필수 지정이 막지 **못하는** 것: `additional_data` **객체 자체의 생략**. 프레임워크가
 * `z.object(shape).nullish()` 로 감싸기 때문이다(실측). 그 구멍은 검증이 아니라
 * **닫힌 기본값**(`helpers.ts` 의 `resolveVisibility`)이 막는다.
 */
export const promotionAdditionalDataCreateShape = {
  visibility,
  name: couponName.optional(),
  created_by: z.string().optional(),
  max_claims: maxClaims.optional(),
  max_discount_amount: maxDiscountAmount.optional(),
  auto_issue_trigger: autoIssueTrigger.optional(),
  // nullable (W3, 2026-08-31): 명시적 null 로 «비움» 을 표현할 수 있어야 한다. `helpers.ts` 의
  // `extractMetaFromAdditionalData` 가 「키 없음(안 건드림)」과 「키=null(비움)」을 구분한다.
  starts_at: isoDateTime.nullable().optional(),
  ends_at: isoDateTime.nullable().optional(),
  validity_days: validityDays.nullable().optional(),
};

/**
 * 수정용. 전부 optional 이다 — 어드민의 상태 토글은 `{ status }` 만 보내고, 메타 부분 갱신도
 * 보내는 키만 덮는 것이 옛 라우트의 의미론이었다.
 */
export const promotionAdditionalDataUpdateShape = {
  visibility: visibility.optional(),
  name: couponName.optional(),
  created_by: z.string().optional(),
  max_claims: maxClaims.optional(),
  max_discount_amount: maxDiscountAmount.optional(),
  auto_issue_trigger: autoIssueTrigger.optional(),
  // nullable (W3, 2026-08-31): 「30일로 정했다가 무기한으로」처럼 되돌릴 수 있어야 한다 —
  // 수정 화면이 없어 복구가 삭제·재생성뿐이면 이미 발급된 인스턴스가 전부 무효화된다.
  // `{ ends_at: null }` 은 허용하고, 키 자체의 생략(상태 토글 `{ status }`)과는 구분한다
  // (`extractMetaFromAdditionalData` 의 `key in additional_data`).
  starts_at: isoDateTime.nullable().optional(),
  ends_at: isoDateTime.nullable().optional(),
  validity_days: validityDays.nullable().optional(),
};
