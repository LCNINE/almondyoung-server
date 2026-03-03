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
