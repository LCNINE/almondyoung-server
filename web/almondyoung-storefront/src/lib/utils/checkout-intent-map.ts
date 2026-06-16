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

export function setPendingPaymentMode(
  mode: string,
  extra?: Record<string, string>
) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(
      PENDING_PAYMENT_MODE_KEY,
      JSON.stringify({ mode, ...extra })
    )
  } catch {
    // 결제 진행은 sessionStorage 저장 실패와 독립적으로 유지한다.
  }
}

export function getPendingPaymentMode(): {
  mode: string
  [key: string]: string
} | null {
  const storage = getStorage()
  if (!storage) return null
  let raw: string | null = null
  try {
    raw = storage.getItem(PENDING_PAYMENT_MODE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    return JSON.parse(raw)
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
