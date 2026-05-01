export function getSendCountFromStorage(key: string): {
  count: number
  expiresAt: number
} {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return { count: 0, expiresAt: 0 }
    const parsed = JSON.parse(raw)
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(key)
      return { count: 0, expiresAt: 0 }
    }
    return parsed
  } catch {
    return { count: 0, expiresAt: 0 }
  }
}

export function saveSendCountToStorage(
  key: string,
  count: number,
  expiresAt: number
) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ count, expiresAt }))
  } catch {}
}

export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "")
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`
  }
  return phone
}
