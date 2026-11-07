// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import productDetail from "@/i18n/messages/ko/productDetail.json"
import QuantityBundlePicker from "./index"

const rows = [
  { minQuantity: 3, unitPrice: 9500, percent: 5 },
  { minQuantity: 5, unitPrice: 9000, percent: 10 },
]
const memberHints = [
  { minQuantity: 3, unitPrice: 7200, percent: 10 },
  { minQuantity: 5, unitPrice: 6800, percent: 15 },
]

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

function renderPicker(props: Partial<Parameters<typeof QuantityBundlePicker>[0]> = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="ko" messages={{ productDetail }}>
        <QuantityBundlePicker rows={rows} currentPrice={10000} quantity={1} {...props} />
      </NextIntlClientProvider>
    )
  })
}

const cards = () => Array.from(container.querySelectorAll("[data-bundle-quantity]"))

describe("QuantityBundlePicker", () => {
  it("offers one item and each bundle with total, unit price and saving", () => {
    renderPicker()
    expect(cards().map((c) => c.getAttribute("data-bundle-quantity"))).toEqual(["1", "3", "5"])
    const three = cards()[1].textContent ?? ""
    expect(three).toContain("3개 묶음")
    expect(three).toContain("28,500원")
    expect(three).toContain("개당 9,500원")
    expect(three).toContain("1,500원 절약")
    expect(cards()[2].textContent).toContain("최대 할인")
  })

  it("marks the card matching the chosen quantity and starts on one item", () => {
    renderPicker({ onSelect: vi.fn() })
    expect(cards()[0].getAttribute("aria-pressed")).toBe("true")
    renderPicker({ quantity: 5, onSelect: vi.fn() })
    expect(cards()[2].getAttribute("aria-pressed")).toBe("true")
    expect(cards()[0].getAttribute("aria-pressed")).toBe("false")
  })

  it("sets the quantity of the bundle that is tapped", () => {
    const onSelect = vi.fn()
    renderPicker({ onSelect })
    act(() => (cards()[1] as HTMLButtonElement).click())
    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it("is a display only list without a handler", () => {
    renderPicker({ onSelect: undefined })
    expect(container.querySelector("button[data-bundle-quantity]")).toBeNull()
    expect(container.querySelector("[aria-pressed]")).toBeNull()
  })

  it("shows member bundle prices to a non-member on one line", () => {
    renderPicker({ memberHints })
    expect(container.textContent).toContain("멤버십 회원은 3개 개당 7,200원 · 5개 개당 6,800원")
  })

  it("shows only the member line when the bundle discount is for members only", () => {
    renderPicker({ rows: [], memberHints })
    expect(cards()).toHaveLength(0)
    expect(container.textContent).toContain("멤버십 회원은 3개 개당 7,200원 · 5개 개당 6,800원")
  })

  it("renders nothing without bundles", () => {
    renderPicker({ rows: [] })
    expect(container.innerHTML).toBe("")
  })
})
