// @vitest-environment jsdom

import { act, type ComponentProps, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import mypage from "@/i18n/messages/ko/mypage.json"
import OrderActions from "./order-actions"
import OrderSummaryCard from "./order-summary-card"
import OrderDetailsStatusCards from "@/domains/order/details/components/order-details-status-cards"
import { OrderDetailsDesktop } from "@/domains/order/details/components/order-details-desktop"
import { OrderDetailsMobile } from "@/domains/order/details/components/order-details-mobile"

const { cancelOrder, capture, requestRefund, refresh, media } = vi.hoisted(
  () => ({
    cancelOrder: vi.fn(),
    capture: vi.fn(),
    requestRefund: vi.fn(),
    refresh: vi.fn(),
    media: {
      matches: true,
      listener: undefined as
        | undefined
        | ((event: { matches: boolean }) => void),
    },
  })
)

vi.mock("@/lib/api/orders/store-orders", () => ({
  cancelOrderByMedusaId: cancelOrder,
}))
vi.mock("@/lib/api/medusa/orders", () => ({ captureOrderPayment: capture }))
vi.mock("@/domains/order/details/refund-request-action", () => ({
  requestRefundAction: requestRefund,
}))
vi.mock("@/hooks/api/use-add-to-cart", () => ({
  useAddToCart: () => ({ addToCart: vi.fn(), isLoading: false }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/components/shared/localized-client-link", () => ({
  default: (props: ComponentProps<"a">) => <a {...props} />,
}))
vi.mock("@lib/api/library/library-api", () => ({
  downloadOwnership: vi.fn(),
  exerciseOwnership: vi.fn(),
}))
vi.mock("@/lib/api/medusa/returns", () => ({ cancelReturn: vi.fn() }))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const order = {
  id: "order-3065",
  created_at: "2026-10-20T00:00:00Z",
  payment_status: "captured",
  fulfillment_status: "not_fulfilled",
  metadata: { bank_transfer_status: "confirmed" },
  items: [
    { id: "a", title: "반품 상품", quantity: 1, unit_price: 1000, total: 1000 },
    { id: "b", title: "준비 상품", quantity: 1, unit_price: 2000, total: 2000 },
    {
      id: "c",
      title: "두 번째 준비 상품",
      quantity: 1,
      unit_price: 3000,
      total: 3000,
    },
  ],
} as unknown as HttpTypes.StoreOrder
const ret: CustomerReturn = {
  returnId: "r1",
  kind: "return",
  stage: "requested",
  requestedAt: "2026-10-20T00:00:00Z",
  reason: "CHANGE_OF_MIND",
  feeBearer: "customer",
  items: [{ itemId: "a", quantity: 1 }],
  canCancel: true,
  refund: null,
}
const coreActions: StoreOrderActionsResponse = {
  orderId: "core-3065",
  channelOrderId: "order-3065",
  availableActions: ["cancel"],
  orderStatus: "confirmed",
  fulfillmentStatus: "not_created",
  paymentStatus: "paid",
  refundStatus: "none",
  claimStatus: "none",
}
let container: HTMLDivElement
let root: Root

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale="ko"
        messages={{ mypage }}
        timeZone="Asia/Seoul"
      >
        {node}
      </NextIntlClientProvider>
    )
  })
}

async function click(label: string, parent: ParentNode = document) {
  const button = Array.from(parent.querySelectorAll("button")).find(
    (button) => button.textContent === label
  )

  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}

function details(
  props: Partial<ComponentProps<typeof OrderDetailsStatusCards>> = {}
) {
  return (
    <OrderDetailsStatusCards
      order={order}
      status="결제 완료"
      coreActions={coreActions}
      returns={[]}
      intentId="intent-3065"
      digitalOwnerships={[]}
      {...props}
    />
  )
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  cancelOrder.mockResolvedValue({ success: true })
  capture.mockResolvedValue({ success: true })
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: media.matches,
    addEventListener: (_: string, listener: typeof media.listener) => {
      media.listener = listener
    },
    removeEventListener: () => {},
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe("status cards and order actions", () => {
  it("목록에서도 인쇄 제작 중 취소 불가 사유를 보여 준다", async () => {
    await render(
      <OrderActions
        orderId="order-3065"
        paymentStatus="captured"
        productName="인쇄물"
        coreActions={{
          ...coreActions,
          availableActions: ["receipt"],
          cancelUnavailableReason: "print_in_production",
        }}
      />
    )

    expect(container.textContent).toContain(
      mypage.order.actions.cancelUnavailable.print_in_production
    )
  })

  it.each([OrderDetailsDesktop, OrderDetailsMobile])(
    "제작 중 주문은 %s 상세에서 제작 표시와 취소 불가 사유를 보여 준다",
    async (Details) => {
      await render(
        <Details
          order={order}
          countryCode="kr"
          coreActions={{
            ...coreActions,
            fulfillmentStatus: "preparing",
            printInProduction: true,
            availableActions: ["receipt"],
            cancelUnavailableReason: "print_in_production",
          }}
          returns={[]}
          intentId="intent-3065"
        />
      )

      expect(container.textContent).toContain(mypage.order.status.inProduction)
      expect(container.textContent).toContain(
        mypage.order.actions.cancelUnavailable.print_in_production
      )
      expect(
        Array.from(container.querySelectorAll("button")).some(
          (button) => button.textContent === "주문 취소" && !button.disabled
        )
      ).toBe(false)
    }
  )

  it.each([OrderDetailsDesktop, OrderDetailsMobile])(
    "renders status cards before other details in %s",
    async (Details) => {
      await render(
        <Details
          order={order}
          countryCode="kr"
          coreActions={coreActions}
          returns={[]}
          intentId="intent-3065"
        />
      )
      const cards = container.querySelector("ul")!
      const heading = Array.from(container.querySelectorAll("h2, h3")).find(
        (node) => node.textContent === mypage.order.labels.paymentInfo
      )!

      expect(cards.querySelectorAll(":scope > li")).toHaveLength(1)
      expect(heading).toBeDefined()
      expect(
        cards.compareDocumentPosition(heading) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      await click("주문 취소", cards)
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    }
  )

  it("groups returned items apart and never offers cancel on an order with returns", async () => {
    await render(details({ returns: [ret] }))
    const cards = container.querySelectorAll("ul > li")

    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain("반품 상세 보기")
    expect(cards[1].textContent).toContain("두 번째 준비 상품")
    expect(cards[1].querySelector("h3")?.textContent).toBe("결제 완료")
    expect(container.textContent).not.toContain("주문 취소")
  })

  it("opens one refund dialog from the order group", async () => {
    await render(details())
    const cards = container.querySelectorAll("ul > li")

    expect(cards).toHaveLength(1)
    await click("주문 취소", cards[0])

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      mypage.order.refundRequest.title
    )
    expect(cancelOrder).not.toHaveBeenCalled()
  })

  it("list cancellation links directly to the refund dialog and stays inside its card", async () => {
    await render(
      <OrderActions
        orderId="order-3065"
        paymentStatus="captured"
        productName="준비 상품"
        availableActions={["cancel"]}
        bankTransferStatus="confirmed"
      >
        {(actions) => (
          <OrderSummaryCard
            orderId="order-3065"
            orderDate="10/20"
            status="결제 완료"
            items={[
              { id: "b", title: "준비 상품", price: "2,000원", thumbnail: "" },
            ]}
          >
            {actions}
          </OrderSummaryCard>
        )}
      </OrderActions>
    )
    const links = container.querySelectorAll(
      'a[href="/mypage/order/details?orderId=order-3065&refund=1"]'
    )

    expect(links).toHaveLength(2)
    expect(Array.from(links).every((link) => link.closest("li"))).toBe(true)
    expect(links[0].textContent).toBe("주문 취소")
  })

  it("auto-opens only the active responsive layout's dialog", async () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 1024px)",
    })) as unknown as typeof window.matchMedia

    await render(
      <>
        {details({
          autoOpenRefund: true,
          autoOpenRefundMedia: "(min-width: 1024px)",
        })}
        {details({
          autoOpenRefund: true,
          autoOpenRefundMedia: "(max-width: 1023px)",
        })}
      </>
    )

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    await click(
      mypage.order.refundRequest.cancel,
      document.querySelector('[role="dialog"]')!
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each([
    { refundRequestStatus: "REQUESTED" },
    { refundRequestStatus: "APPROVED" },
    { intentId: undefined },
    { coreActions: { ...coreActions, availableActions: [] } },
    {
      digitalOwnerships: [{ exercisedAt: "2026-10-20" }] as ComponentProps<
        typeof OrderDetailsStatusCards
      >["digitalOwnerships"],
    },
  ])("does not auto-open an unavailable refund: %j", async (props) => {
    await render(details({ ...props, autoOpenRefund: true }))

    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("fully returned orders show one return link and no empty order card or cancel action", async () => {
    await render(
      details({
        returns: [
          {
            ...ret,
            stage: "refunded",
            items: order.items!.map((item) => ({
              itemId: item.id,
              quantity: 1,
            })),
          },
        ],
        autoOpenRefund: true,
      })
    )

    expect(container.querySelectorAll("ul > li")).toHaveLength(1)
    expect(
      container.querySelectorAll(
        'a[href="/mypage/order/returns/r1?orderId=order-3065"]'
      )
    ).toHaveLength(1)
    expect(container.textContent).not.toContain("주문 취소")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("card cancellation retains the print partial-cancel retry", async () => {
    cancelOrder.mockResolvedValueOnce({
      success: false,
      code: "PRINT_PARTIAL_CANCEL_AVAILABLE",
    })
    await render(details({ order: { ...order, metadata: {} } }))
    await click("주문 취소")
    await click("취소 확인", document.querySelector('[role="dialog"]')!)
    await click(mypage.order.actions.printPartialCancel.confirm)

    expect(cancelOrder).toHaveBeenNthCalledWith(1, "order-3065", {
      reasonCode: "CHANGE_OF_MIND",
      reasonDetail: undefined,
    })
    expect(cancelOrder).toHaveBeenNthCalledWith(2, "order-3065", {
      reasonCode: "CHANGE_OF_MIND",
      reasonDetail: undefined,
      excludePrint: true,
    })
  })

  it("purchase confirmation still submits after confirmation", async () => {
    await render(
      details({
        order: { ...order, metadata: {}, payment_status: "authorized" },
      })
    )
    await click("구매확정")
    await click("구매확정", document.querySelector('[role="dialog"]')!)

    expect(capture).toHaveBeenCalledWith("order-3065")
  })
})
