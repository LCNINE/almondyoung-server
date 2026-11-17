export type CartAddedToastPayload = {
  title: string
  thumbnail?: string | null
  membershipSavings?: number
  productMetadata?: Record<string, unknown> | null
}

type Snapshot = (CartAddedToastPayload & { key: number }) | null

let current: Snapshot = null
let seq = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function showCartAddedToast(payload: CartAddedToastPayload) {
  seq += 1
  current = { ...payload, key: seq }
  emit()
}

export function hideCartAddedToast() {
  current = null
  emit()
}

export function subscribeCartAddedToast(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function getCartAddedToast(): Snapshot {
  return current
}

export function getServerCartAddedToast(): Snapshot {
  return null
}
