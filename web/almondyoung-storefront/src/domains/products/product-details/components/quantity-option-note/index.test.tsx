// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import productDetail from "@/i18n/messages/ko/productDetail.json"
import QuantityOptionNote from "./index"

vi.mock("next/navigation", () => ({ useParams: () => ({ countryCode: "kr" }) }))

const summary = { minQuantity: 3, percent: 10, varies: true, memberOnly: false }

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

function renderNote(props: Partial<Parameters<typeof QuantityOptionNote>[0]>) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="ko" messages={{ productDetail }}>
        <QuantityOptionNote kind="summary" summary={summary} {...props} />
      </NextIntlClientProvider>
    )
  })
}

describe("QuantityOptionNote", () => {
  it("sums up option-specific discounts with the condition", () => {
    renderNote({})
    expect(container.textContent).toContain("옵션별 수량 할인 · 3개↑ 최대 10%")
    expect(container.querySelector("section")).not.toBeNull()
  })

  it("says members-only when only member tiers exist", () => {
    renderNote({ summary: { ...summary, memberOnly: true } })
    expect(container.textContent).toContain("멤버십 회원 옵션별 수량 할인")
  })

  it("keeps hidden member benefits visible without publishing the discount", () => {
    renderNote({
      summary: { ...summary, memberOnly: true, pricesHidden: true },
    })
    expect(container.textContent).toContain("할인가 회원 공개")
    expect(container.textContent).not.toContain("10%")
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/kr/mypage/membership"
    )
  })

  it("names the chosen option that has no quantity discount", () => {
    renderNote({ kind: "notEligible", optionLabel: "파랑" })
    expect(container.textContent).toBe("파랑 옵션은 수량 할인 대상이 아닙니다")
  })

  it("falls back to a generic sentence without an option name", () => {
    renderNote({ kind: "notEligible" })
    expect(container.textContent).toBe("이 옵션은 수량 할인 대상이 아닙니다")
  })
})
