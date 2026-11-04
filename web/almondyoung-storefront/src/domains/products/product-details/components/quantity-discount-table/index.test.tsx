// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import productDetail from "@/i18n/messages/ko/productDetail.json"
import QuantityDiscountTable from "./index"

const rows = [
  { minQuantity: 3, unitPrice: 9500, percent: 5, memberUnitPrice: 7200 },
  { minQuantity: 5, unitPrice: 9000, percent: 10, memberUnitPrice: 6800 },
  { minQuantity: 10, unitPrice: 8500, percent: 15 },
  { minQuantity: 20, unitPrice: 8000, percent: 20 },
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

function renderTable(props: Partial<Parameters<typeof QuantityDiscountTable>[0]> = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="ko" messages={{ productDetail }}>
        <QuantityDiscountTable rows={rows} quantity={1} {...props} />
      </NextIntlClientProvider>
    )
  })
}

describe("QuantityDiscountTable", () => {
  it("states the same-option condition with unit price and saving", () => {
    renderTable()
    const text = container.textContent ?? ""
    expect(text).toContain("같은 옵션")
    expect(text).toContain("3개 이상")
    expect(text).toContain("개당 9,500원")
    expect(text).toContain("5% 할인")
  })

  it("shows the member-only price on the same row", () => {
    renderTable()
    expect(container.textContent).toContain("멤버십 회원 전용 개당 7,200원")
  })

  it("highlights the tier the chosen quantity reaches", () => {
    renderTable({ quantity: 6 })
    const current = container.querySelector("[data-current='true']")
    expect(current?.textContent).toContain("5개 이상")
  })

  it("folds rows past the third behind a more button", () => {
    renderTable()
    expect(container.textContent).not.toContain("20개 이상")
    const more = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("더보기"))
    act(() => more?.click())
    expect(container.textContent).toContain("20개 이상")
  })

  it("renders nothing without tiers", () => {
    renderTable({ rows: [] })
    expect(container.innerHTML).toBe("")
  })
})
