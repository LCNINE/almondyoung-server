// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import productCard from "@/i18n/messages/ko/productCard.json"
import QuantityDiscountBadge from "./quantity-discount-badge"

const variant = {
  id: "v1",
  calculated_price: { calculated_amount: 10000, original_amount: 10000, currency_code: "krw" },
  metadata: {
    tieredPrices: [
      { minQuantity: 3, price: 9500 },
      { minQuantity: 5, price: 9000 },
    ],
  },
} as never

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderBadge(productMetadata: Record<string, unknown>, v = variant) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="ko" messages={{ productCard }}>
        <QuantityDiscountBadge
          product={{ metadata: productMetadata } as never}
          variant={v}
          isMembership={false}
        />
      </NextIntlClientProvider>
    )
  })
}

describe("QuantityDiscountBadge", () => {
  it("shows the first tier with its condition", () => {
    renderBadge({})
    expect(container.textContent).toBe("3개↑ 5%")
  })

  it("hides outside the discount period", () => {
    renderBadge({ quantityDiscount: { startsAt: "2999-01-01T00:00:00.000Z", endsAt: null } })
    expect(container.innerHTML).toBe("")
  })

  it("hides for a product without tiers", () => {
    renderBadge({}, { ...(variant as object), metadata: {} } as never)
    expect(container.innerHTML).toBe("")
  })
})
