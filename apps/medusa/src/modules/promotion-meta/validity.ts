/**
 * 쿠폰 유효기간의 «두 축» 판정 (#488 결정 1, P4+P5).
 *
 * - **정책 축** (`promotion_meta.starts_at`/`ends_at`/`validity_days`) — 쿠폰 자체가 살아있는 구간.
 *   `claimable`·`assigned_only` 에겐 **발급 가능 구간**, `public` 에겐 발급이라는 사건이 없으므로
 *   그대로 **사용 가능 구간**이다.
 * - **인스턴스 축** (링크 행의 `expires_at`) — 발급된 한 장의 수명. 발급 시점에 계산해 박는다.
 *   정책에서 매번 도출하면 「+30일」을 「+7일」로 바꾸는 순간 이미 발급된 쿠폰이 소급 만료된다.
 *
 * 캠페인 날짜는 쓰지 않는다 — `computeActions` 가 `listActivePromotions_` 를 타서 캠페인 창이
 * 지난 프로모션을 할인 계산에서 **제외**하므로, 「발급 후 N일」이 표현되지 않는다.
 *
 * 컨테이너도 워크플로도 모르는 순수 함수다. 라우트 안 클로저로 두면 검증 대상 밖이다(#488 P1 교훈).
 */

export type ValidityPolicy = {
  starts_at?: Date | string | null;
  ends_at?: Date | string | null;
  /** 숫자 컬럼이 DB 에서 문자열로 오는 경우가 있어 union 이다(`issued_count` 와 같은 이유). */
  validity_days?: number | string | null;
};

export type IssuedInstance = { expires_at?: Date | string | null } | null | undefined;

export type WindowState = 'ok' | 'not_started' | 'ended';

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDays(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  // `Math.floor` 였다면 0.5 가 0 을 통과시켜 "발급 즉시 만료"가 된다 — 오늘의 쓰기 경로(zod
  // `.int()`, DB CHECK `> 0`)는 막지만, 이 함수는 그 가드 이전에 쓰인 행과
  // `restoreMetaSnapshots` 가 복원한 행도 읽는 순수 함수다. `service.ts` 의 형제 검증과 같은
  // 규칙(`Number.isInteger`)으로 맞춘다.
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 발급 시점에 링크 행 `expires_at` 에 박을 값. `null` 이면 무기한.
 *
 * `validity_days` 가 `ends_at` 보다 우선한다 — 상대 만료를 지정했다는 것은 「창과 무관하게
 * 받은 날부터 N일」이라는 뜻이기 때문이다. DB CHECK 로 둘의 공존을 막지는 않는다(정책 변경 중
 * 잠깐 둘 다 채워질 수 있다).
 */
export function computeExpiresAt(
  policy: ValidityPolicy | null | undefined,
  issuedAt: Date,
): Date | null {
  const days = toDays(policy?.validity_days);
  if (days !== null) return new Date(issuedAt.getTime() + days * DAY_MS);
  return toDate(policy?.ends_at);
}

/**
 * **정책 축의 시작 시각이 지났는가.** `starts_at` 이 없으면 항상 `true`.
 *
 * 🔴 이 검사는 **발급 여부와 무관하다** — 장(grant)을 가진 고객에게도 그대로 적용된다.
 * `hasUsableGrant` 는 장의 만료/소모만 보므로 정책 시작을 모른다. 게이트가 장 유무로
 * 분기하면서 이 검사를 grant 없는 쪽에만 두면, **장을 가진 고객에게는 `starts_at` 이
 * 사라진다**(2026-09-02 전체 리뷰 Critical). 그래서 세 게이트(카트 미들웨어·완료 백스톱·
 * 마이페이지)가 분기 «밖»에서 이 함수를 부르고, 여기 한 곳이 경계의 정본이다.
 *
 * `issuanceWindowState`·`isUsable` 도 같은 정의를 쓴다 — 경계(`now >= startsAt` 포함)가
 * 갈리면 표시와 판정이 어긋난다(`displayExpiresAt` 헤더 주석이 막으려는 그 실패다).
 */
export function hasPolicyStarted(policy: ValidityPolicy | null | undefined, now: Date): boolean {
  const startsAt = toDate(policy?.starts_at);
  return !startsAt || now >= startsAt;
}

/** 지금 이 쿠폰을 **발급**할 수 있는가. 경계 시각은 양쪽 다 포함이다. */
export function issuanceWindowState(
  policy: ValidityPolicy | null | undefined,
  now: Date,
): WindowState {
  if (!hasPolicyStarted(policy, now)) return 'not_started';
  const endsAt = toDate(policy?.ends_at);
  if (endsAt && now > endsAt) return 'ended';
  return 'ok';
}

export function isWithinIssuanceWindow(
  policy: ValidityPolicy | null | undefined,
  now: Date,
): boolean {
  return issuanceWindowState(policy, now) === 'ok';
}

/**
 * 지금 이 쿠폰을 **사용**할 수 있는가.
 *
 * 만료의 주인은 **링크 행이 있으면 링크 행**이다 — 그래야 「발급 마지막 날 받은 +30일 쿠폰이
 * 발급 창 종료와 함께 죽는」 일이 없다. 링크가 없으면(=발급 개념이 없는 `public`) 정책이 정한다.
 *
 * ⚠️ `expires_at` 이 NULL 인 링크는 **무기한**으로 읽는다. 이 변경 전에 발급된 행과, 롤링 배포
 * 중 옛 태스크가 만든 행이 그렇다. 만료 방향으로 fail-open 이고, 방향이 「고객에게 유리」다.
 * 기존 행은 `scripts/detach-coupon-campaigns.ts` 가 정책값으로 백필한다.
 */
export function isUsable(
  instance: IssuedInstance,
  policy: ValidityPolicy | null | undefined,
  now: Date,
): boolean {
  if (!hasPolicyStarted(policy, now)) return false;

  const expiresAt = instance ? toDate(instance.expires_at) : toDate(policy?.ends_at);
  if (expiresAt && now > expiresAt) return false;

  return true;
}

/**
 * 스토어 응답에 «이 쿠폰이 언제까지인가」로 내보낼 값.
 *
 * - **링크 행이 있으면 링크 행의 `expires_at`.**
 * - **없고 정책이 `validity_days` 를 가지면 `null`.** 그 날짜(=정책의 `ends_at`)는 이 쿠폰이
 *   «발급 가능한 마지막 날」이지 이 쿠폰이 «만료되는 날」이 아니다 — `validity_days` 정책은
 *   만료를 발급 시점부터 계산하므로(`computeExpiresAt`), 미발급 상태에선 만료일 자체가 아직
 *   정해지지 않았다. `ends_at` 을 그대로 보여주면 고객이 「이 날짜까지 쓸 수 있다」로 읽고,
 *   막상 발급받는 순간 만료일이 (보통 더 뒤로) 바뀌어 보였던 숫자가 거짓이 된다(W1, 2026-08-31).
 * - **그 외에는 정책의 `ends_at`.** 둘 다 없으면 무기한(`null`).
 *
 * 🔴 `isUsable` 은 이 규칙을 따르지 않는다 — 그쪽은 여전히 «미발급 쿠폰은 정책 창이 사용 가능
 * 여부를 정한다」를 유지한다(표시와 판정을 가르는 것이 이 모듈의 요점). 여기서 `validity_days`
 * 미발급 케이스를 `null` 로 접어도 `isUsable` 은 손대지 않는다.
 *
 * `preview`·`events/:slug`·`me/promotions` 세 라우트가 각자 이 선택을 인라인으로 들고 있다가
 * 두 번 버그가 났다: `link.expires_at ?? policy.ends_at` 로 합치면 «발급된 무기한 링크»(`expires_at`
 * 이 정당하게 `null`)가 `??` 에 「없음」으로 읽혀 정책 값으로 새고, `&& !instance` 같은 조건을
 * 얹으면 다른 판정(`isUsable`)과 라벨이 어긋난다. 그래서 이 선택 자체를 여기 한 곳에 둔다 —
 * 인스턴스 존재 여부는 `?:` 로만 분기하고 `??` 를 쓰지 않는다.
 */
export function displayExpiresAt(
  instance: IssuedInstance,
  policy: ValidityPolicy | null | undefined,
): string | Date | null {
  if (instance) return instance.expires_at ?? null;
  if (toDays(policy?.validity_days) !== null) return null;
  return policy?.ends_at ?? null;
}
