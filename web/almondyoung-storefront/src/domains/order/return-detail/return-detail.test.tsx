// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createTranslator, NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { ComponentProps } from "react"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import mypage from "@/i18n/messages/ko/mypage.json"
import ReturnDetail from "./return-detail"

vi.mock("next-intl/server", () => ({
  getTranslations: async (
    namespace:
      | "mypage.order.returnDetail"
      | "mypage.order.list"
      | "mypage.order.returnRequest"
  ) => createTranslator({ locale: "ko", messages: { mypage }, namespace }),
  getFormatter: async () => ({
    number: (value: number) => value.toLocaleString("ko-KR"),
  }),
}))

vi.mock("@/components/shared/localized-client-link", () => ({
  default: (props: ComponentProps<"a">) => <a {...props} />,
}))

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }))

vi.mock("sonner", () => ({ toast: { info: toastInfo } }))

const order = {
  id: "order-1",
  display_id: 42,
  created_at: "2026-10-01T00:00:00Z",
  items: [
    {
      id: "item-1",
      title: "반품 상품",
      quantity: 3,
      unit_price: 10000,
      adjustments: [{ amount: 3000 }],
    },
  ],
  shipping_address: {
    first_name: "고객",
    phone: "010-1234-5678",
    address_1: "서울시 테스트로",
    postal_code: "12345",
  },
} as unknown as HttpTypes.StoreOrder

const ret: CustomerReturn = {
  returnId: "return-1",
  kind: "return",
  stage: "refunded",
  requestedAt: "2026-10-02T00:00:00Z",
  reason: "change_of_mind",
  feeBearer: "customer",
  items: [{ itemId: "item-1", quantity: 1 }],
  canCancel: false,
  refund: {
    kind: "settled",
    itemTotal: 9000,
    shippingRefund: 2500,
    fees: 3000,
    total: 8500,
    receivedAt: "2026-10-03T00:00:00Z",
    refundedAt: "2026-10-04T00:00:00Z",
  },
}

let root: Root
let container: HTMLDivElement

async function renderDetail(
  value = ret,
  paymentMethodLabel: string | null = "테스트카드"
) {
  const detail = await ReturnDetail({
    order,
    ret: value,
    progress: null,
    paymentMethodLabel,
  })

  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale="ko"
        messages={{ mypage }}
        timeZone="Asia/Seoul"
      >
        {detail}
      </NextIntlClientProvider>
    )
  })
}

async function clickButton(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label
  )

  expect(button).toBeDefined()

  await act(async () => {
    button!.click()
  })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  toastInfo.mockClear()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe("ReturnDetail", () => {
  it("상품 뒤에 상세정보, 회수정보, 사유, 환불안내를 배치한다", async () => {
    await renderDetail()

    expect(
      Array.from(container.querySelectorAll("h2")).map(
        (title) => title.textContent
      )
    ).toEqual(["상세정보", "상품 회수정보", "반품 사유", "환불안내"])
    expect(
      container
        .querySelector("table")
        ?.compareDocumentPosition(container.querySelector("h2")!)
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(container.querySelector("table")?.className).not.toContain("min-w-")
    expect(
      container.querySelector("ul.md\\:hidden > li")?.textContent
    ).toContain("반품 상품")
    expect(container.textContent).toContain("테스트카드")
    expect(container.textContent).toContain("8,500원")
    expect(container.textContent).toContain("회수 정보를 확인하고 있어요")
  })

  it("취소영수증을 열고 할인과 반품비를 구분한 금액을 보여준다", async () => {
    await renderDetail()
    await clickButton("취소영수증 확인")

    const dialog = document.querySelector('[role="dialog"]')

    expect(dialog?.textContent).toContain("상품 취소 금액10,000원")
    expect(dialog?.textContent).toContain("할인금액 차감-1,000원")
    expect(dialog?.textContent).toContain("배송비2,500원")
    expect(dialog?.textContent).toContain("반품비-3,000원")
    expect(dialog?.textContent).toContain("총 환불 금액8,500원")
    expect(dialog?.textContent).toContain("환불 수단테스트카드8,500원")

    await clickButton("닫기")

    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("회수조회는 준비 중 토스트를 보여준다", async () => {
    await renderDetail()
    await clickButton("회수조회")

    expect(toastInfo).toHaveBeenCalledWith("준비 중이에요")
  })

  it.each(["exchange", "canceled"] as const)(
    "%s 분기의 환불 안내와 영수증을 숨긴다",
    async (branch) => {
      await renderDetail({
        ...ret,
        kind: branch === "exchange" ? "exchange" : "return",
        stage: branch === "canceled" ? "canceled" : "exchanged",
        refund: null,
      })

      expect(container.textContent).not.toContain("환불안내")
      expect(container.textContent).not.toContain("취소영수증 확인")
      expect(container.textContent).toContain(
        branch === "exchange" ? "교환 사유" : "취소했어요"
      )
    }
  )

  it("선환불은 완료일이나 최종 환불액으로 표시하지 않는다", async () => {
    await renderDetail(
      {
        ...ret,
        refund: {
          ...ret.refund!,
          kind: "prepaid",
          total: 1000,
          receivedAt: null,
        },
      },
      null
    )
    await clickButton("취소영수증 확인")

    const dialog = document.querySelector('[role="dialog"]')

    expect(container.textContent).not.toContain("완료일")
    expect(container.textContent).toContain("선환불 처리일")
    expect(dialog?.textContent).toContain("먼저 환불한 금액1,000원")
    expect(dialog?.textContent).toContain("배송비검수 후 정해져요")
    expect(dialog?.textContent).not.toContain("총 환불 금액")
    expect(dialog?.textContent).toMatch(/환불 수단.*1,000원/)
  })

  it("환불액이 없으면 임의의 영수증 금액을 만들지 않는다", async () => {
    await renderDetail({ ...ret, stage: "requested", refund: null }, null)
    await clickButton("취소영수증 확인")

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "상품이 창고에 도착해 검수를 마치면 환불 금액이 정해져요."
    )
  })
})
