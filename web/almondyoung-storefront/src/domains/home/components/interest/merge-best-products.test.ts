import { describe, expect, it } from "vitest"
import { mergeBestProducts } from "./merge-best-products"

const items = (...ids: string[]) => ids.map((id) => ({ id }))

describe("mergeBestProducts", () => {
  it("분야별 같은 순위끼리 번갈아 놓고 겹치는 상품은 한 번만 넣는다", () => {
    const merged = mergeBestProducts(
      [items("a1", "a2", "a3"), items("b1", "a2"), items("c1")],
      15
    )

    expect(merged.map((p) => p.id)).toEqual(["a1", "b1", "c1", "a2", "a3"])
  })

  it("상한을 넘기지 않는다", () => {
    const merged = mergeBestProducts([items("a1", "a2"), items("b1", "b2")], 3)

    expect(merged.map((p) => p.id)).toEqual(["a1", "b1", "a2"])
  })

  it("고른 분야가 없으면 빈 목록이다", () => {
    expect(mergeBestProducts([], 15)).toEqual([])
  })
})
