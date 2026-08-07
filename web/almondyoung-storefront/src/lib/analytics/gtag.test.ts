import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { toGaCurrency, trackEvent, trackEventOnce } from "./gtag"

// vitest environment 가 node 라 window/sessionStorage 가 없다.
// 이 테스트 하나 때문에 jsdom 을 붙이는 대신 최소 스텁만 세운다.
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  globalThis.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage
  globalThis.window = globalThis as unknown as Window & typeof globalThis
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage
})

describe("gtag", () => {
  it("gtag 미주입 환경(dev)에서는 던지지 않고 no-op", () => {
    delete window.gtag

    expect(() => trackEvent("view_item", { value: 1 })).not.toThrow()
    expect(() => trackEventOnce("k", "purchase", { value: 1 })).not.toThrow()
    // no-op 이었으므로 가드 키도 남지 않아야 GA 주입 후 첫 발사를 막지 않는다
    expect(sessionStorage.getItem("k")).toBeNull()
  })

  it("trackEventOnce 는 같은 키로 한 번만 보낸다", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    trackEventOnce("ga4_purchase_1", "purchase", { value: 1000 })
    trackEventOnce("ga4_purchase_1", "purchase", { value: 1000 })
    trackEventOnce("ga4_purchase_2", "purchase", { value: 2000 })

    expect(gtag).toHaveBeenCalledTimes(2)
  })

  it("trackEvent 는 매번 보낸다", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    trackEvent("add_to_cart", { value: 1 })
    trackEvent("add_to_cart", { value: 1 })

    expect(gtag).toHaveBeenCalledTimes(2)
    expect(gtag).toHaveBeenCalledWith("event", "add_to_cart", { value: 1 })
  })

  it("통화코드는 대문자, 없으면 KRW", () => {
    expect(toGaCurrency("krw")).toBe("KRW")
    expect(toGaCurrency(null)).toBe("KRW")
    expect(toGaCurrency(undefined)).toBe("KRW")
  })
})
