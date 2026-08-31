/**
 * 쿠폰 만료 표시의 판정 (#488 결정 1, W1).
 *
 * 라벨 자체는 화면마다 i18n 네임스페이스가 달라 여기서 만들지 않는다. **번역이 필요 없는
 * 판정만** 여기 둔다 — 그래야 vitest 가 닿는다(`.tsx` 안의 삼항 연산자는 어떤 러너도 안 본다).
 *
 * `expires_at` 이 `null` 인 데는 두 가지 서로 다른 이유가 있다:
 * 1. 정말 무기한이다.
 * 2. `validity_days` 정책 쿠폰인데 아직 발급받지 않았다 — 만료는 발급 시점부터 계산되므로
 *    (`computeExpiresAt`), 미발급 상태에선 만료일 자체가 정해지지 않았다. 이 경우
 *    `promotion_meta.ends_at`(발급 마감일)을 만료일인 것처럼 보여주면, 발급받는 순간
 *    만료일이 바뀌어 보였던 숫자가 거짓이 된다 — 그래서 서버(`displayExpiresAt`)가 이미
 *    이 경우를 `null` 로 접어 보낸다. 여기서는 그 두 경우를 `validity_days` 로 구분해
 *    「발급 후 N일」을 표시할 수 있게 한다.
 *
 * 이미 발급된 장(`is_assigned`)은 대상이 아니다 — 발급된 순간 만료일은 이미 링크 행에
 * 확정되어 있고(`expires_at` 이 채워지거나, 정말 무기한이라 null), «발급 후 N일» 은
 * 아직 발급 전인 쿠폰에만 의미가 있다.
 */

export type ExpiryDisplay =
  | { kind: 'dated'; date: string }
  | { kind: 'daysAfterClaim'; days: number }
  | { kind: 'unlimited' }

export type ExpiryDisplayInput = {
  expires_at?: string | null
  validity_days?: number | null
  is_assigned?: boolean
}

export function resolveExpiryDisplay(promo: ExpiryDisplayInput): ExpiryDisplay {
  if (promo.expires_at) return { kind: 'dated', date: promo.expires_at }
  if (!promo.is_assigned && promo.validity_days != null && promo.validity_days > 0) {
    return { kind: 'daysAfterClaim', days: promo.validity_days }
  }
  return { kind: 'unlimited' }
}
