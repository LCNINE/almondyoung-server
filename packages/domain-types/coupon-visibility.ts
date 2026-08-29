/**
 * 쿠폰이 고객에게 닿는 경로 (#488 N3).
 *
 * 가르는 기준은 «누가 쓸 수 있는가» 가 아니라 **«고객이 이 쿠폰을 어떻게 갖게 되는가»** 다.
 *
 * | visibility      | 갖게 되는 경로              | 목록 노출                       |
 * |-----------------|-----------------------------|---------------------------------|
 * | `public`        | 발급 없이 누구나            | 로그인 고객 전원                |
 * | `claimable`     | 고객이 «발급받기» 를 누른다 | 미발급자에게 별도 목록으로      |
 * | `assigned_only` | 관리자가 직권 발급한다      | 발급받은 고객에게만             |
 *
 * 정본을 여기 두는 이유는 이 값이 **세 트리에 여덟 벌로 흩어져 있었고, 그중 컴파일러가
 * 잡아주는 곳이 0곳**이었기 때문이다. 네 번째 값을 더하면서 admin-web 을 놓치면 제한 쿠폰이
 * 관리자 눈에 «공개» 로 보였다.
 *
 * ⚠️ **`apps/medusa` 와 `web/almondyoung-storefront` 는 이 파일을 import 하지 않는다.**
 * medusa 는 빌드에 번들러가 없어 `@packages/*` 별칭이 런타임에 해석되지 않고, storefront 는
 * 이 값을 읽는 코드가 0곳이라 의존성을 더할 이익이 없다. 두 트리의 사본과 DB CHECK 제약과의
 * 정합은 `coupon-vocabulary-drift.spec.ts` 가 대신 지킨다.
 */
export const COUPON_VISIBILITIES = ['public', 'claimable', 'assigned_only'] as const;

export type CouponVisibility = (typeof COUPON_VISIBILITIES)[number];

/** 값이 어휘 안에 있는가. */
export function isCouponVisibility(value: unknown): value is CouponVisibility {
  return typeof value === 'string' && (COUPON_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * 저장된 값을 어휘로 좁힌다. **두 실패를 구분한다.**
 *
 * - **없음(`null` · `undefined` · `''`) → `'public'`.** `promotion_meta.visibility` 컬럼이
 *   `NOT NULL DEFAULT 'public'` 이고 Medusa 읽기 경로도 전부 `?? 'public'` 이다. 즉 비어
 *   있는 것은 정상이고 «공개» 를 뜻한다.
 * - **어휘 밖 → `null`.** 여기서 `'public'` 으로 접으면 안 된다. 그것이 #488 N3 이 지적한
 *   바로 그 버그다(모르는 값이 «공개» 로 렌더된다). 호출부가 «모른다» 를 눈에 보이게
 *   렌더할 수 있도록 두 경우를 다른 값으로 돌려준다.
 */
export function toCouponVisibility(value: unknown): CouponVisibility | null {
  if (value == null || value === '') return 'public';
  return isCouponVisibility(value) ? value : null;
}
