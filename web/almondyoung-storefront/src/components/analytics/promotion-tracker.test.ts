import { useEffect, useRef } from "react"
import { expect, it, vi } from "vitest"
import { PromotionTracker } from "./promotion-tracker"

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: vi.fn(),
  useRef: vi.fn(),
}))

it("records visibility once and ignores clicks outside links and buttons", () => {
  let notify: IntersectionObserverCallback | undefined

  const disconnect = vi.fn()

  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback
      }
      observe() {}
      disconnect = disconnect
    }
  )

  class ClickTarget {
    constructor(private interactive: boolean) {}
    closest() {
      return this.interactive ? this : null
    }
  }

  vi.stubGlobal("Element", ClickTarget)

  const gtag = vi.fn()

  vi.stubGlobal("window", { gtag })
  vi.mocked(useRef)
    .mockReturnValueOnce({ current: {} })
    .mockReturnValueOnce({ current: false })

  const promotion = {
    promotion_id: "sale-1",
    promotion_name: "Summer sale",
    creative_slot: "time_sale_main:home-top",
    items: [{ item_id: "product-1", item_name: "Product" }],
  }

  try {
    const element = PromotionTracker({ promotion, children: "Product" })

    const cleanup = vi.mocked(useEffect).mock.calls[0][0]()

    const visible = (ratio: number) =>
      notify?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: ratio,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      )

    visible(0)
    expect(gtag).not.toHaveBeenCalled()

    visible(0.5)
    visible(1)
    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith("event", "view_promotion", promotion)

    element.props.onClick({ target: new ClickTarget(false) })
    expect(gtag).toHaveBeenCalledTimes(1)

    element.props.onClick({ target: new ClickTarget(true) })
    expect(gtag).toHaveBeenLastCalledWith(
      "event",
      "select_promotion",
      promotion
    )
    cleanup?.()
  } finally {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  }
})
