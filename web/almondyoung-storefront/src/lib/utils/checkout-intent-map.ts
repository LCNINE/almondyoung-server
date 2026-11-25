const CHECKOUT_INTENT_PREFIX = "checkout_intent_cart:"

function getStorage() {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function setCheckoutCartByIntent(intentId: string, cartId: string) {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.setItem(`${CHECKOUT_INTENT_PREFIX}${intentId}`, cartId)
  } catch {
    // 일부 인앱 브라우저/프라이빗 모드에서는 sessionStorage 쓰기가 막힐 수 있다.
  }
}

export function getCheckoutCartByIntent(intentId: string): string | null {
  const storage = getStorage()
  if (!storage) return null

  try {
    return storage.getItem(`${CHECKOUT_INTENT_PREFIX}${intentId}`)
  } catch {
    return null
  }
}

export function removeCheckoutCartByIntent(intentId: string) {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.removeItem(`${CHECKOUT_INTENT_PREFIX}${intentId}`)
  } catch {
    // best-effort cleanup
  }
}

const PENDING_PAYMENT_MODE_KEY = "checkout_pending_payment_mode"

export type PendingPaymentMode = {
  mode: string
  intentId: string
  [key: string]: string
}

/**
 * 결제를 시작하며 그 결제(intent)가 어떤 모드인지 적어 둔다. 콜백 URL 에 mode 가 빠졌을 때의 대비책이다.
 *
 * 값은 콜백에서만 지워진다. 결제창에서 이탈하면 탭이 살아 있는 내내 남으므로, 콜백은 같은 intent 로
 * 돌아왔을 때만 이 값을 쓴다(`resolvePendingPaymentMode`). intent 를 함께 적지 않으면 같은 탭의
 * 다음 결제가 잔재를 주워 다른 경로로 샌다(#827 — 일반 상품 결제가 멤버십으로 분기해 주문이 성립하지 않았다).
 */
export function setPendingPaymentMode(
  mode: string,
  intentId: string,
  extra?: Record<string, string>
) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(
      PENDING_PAYMENT_MODE_KEY,
      JSON.stringify({ ...extra, mode, intentId })
    )
  } catch {
    // 결제 진행은 sessionStorage 저장 실패와 독립적으로 유지한다.
  }
}

/** 저장된 값이 이 intent 의 것일 때만 돌려준다. intent 없이 저장된 옛 형식은 어느 결제의 것인지 모르므로 버린다. */
export function resolvePendingPaymentMode(
  raw: string | null,
  intentId: string | null
): PendingPaymentMode | null {
  if (!raw || !intentId) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const value = parsed as Record<string, unknown>
  if (typeof value.mode !== "string" || value.intentId !== intentId) return null
  return value as PendingPaymentMode
}

export function getPendingPaymentMode(
  intentId: string | null
): PendingPaymentMode | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    return resolvePendingPaymentMode(
      storage.getItem(PENDING_PAYMENT_MODE_KEY),
      intentId
    )
  } catch {
    return null
  }
}

export function removePendingPaymentMode() {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(PENDING_PAYMENT_MODE_KEY)
  } catch {
    // best-effort cleanup
  }
}
