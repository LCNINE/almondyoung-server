import { describe, expect, it } from "vitest"
import { DEFAULT_CATEGORY_SORT, normalizeCategorySort } from "./sort-mapping"

describe("normalizeCategorySort", () => {
  it("신상품 카테고리는 최신순이 기본", () => {
    expect(normalizeCategorySort(undefined, "xfpg5f")).toBe("created_at")
  })

  it("다른 카테고리는 기존 기본값을 쓴다", () => {
    expect(normalizeCategorySort(undefined, "cafe24-cat-499")).toBe(
      DEFAULT_CATEGORY_SORT,
    )
    expect(normalizeCategorySort()).toBe(DEFAULT_CATEGORY_SORT)
  })

  it("사용자가 고른 정렬이 항상 이긴다", () => {
    expect(normalizeCategorySort("price_asc", "xfpg5f")).toBe("price_asc")
    expect(normalizeCategorySort("sales_desc", "cafe24-cat-499")).toBe(
      "sales_desc",
    )
  })

  it("알 수 없는 값은 무시한다", () => {
    expect(normalizeCategorySort("nonsense", "xfpg5f")).toBe("created_at")
  })
})
