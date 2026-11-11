// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import productDetail from "@/i18n/messages/ko/productDetail.json"
import QuantityDiscountOffer from "./index"

vi.mock("next/navigation", () => ({ useParams: () => ({ countryCode: "kr" }) }))

const variant = (
  id: string,
  title: string,
  minQuantity: number,
  price: number
) => ({
  id,
  title,
  calculated_price: {
    calculated_amount: 10000,
    original_amount: 10000,
    currency_code: "krw",
  },
  metadata: {
    membershipPrice: 8000,
    membershipTieredPrices: [{ minQuantity, price }],
  },
})
const blue = variant("blue", "파랑", 3, 7000)
const green = variant("green", "초록", 6, 6000)
const plain = { ...variant("plain", "할인 없음", 1, 0), metadata: {} }
const product = { metadata: {}, variants: [plain, blue, green] } as never
const context = {
  isMember: false,
  hideMemberPrices: false,
  now: new Date("2026-11-11T00:00:00Z"),
}

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

function renderOffer(
  props: Partial<Parameters<typeof QuantityDiscountOffer>[0]> = {}
) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="ko" messages={{ productDetail }}>
        <QuantityDiscountOffer product={product} context={context} {...props} />
      </NextIntlClientProvider>
    )
  )
}

const memberCards = () =>
  Array.from(container.querySelectorAll("[data-member-bundle-quantity]"))

describe("option-specific bundle preview", () => {
  it("shows member bundle cards before choosing a purchase option, skipping ineligible defaults", () => {
    renderOffer()
    expect(container.textContent).toContain("옵션별 할인 미리보기")
    expect(container.textContent).toContain("멤버십 회원은 이렇게 할인받아요")
    expect(
      memberCards().map((card) =>
        card.getAttribute("data-member-bundle-quantity")
      )
    ).toEqual(["1", "3"])
    expect(container.textContent).toContain("개당 7,000원")
    expect(container.textContent).toContain("3개 총 21,000원")
    expect(container.textContent).toContain("3,000원 절약")
    expect(container.textContent).toContain("가입 후 적용")
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe(
      "파랑"
    )
  })

  it("switches exact option prices without changing the purchase selection", () => {
    const onSelect = vi.fn()
    renderOffer({ onSelect })
    const greenButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "초록"
    )!
    act(() => greenButton.click())
    expect(
      memberCards().map((card) =>
        card.getAttribute("data-member-bundle-quantity")
      )
    ).toEqual(["1", "6"])
    expect(container.textContent).toContain("개당 6,000원")
    expect(container.textContent).toContain("6개 총 36,000원")
    expect(container.textContent).not.toContain("개당 7,000원")
    expect(onSelect).not.toHaveBeenCalled()
    expect(container.querySelector("button[data-bundle-quantity]")).toBeNull()
  })

  it("keeps the preview separate from quantity selection for a member too", () => {
    const onSelect = vi.fn()
    renderOffer({ context: { ...context, isMember: true }, onSelect })
    expect(
      container.querySelectorAll("[data-bundle-quantity]").length
    ).toBeGreaterThan(0)
    expect(container.querySelector("button[data-bundle-quantity]")).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("enables the actual bundle choice once a purchase option is selected", () => {
    const onSelect = vi.fn()
    renderOffer({
      context: { ...context, isMember: true },
      focusVariant: green as never,
      quantity: 1,
      onSelect,
    })
    expect(container.textContent).not.toContain("옵션별 할인 미리보기")
    act(() =>
      (
        container.querySelector(
          'button[data-bundle-quantity="6"]'
        ) as HTMLButtonElement
      ).click()
    )
    expect(onSelect).toHaveBeenCalledWith(6)
  })

  it("explains when the actual chosen option is not eligible", () => {
    renderOffer({ focusVariant: plain as never })
    expect(container.textContent).toContain(
      "할인 없음 옵션은 수량 할인 대상이 아닙니다"
    )
    expect(memberCards()).toHaveLength(0)
  })

  it("keeps hidden member prices private before option selection", () => {
    renderOffer({ context: { ...context, hideMemberPrices: true } })
    expect(container.textContent).toContain(
      "3개부터 수량 할인 · 할인가 회원 공개"
    )
    expect(container.textContent).not.toContain("7,000")
    expect(container.textContent).not.toContain("8,000")
    expect(container.textContent).not.toContain("0%")
    expect(memberCards()).toHaveLength(0)
  })

  it("uses a labeled selector for many discount options", () => {
    const variants = Array.from({ length: 6 }, (_, i) =>
      variant(`v${i}`, `옵션 ${i}`, i + 2, 7000 - i * 100)
    )
    renderOffer({ product: { metadata: {}, variants } as never })
    const select = container.querySelector("select")!
    expect(select.options).toHaveLength(6)
    expect(
      document.getElementById(select.getAttribute("aria-labelledby")!)
        ?.textContent
    ).toBe("옵션별 할인 미리보기")
    act(() => {
      select.value = "v5"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.textContent).toContain("7개 묶음")
    expect(container.textContent).toContain("개당 6,500원")
  })

  it("removes the preview outside the discount period", () => {
    renderOffer({
      product: {
        metadata: { quantityDiscount: { endsAt: "2026-11-10T00:00:00Z" } },
        variants: [blue, green],
      } as never,
    })
    expect(container.innerHTML).toBe("")
  })
})
