import { describe, expect, it } from "vitest"
import { selectBrandTiles } from "./select-brand-tiles"

type Node = {
  id: string
  name: string
  handle: string
  category_children?: Node[] | null
}

const cat = (handle: string, children: Node[] = []): Node => ({
  id: `id-${handle}`,
  name: handle,
  handle,
  category_children: children,
})

describe("selectBrandTiles", () => {
  it("flat 구조: 직계 브랜드를 무명 그룹 하나로 반환한다", () => {
    const roots = [
      cat("cafe24-cat-1"),
      cat("brand-root", [cat("brand-a"), cat("brand-b")]),
    ]
    const { groups, hasGroups } = selectBrandTiles(roots, "brand-root", 10)
    expect(hasGroups).toBe(false)
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBeNull()
    expect(groups[0].brands.map((b) => b.category.handle)).toEqual([
      "brand-a",
      "brand-b",
    ])
    expect(groups[0].brands[0].handlePath).toEqual(["brand-root", "brand-a"])
  })

  it("grouped 구조: 중간 그룹별로 손자 브랜드를 묶는다", () => {
    const roots = [
      cat("brand-root", [
        cat("lash-group", [cat("brand-a"), cat("brand-b")]),
        cat("pmu-group", [cat("brand-c")]),
      ]),
    ]
    const { groups, hasGroups } = selectBrandTiles(roots, "brand-root", 10)
    expect(hasGroups).toBe(true)
    expect(groups.map((g) => g.category?.handle)).toEqual([
      "lash-group",
      "pmu-group",
    ])
    expect(groups[0].brands[0].handlePath).toEqual([
      "brand-root",
      "lash-group",
      "brand-a",
    ])
  })

  it("혼합 구조: 직계 브랜드는 무명 그룹으로 맨 앞에 온다", () => {
    const roots = [
      cat("brand-root", [
        cat("brand-a"),
        cat("lash-group", [cat("brand-b")]),
      ]),
    ]
    const { groups, hasGroups } = selectBrandTiles(roots, "brand-root", 10)
    expect(hasGroups).toBe(true)
    expect(groups[0].category).toBeNull()
    expect(groups[0].brands.map((b) => b.category.handle)).toEqual(["brand-a"])
    expect(groups[1].category?.handle).toBe("lash-group")
  })

  it("그룹당 최대 개수를 넘으면 자른다", () => {
    const roots = [cat("brand-root", [cat("a"), cat("b"), cat("c")])]
    const { groups } = selectBrandTiles(roots, "brand-root", 2)
    expect(groups[0].brands.map((b) => b.category.handle)).toEqual(["a", "b"])
  })

  it("브랜드 루트가 없거나 자식이 없으면 빈 목록", () => {
    expect(selectBrandTiles([cat("other")], "brand-root", 10).groups).toEqual([])
    const emptyRoot = { ...cat("brand-root"), category_children: null }
    expect(selectBrandTiles([emptyRoot], "brand-root", 10).groups).toEqual([])
  })
})
