import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api/medusa/orders", () => ({ getOrders: vi.fn() }))
vi.mock("@/lib/api/library/library-api", () => ({
  getGrantedLibraryOrderIds: vi.fn(),
  getOwnerships: vi.fn(),
}))

import { getOrders } from "@/lib/api/medusa/orders"
import {
  getGrantedLibraryOrderIds,
  getOwnerships,
} from "@/lib/api/library/library-api"
import { loadPendingOrders, loadDownloadData } from "./load-pending-orders"

const paid = {
  id: "order_1",
  payment_status: "captured",
  items: [{ id: "item_1", title: "전자책", requires_shipping: false }],
}

beforeEach(() => vi.resetAllMocks())

describe("반영 대기 조회", () => {
  it("권한이 생긴 주문은 목록 페이지나 필터와 관계없이 안내에서 빠진다", async () => {
    vi.mocked(getOrders).mockResolvedValue({ orders: [paid] } as any)
    vi.mocked(getGrantedLibraryOrderIds).mockResolvedValue(["order_1"])

    expect(await loadPendingOrders()).toEqual({
      orders: [],
      unavailable: false,
    })
  })

  it("아직 권한이 없는 주문은 결제 반영 대기로 반환한다", async () => {
    vi.mocked(getOrders).mockResolvedValue({ orders: [paid] } as any)
    vi.mocked(getGrantedLibraryOrderIds).mockResolvedValue([])

    expect((await loadPendingOrders()).orders.map((order) => order.id)).toEqual(
      ["order_1"]
    )
  })

  it("주문별 HTTP 호출 대신 ID 를 묶어 조회한다", async () => {
    vi.mocked(getOrders).mockResolvedValue({
      orders: [paid, { ...paid, id: "order_2" }],
    } as any)
    vi.mocked(getGrantedLibraryOrderIds).mockResolvedValue([])

    await loadPendingOrders()

    expect(getGrantedLibraryOrderIds).toHaveBeenCalledExactlyOnceWith([
      "order_1",
      "order_2",
    ])
  })

  it("디지털 결제 주문이 없으면 권한 확인을 요청하지 않는다", async () => {
    vi.mocked(getOrders).mockResolvedValue({ orders: [] } as any)

    expect(await loadPendingOrders()).toEqual({
      orders: [],
      unavailable: false,
    })
    expect(getGrantedLibraryOrderIds).not.toHaveBeenCalled()
  })

  it("주문 조회 실패를 빈 구매 내역으로 단정하지 않는다", async () => {
    vi.mocked(getOrders).mockResolvedValue(null)

    expect(await loadPendingOrders()).toEqual({ orders: [], unavailable: true })
  })

  it("권한 조회 실패를 미반영 확정으로 안내하지 않는다", async () => {
    vi.mocked(getOrders).mockResolvedValue({ orders: [paid] } as any)
    vi.mocked(getGrantedLibraryOrderIds).mockRejectedValue(
      new Error("unavailable")
    )

    expect(await loadPendingOrders()).toEqual({ orders: [], unavailable: true })
  })
})

// grant 가 상태 조회 도중 커밋되는 상황: 오래된 목록과 최신 상태를 섞으면 상품이 사라진다.
it("반영 완료를 확인한 뒤 권한 목록을 읽어 빈 화면 레이스를 막는다", async () => {
  let granted = false
  const ownership = { id: "ownership_1" }

  vi.mocked(getOrders).mockResolvedValue({ orders: [paid] } as any)
  vi.mocked(getGrantedLibraryOrderIds).mockImplementation(async () => {
    granted = true
    return ["order_1"]
  })
  vi.mocked(getOwnerships).mockImplementation(
    async () =>
      ({
        data: granted ? [ownership] : [],
        total: granted ? 1 : 0,
        skip: 0,
        take: 12,
      }) as any
  )

  const result = await loadDownloadData({ skip: 0, take: 12, filter: "all" })

  expect(result.pendingOrders.orders).toEqual([])
  expect(result.ownerships.data).toEqual([ownership])
})
