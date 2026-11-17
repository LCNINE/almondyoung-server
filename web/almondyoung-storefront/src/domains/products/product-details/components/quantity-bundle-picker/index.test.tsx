// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import productDetail from "@/i18n/messages/ko/productDetail.json"
import QuantityBundlePicker from "./index"

vi.mock("next/navigation", () => ({ useParams: () => ({ countryCode: "kr" }) }))

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

function renderPicker(
  props: Partial<Parameters<typeof QuantityBundlePicker>[0]> = {}
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="ko" messages={{ productDetail }}>
        <QuantityBundlePicker
          rows={rows}
          currentPrice={10000}
          quantity={1}
          {...props}
        />
      </NextIntlClientProvider>
    )
  })
}

const cards = () =>
  Array.from(container.querySelectorAll("[data-bundle-quantity]"))

describe("QuantityBundlePicker", () => {
  it("offers one item and each bundle with total, unit price and saving", () => {
    renderPicker()
    expect(cards().map((c) => c.getAttribute("data-bundle-quantity"))).toEqual([
      "1",
      "3",
      "5",
    ])
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

  it("shows member prices as a separate offer with membership navigation", () => {
    renderPicker({ memberHints })
    expect(container.textContent).toContain("멤버십 회원은 이렇게 할인받아요")
    expect(container.textContent).toContain("개당 7,200원")
    expect(container.textContent).toContain("3개 총 21,600원")
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/kr/mypage/membership"
    )
  })

  it("keeps a prominent offer for guests when only members get quantity discounts", () => {
    const onSelect = vi.fn()
    renderPicker({ rows: [], memberHints, onSelect })
    expect(cards()).toHaveLength(0)
    expect(container.querySelector("section")).not.toBeNull()
    expect(container.textContent).toContain(
      "같은 옵션을 묶음으로 구매하면 회원가에서 더 할인돼요"
    )
    expect(container.textContent).toContain("멤버십 가입 후 적용되는 묶음 가격")
    expect(container.querySelector("button")).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("shows the offer without leaking hidden member prices or percentages", () => {
    renderPicker({ rows: [], hiddenMemberQuantity: 3 })
    expect(container.textContent).toContain("3개부터 수량 할인")
    expect(container.textContent).toContain("할인가 회원 공개")
    expect(container.textContent).not.toContain("7,200")
    expect(container.textContent).not.toContain("%")
    expect(container.querySelector("a")).not.toBeNull()
  })

  it("explains how to unlock bundle selection before choosing an option", () => {
    renderPicker()
    expect(container.textContent).toContain(
      "미리보기는 구매 옵션을 바꾸지 않아요"
    )
  })

  it("does not mark a preset quantity when the customer selected a different quantity", () => {
    renderPicker({ quantity: 4, onSelect: vi.fn() })
    expect(cards()[1].getAttribute("aria-pressed")).toBe("false")
    expect(cards()[2].getAttribute("aria-pressed")).toBe("false")
  })

  it("renders nothing without bundles", () => {
    renderPicker({ rows: [] })
    expect(container.innerHTML).toBe("")
  })
})
