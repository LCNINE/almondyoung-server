import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useParams: () => ({ countryCode: "kr" }),
}))
vi.mock("@lib/utils", async () => import("../../lib/utils"))

import {
  PendingDownloadNotice,
  PendingDownloadOrders,
} from "./components/pending-downloads"

const orders = [
  {
    id: "order_1",
    display_id: 5452,
    items: [{ id: "item_1", title: "캔바 템플릿", requires_shipping: false }],
  },
]

describe("결제 반영 안내 화면", () => {
  it("미반영 주문이 없으면 안내와 재조회 버튼을 표시하지 않는다", () => {
    expect(
      renderToStaticMarkup(
        createElement(PendingDownloadNotice, {
          hasPendingOrders: false,
          unavailable: false,
        })
      )
    ).toBe("")
    expect(
      renderToStaticMarkup(
        createElement(PendingDownloadOrders, {
          orders: [],
          unavailable: false,
        })
      )
    ).toBe("")
  })

  it("미반영 상품은 다운로드를 막고 수동 확인과 주문상세 링크를 제공한다", () => {
    const html = renderToStaticMarkup(
      createElement(PendingDownloadOrders, { orders, unavailable: false })
    )

    expect(html).toContain("캔바 템플릿")
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>다운로드 준비 중<\/button>/
    )
    expect(html).toContain("다시 확인하기")
    expect(html).toContain("/kr/mypage/order/details?orderId=order_1")
  })

  it("조회 실패를 결제 완료로 안내하지 않고 재조회 방법을 제공한다", () => {
    const notice = renderToStaticMarkup(
      createElement(PendingDownloadNotice, {
        hasPendingOrders: false,
        unavailable: true,
      })
    )
    const controls = renderToStaticMarkup(
      createElement(PendingDownloadOrders, {
        orders: [],
        unavailable: true,
      })
    )

    expect(notice).toContain("반영 상태를 확인하지 못했어요")
    expect(notice).not.toContain("결제가 완료되었어요")
    expect(controls).toContain("다시 확인하기")
    expect(controls).not.toContain("다운로드 준비 중")
  })
})
