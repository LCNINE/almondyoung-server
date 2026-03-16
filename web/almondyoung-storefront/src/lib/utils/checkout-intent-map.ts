const CHECKOUT_INTENT_PREFIX = "checkout_intent_cart:"

function getStorage() {
  if (typeof window === "undefined") {
    return null
  }

  return window.sessionStorage
}

export function setCheckoutCartByIntent(intentId: string, cartId: string) {
  const storage = getStorage()
  if (!storage) return

  storage.setItem(`${CHECKOUT_INTENT_PREFIX}${intentId}`, cartId)
}

export function getCheckoutCartByIntent(intentId: string): string | null {
  const storage = getStorage()
  if (!storage) return null

  return storage.getItem(`${CHECKOUT_INTENT_PREFIX}${intentId}`)
}

export function removeCheckoutCartByIntent(intentId: string) {
  const storage = getStorage()
  if (!storage) return

  storage.removeItem(`${CHECKOUT_INTENT_PREFIX}${intentId}`)
}

const PENDING_PAYMENT_MODE_KEY = "checkout_pending_payment_mode"

export function setPendingPaymentMode(
  mode: string,
  extra?: Record<string, string>
) {
  const storage = getStorage()
  if (!storage) return
  storage.setItem(
    PENDING_PAYMENT_MODE_KEY,
    JSON.stringify({ mode, ...extra })
  )
}

export function getPendingPaymentMode(): {
  mode: string
  [key: string]: string
} | null {
  const storage = getStorage()
  if (!storage) return null
  const raw = storage.getItem(PENDING_PAYMENT_MODE_KEY)
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
  storage.removeItem(PENDING_PAYMENT_MODE_KEY)
}
