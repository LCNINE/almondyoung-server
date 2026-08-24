import { describe, expect, it } from "vitest"
import { parseCafe24LegacyUrl } from "./cafe24-legacy-url"

const parse = (url: string) => {
  const u = new URL(url, "https://almondyoung.com")
  return parseCafe24LegacyUrl(u.pathname, u.searchParams)
}

describe("parseCafe24LegacyUrl", () => {
  it("슬러그형 상품 URL 에서 product_no 를 뽑는다", () => {
    expect(parse("/product/타투-베리어-필름/3839/category/270/display/1")).toEqual({
      kind: "product",
      value: "3839",
    })
    expect(parse("/product/흉터-타투-스티커-10개입/2576")).toEqual({
      kind: "product",
      value: "2576",
    })
  })

  it("cafe24 표준 페이지를 종류별로 가른다", () => {
    expect(parse("/product/detail.html?product_no=3839&cate_no=270")).toEqual({
      kind: "product",
      value: "3839",
    })
    expect(parse("/product/list.html?cate_no=267")).toEqual({
      kind: "category",
      value: "267",
    })
    expect(parse("/product/search.html?keyword=캔바")).toEqual({
      kind: "search",
      value: "캔바",
    })
  })

  it("카테고리 URL 에서 cate_no 를 뽑는다", () => {
    expect(parse("/category/타투/271/링크2")).toEqual({
      kind: "category",
      value: "271",
    })
  })

  it("cafe24 URL 이 아니면 건드리지 않는다", () => {
    expect(parse("/kr/products/7c10f67d-4052-4378-9aff-c480177b49f0")).toBeUndefined()
    expect(parse("/kr/category/cafe24-cat-271")).toBeUndefined()
    expect(parse("/product/detail.html")).toBeUndefined()
    expect(parse("/product/list.html")).toBeUndefined()
    expect(parse("/category/타투")).toBeUndefined()
    expect(parse("/review/list.html")).toBeUndefined()
  })
})
