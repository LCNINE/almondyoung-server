// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import productDetail from "@/i18n/messages/ko/productDetail.json"
import { listAddToDeliveryParents } from "@lib/api/medusa/add-to-delivery"
import AddToDeliveryButton from "./index"

vi.mock("@lib/api/medusa/add-to-delivery", () => ({
  listAddToDeliveryParents: vi.fn(),
}))
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
}))

const listMock = vi.mocked(listAddToDeliveryParents)

const parent = (orderId: string, displayId: number) => ({
  orderId,
  displayId,
  createdAt: "2026-11-26T00:00:00.000Z",
  address: {
    name: "홍길동",
    phone: "010",
    postalCode: "14500",
    address1: "부천로 1",
    address2: "101호",
  },
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  listMock.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(onPick = vi.fn()) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="ko" messages={{ productDetail }}>
        <AddToDeliveryButton
          productId="prod_1"
          enabled
          disabled={false}
          onPick={onPick}
        />
      </NextIntlClientProvider>
    )
  })

  return onPick
}

const button = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="add-to-delivery-button"]'
  )

describe("AddToDeliveryButton", () => {
  it("붙일 주문이 없으면 버튼을 그리지 않는다", async () => {
    listMock.mockResolvedValue([])
    await render()

    expect(button()).toBeNull()
  })

  it("주문이 하나면 누르는 즉시 그 주문으로 시작하고 안내를 보인다", async () => {
    listMock.mockResolvedValue([parent("order_p", 101)])
    const onPick = await render()

    expect(container.textContent).toContain(
      "주문번호 101와 함께 배송돼요 · 배송비 0원"
    )
    await act(async () => button()?.click())

    expect(onPick).toHaveBeenCalledWith("order_p")
  })

  it("주문이 여럿이면 배송지를 고르는 시트를 연다", async () => {
    listMock.mockResolvedValue([parent("order_a", 101), parent("order_b", 102)])
    const onPick = await render()

    await act(async () => button()?.click())
    expect(container.querySelector('[data-testid="sheet"]')).not.toBeNull()

    const rows = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="add-to-delivery-parent"]'
    )
    await act(async () => rows[1].click())

    expect(onPick).toHaveBeenCalledWith("order_b")
  })
})
