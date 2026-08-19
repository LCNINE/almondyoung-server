import { describe, expect, it } from "vitest"
import { selectBrandTiles } from "./select-brand-tiles"

type Node = {
  id: string
  name: string
  handle: string
  metadata?: Record<string, unknown> | null
  category_children?: Node[] | null
}

const cat = (handle: string, children: Node[] = []): Node => ({
  id: `id-${handle}`,
  name: handle,
  handle,
  category_children: children,
})

const brandWithLogo = (handle: string, children: Node[] = []): Node => ({
  ...cat(handle, children),
  metadata: { thumbnail: `file-${handle}` },
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

  it("그룹 속 그룹: 깊이 제한 없이 리프 브랜드를 모은다", () => {
    const roots = [
      cat("brand-root", [
        cat("lash-group", [
          cat("premium-sub", [cat("brand-a"), cat("brand-b")]),
          cat("brand-c"),
        ]),
      ]),
    ]
    const { groups } = selectBrandTiles(roots, "brand-root", 10)
    expect(groups).toHaveLength(1)
    expect(groups[0].category?.handle).toBe("lash-group")
    expect(groups[0].brands.map((b) => b.category.handle)).toEqual([
      "brand-a",
      "brand-b",
      "brand-c",
    ])
    expect(groups[0].brands[0].handlePath).toEqual([
      "brand-root",
      "lash-group",
      "premium-sub",
      "brand-a",
    ])
  })

  it("로고 있는 노드는 자식(브랜드 하위 분류)이 있어도 브랜드로 본다", () => {
    const roots = [
      cat("brand-root", [
        cat("lash-group", [
          brandWithLogo("brand-a", [cat("brand-a-line-1"), cat("brand-a-line-2")]),
        ]),
        brandWithLogo("brand-b", [cat("brand-b-line")]),
      ]),
    ]
    const { groups } = selectBrandTiles(roots, "brand-root", 10)
    // brand-b: 직계인데 로고+자식 → 무명 그룹의 타일, 그룹으로 오판하지 않는다
    expect(groups[0].category).toBeNull()
    expect(groups[0].brands.map((b) => b.category.handle)).toEqual(["brand-b"])
    // brand-a: 그룹 안에서 로고+자식 → 타일로 멈추고 하위 분류로 내려가지 않는다
    expect(groups[1].brands.map((b) => b.category.handle)).toEqual(["brand-a"])
  })

  it("관리자 플래그(metadata.isBrand)가 로고·트리 모양 추정보다 우선한다", () => {
    const flagged = (n: Node, isBrand: boolean): Node => ({
      ...n,
      metadata: { ...(n.metadata ?? {}), isBrand },
    })
    const roots = [
      cat("brand-root", [
        // 로고 있는 그룹: 추정으로는 브랜드지만 isBrand:false 라 그룹으로 재귀
        flagged(brandWithLogo("logo-group", [cat("brand-a")]), false),
        // 로고 없고 자식 있는 브랜드: 추정으로는 그룹이지만 isBrand:true 라 타일
        flagged(cat("brand-b", [cat("brand-b-line")]), true),
      ]),
    ]
    const { groups } = selectBrandTiles(roots, "brand-root", 10)
    expect(groups[0].category).toBeNull()
    expect(groups[0].brands.map((b) => b.category.handle)).toEqual(["brand-b"])
    expect(groups[1].category?.handle).toBe("logo-group")
    expect(groups[1].brands.map((b) => b.category.handle)).toEqual(["brand-a"])
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
