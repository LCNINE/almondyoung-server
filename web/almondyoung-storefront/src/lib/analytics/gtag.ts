declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

export interface GaItem {
  item_id: string
  item_name: string
  item_variant?: string
  price: number
  quantity: number
}

/**
 * GA4 이벤트 전송. NEXT_PUBLIC_GA_ID 가 없는 환경(dev/로컬)에서는
 * window.gtag 자체가 없으므로 no-op 이다.
 */
export function trackEvent(name: string, params: Record<string, unknown>) {
  if (typeof window === "undefined" || !window.gtag) return
  window.gtag("event", name, params)
}

/**
 * 새로고침/재마운트로 같은 이벤트가 중복 집계되면 안 되는 경우(구매, 체크아웃 진입)에 쓴다.
 * key 는 거래·카트처럼 1회성이 보장되는 식별자로 만들 것.
 */
export function trackEventOnce(
  key: string,
  name: string,
  params: Record<string, unknown>
) {
  if (typeof window === "undefined" || !window.gtag) return
  if (sessionStorage.getItem(key)) return
  window.gtag("event", name, params)
  sessionStorage.setItem(key, "1")
}

export function toGaCurrency(currencyCode?: string | null) {
  return (currencyCode ?? "krw").toUpperCase()
}

export type GaPromotion = {
  promotion_id: string
  promotion_name: string
  creative_slot?: string
}
