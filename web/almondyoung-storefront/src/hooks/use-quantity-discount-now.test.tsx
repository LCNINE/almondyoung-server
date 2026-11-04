// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readTiers } from "@/lib/utils/quantity-discount"
import { useQuantityDiscountNow } from "./use-quantity-discount-now"

const productMetadata = { quantityDiscount: { startsAt: null, endsAt: "2026-11-10T03:00:04.999Z" } }
const variantMetadata = { tieredPrices: [{ minQuantity: 3, price: 9500 }] }

function TierCount() {
  const now = useQuantityDiscountNow([productMetadata])
  return <span>{readTiers(variantMetadata, productMetadata, now).regular.length}</span>
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-10T03:00:00.000Z"))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe("useQuantityDiscountNow", () => {
  it("drops the tiers on an open screen the moment the period ends", () => {
    act(() => root.render(<TierCount />))
    expect(container.textContent).toBe("1")

    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(container.textContent).toBe("1")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.textContent).toBe("0")
  })
})
