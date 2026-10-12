import { describe, expect, it, vi } from "vitest"

const { listProducts } = vi.hoisted(() => ({
  listProducts: vi.fn(),
}))

vi.mock("@/lib/api/medusa/products", () => ({ listProducts }))

import { fetchProductsByIds } from "./fetch-products"

describe("time-sale product freshness", () => {
  it("공개 제한 변경 후에는 이전 가격 대신 새 상품 응답을 사용한다", async () => {
    listProducts
      .mockResolvedValueOnce({
        response: {
          products: [
            { id: "p1", variants: [{ metadata: { membershipPrice: 870 } }] },
          ],
        },
      })
      .mockResolvedValueOnce({
        response: { products: [{ id: "p1", variants: [{ metadata: {} }] }] },
      })

    const before = await fetchProductsByIds(["p1"], "kr-region")
    const after = await fetchProductsByIds(["p1"], "kr-region")

    expect(before[0].variants?.[0].metadata?.membershipPrice).toBe(870)
    expect(after[0].variants?.[0].metadata?.membershipPrice).toBeUndefined()
    expect(listProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ fresh: true })
    )
  })
})
