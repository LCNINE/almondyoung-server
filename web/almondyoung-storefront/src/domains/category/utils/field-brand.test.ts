import { describe, expect, it } from "vitest"
import { groupFieldProductsByBrand } from "./field-brand"

describe("groupFieldProductsByBrand", () => {
  it("브랜드별로 묶고 상품 없는 브랜드는 빼며 많은 순으로 정렬한다", () => {
    const result = groupFieldProductsByBrand(
      [
        { id: "p1", categoryIds: ["perm", "lamon"] },
        { id: "p2", categoryIds: ["rod", "banhada"] },
        { id: "p3", categoryIds: ["perm", "banhada"] },
        { id: "p4", categoryIds: ["perm"] },
      ],
      [{ id: "lamon" }, { id: "empty" }, { id: "banhada" }]
    )

    expect(result).toEqual([
      { category: { id: "banhada" }, productIds: ["p2", "p3"] },
      { category: { id: "lamon" }, productIds: ["p1"] },
    ])
  })
})
