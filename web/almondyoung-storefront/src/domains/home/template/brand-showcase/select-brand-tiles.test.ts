import { describe, expect, it } from "vitest"
import { selectBrandTiles } from "./select-brand-tiles"

const cat = (
  handle: string,
  children: ReturnType<typeof leaf>[] = []
) => ({
  id: `id-${handle}`,
  name: handle,
  handle,
  category_children: children,
})

const leaf = (handle: string) => ({
  id: `id-${handle}`,
  name: handle,
  handle,
})

describe("selectBrandTiles", () => {
  it("브랜드 루트의 자식을 순서 그대로 반환한다", () => {
    const roots = [
      cat("cafe24-cat-1"),
      cat("brand-root", [leaf("brand-a"), leaf("brand-b")]),
    ]
    const { brands, hasMore } = selectBrandTiles(roots, "brand-root", 10)
    expect(brands.map((b) => b.handle)).toEqual(["brand-a", "brand-b"])
    expect(hasMore).toBe(false)
  })

  it("최대 개수를 넘으면 자르고 hasMore 를 켠다", () => {
    const roots = [
      cat("brand-root", [leaf("a"), leaf("b"), leaf("c")]),
    ]
    const { brands, hasMore } = selectBrandTiles(roots, "brand-root", 2)
    expect(brands.map((b) => b.handle)).toEqual(["a", "b"])
    expect(hasMore).toBe(true)
  })

  it("브랜드 루트가 없으면 빈 목록", () => {
    const { brands, hasMore } = selectBrandTiles(
      [cat("other")],
      "brand-root",
      10
    )
    expect(brands).toEqual([])
    expect(hasMore).toBe(false)
  })

  it("자식이 null/없음이어도 빈 목록", () => {
    const root = { ...cat("brand-root"), category_children: null }
    const { brands } = selectBrandTiles([root], "brand-root", 10)
    expect(brands).toEqual([])
  })
})
