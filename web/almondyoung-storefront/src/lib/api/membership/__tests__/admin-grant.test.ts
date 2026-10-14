import { beforeEach, describe, expect, it, vi } from "vitest"

const apiMock = vi.fn()
vi.mock("../../api", () => ({ api: (...args: unknown[]) => apiMock(...args) }))

import {
  getCurrentSubscription,
  getSubscriptionHistory,
  getSubscriptionHistoryPaged,
} from ".."

describe("수기 지급 응답", () => {
  beforeEach(() => apiMock.mockReset())

  it.each([true, false])(
    "현재 구독 평탄화 여부=%s 에서 지급 일수를 보존한다",
    async (flat) => {
      const contract = { id: "grant", status: "ACTIVE" }
      apiMock.mockResolvedValue({
        ...(flat
          ? contract
          : { contract, entitlement: { endsAt: "2026-10-01" } }),
        adminGrant: { days: 2 },
      })

      expect((await getCurrentSubscription())?.adminGrant).toEqual({ days: 2 })
    }
  )

  it("결제 가입을 임시 이용권으로 바꾸지 않는다", async () => {
    apiMock.mockResolvedValue({
      contract: { status: "ACTIVE" },
      adminGrant: null,
    })

    expect((await getCurrentSubscription())?.adminGrant).toBeNull()
  })

  it("일반·페이지네이션 이력 모두 지급 일수를 보존한다", async () => {
    const items = [
      { id: "grant", adminGrant: { days: 2 } },
      { id: "paid", adminGrant: null },
    ]
    apiMock
      .mockResolvedValueOnce(items)
      .mockResolvedValueOnce({ items, total: 2 })

    expect(await getSubscriptionHistory()).toEqual(items)
    expect(await getSubscriptionHistoryPaged(10, 0)).toEqual({
      items,
      total: 2,
    })
  })
})
