import { describe, expect, it } from "vitest"
import { BRAND_CATEGORY_HANDLE } from "../../../lib/constants/brand"
import {
  collectBrandDescendantIds,
  isBrandChildCategory,
} from "./brand-category"

describe("collectBrandDescendantIds", () => {
  const tree = [
    {
      id: "root",
      handle: BRAND_CATEGORY_HANDLE,
      category_children: [
        { id: "child", handle: "child" },
        {
          id: "group",
          handle: "group",
          category_children: [{ id: "grandchild", handle: "grandchild" }],
        },
      ],
    },
    { id: "other", handle: "other", category_children: [{ id: "other-child", handle: "oc" }] },
  ]

  it("직계 자식·중간 그룹·손자를 전부 포함하고 루트 자신과 타 트리는 제외한다", () => {
    const ids = collectBrandDescendantIds(tree)
    expect(ids.has("child")).toBe(true)
    expect(ids.has("group")).toBe(true)
    expect(ids.has("grandchild")).toBe(true)
    expect(ids.has("root")).toBe(false)
    expect(ids.has("other-child")).toBe(false)
  })

  it("브랜드 루트가 없으면 빈 집합", () => {
    expect(collectBrandDescendantIds([{ id: "x", handle: "x" }]).size).toBe(0)
  })
})

describe("isBrandChildCategory", () => {
  it("부모 id 가 브랜드 루트면 true", () => {
    expect(
      isBrandChildCategory({ parent_category_id: "pcat_brand" }, "pcat_brand")
    ).toBe(true)
  })

  it("부모 id 가 다르면 false", () => {
    expect(
      isBrandChildCategory({ parent_category_id: "pcat_other" }, "pcat_brand")
    ).toBe(false)
  })

  it("브랜드 루트 id 를 못 구해도 parent_category handle 로 판정한다", () => {
    expect(
      isBrandChildCategory(
        {
          parent_category_id: "pcat_x",
          parent_category: { handle: BRAND_CATEGORY_HANDLE },
        },
        null
      )
    ).toBe(true)
  })

  it("부모 정보가 전혀 없으면 false", () => {
    expect(isBrandChildCategory({}, null)).toBe(false)
    expect(
      isBrandChildCategory({ parent_category_id: null, parent_category: null }, null)
    ).toBe(false)
  })

  it("브랜드 루트 자신(부모 없음)은 false", () => {
    expect(
      isBrandChildCategory({ parent_category_id: null }, "pcat_brand")
    ).toBe(false)
  })
})
