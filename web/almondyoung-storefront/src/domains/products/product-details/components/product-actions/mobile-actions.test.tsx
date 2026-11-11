// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import productDetail from "@/i18n/messages/ko/productDetail.json"
import MobileActions from "./mobile-actions"

vi.mock("next/navigation", () => ({ useParams: () => ({ countryCode: "kr" }) }))
vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DrawerTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))
vi.mock("./almond-design-notice", () => ({ AlmondDesignNotice: () => null }))
vi.mock("./selected-item-row", () => ({ default: () => null }))
vi.mock("./option-select", () => ({
  default: () => <div>옵션 선택 컨트롤</div>,
}))

const variant = {
  id: "v1",
  title: "빨강",
  calculated_price: {
    calculated_amount: 10000,
    original_amount: 10000,
    currency_code: "krw",
  },
  metadata: {
    membershipPrice: 8000,
    membershipTieredPrices: [{ minQuantity: 4, price: 7000 }],
  },
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

function renderActions(
  overrides: Partial<Parameters<typeof MobileActions>[0]> = {}
) {
  const props = {
    product: {
      id: "p1",
      metadata: {},
      variants: [variant],
      options: [{ id: "color", title: "색상" }],
    },
    options: {},
    setOptionValue: vi.fn(),
    selectedItems: [],
    updateQuantity: vi.fn(),
    removeItem: vi.fn(),
    selectedValuesMap: {},
    totalQuantity: 0,
    totalPrice: 0,
    pricingOf: vi.fn(),
    pricingContext: {
      isMember: false,
      hideMemberPrices: false,
      now: new Date("2026-11-11T00:00:00Z"),
    },
    isSimple: false,
    isWelcomeMembership: false,
    membersOnlyPurchase: false,
    inStock: true,
    handleAddToCart: vi.fn(),
    handleBuyNow: vi.fn(),
    isPending: false,
    show: true,
    ...overrides,
  } as Parameters<typeof MobileActions>[0]

  act(() =>
    root.render(
      <NextIntlClientProvider locale="ko" messages={{ productDetail }}>
        <MobileActions {...props} />
      </NextIntlClientProvider>
    )
  )
}

function openOffers() {
  const trigger = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("혜택 보기")
  )
  expect(trigger).toBeDefined()
  act(() => trigger!.click())
}

describe("mobile quantity discount entry", () => {
  it("opens the offer before option selection even when every option has identical tiers", () => {
    renderActions()
    expect(container.textContent).toContain("멤버십 수량 할인 · 4개부터")
    expect(container.querySelector('[data-testid="drawer"]')).toBeNull()
    openOffers()
    expect(container.querySelector('[data-testid="drawer"]')).not.toBeNull()
    expect(container.textContent).toContain("옵션을 먼저 골라 주세요")
    expect(
      container.querySelector('a[href="/kr/mypage/membership"]')
    ).not.toBeNull()
  })

  it("shows a guest the member-only cards in the purchase sheet", () => {
    renderActions({
      selectedItems: [
        { variantId: "v1", variant, quantity: 1, label: "빨강", price: {} },
      ] as never,
    })
    openOffers()
    expect(container.textContent).toContain("개당 7,000원")
    expect(container.textContent).toContain("4개 총 28,000원")
    expect(container.querySelector("button[data-bundle-quantity]")).toBeNull()
  })

  it("keeps member prices private in both the sticky entry and sheet", () => {
    renderActions({
      pricingContext: {
        isMember: false,
        hideMemberPrices: true,
        now: new Date("2026-11-11T00:00:00Z"),
      },
    })
    openOffers()
    expect(container.textContent).toContain(
      "4개부터 수량 할인 · 할인가 회원 공개"
    )
    expect(container.textContent).not.toContain("7,000")
    expect(container.textContent).not.toContain("0%")
  })
})
