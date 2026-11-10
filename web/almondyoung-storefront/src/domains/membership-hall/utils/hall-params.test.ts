import { describe, expect, it } from "vitest"
import {
  hallHref,
  parseHallState,
  totalPages,
  visibleHallFields,
} from "./hall-params"

describe("parseHallState", () => {
  it("모르는 값은 기본값으로 돌린다", () => {
    expect(
      parseHallState({ tab: "x", sort: "y", category: "nomond", page: "-2" })
    ).toEqual({ tab: "all", sort: "sales", field: null, page: 1 })
  })

  it("주소의 탭·정렬·분야·페이지를 읽는다", () => {
    expect(
      parseHallState({ tab: "sale", sort: "newest", category: "nail", page: "3" })
    ).toEqual({ tab: "sale", sort: "newest", field: "nail", page: 3 })
  })
})

describe("hallHref", () => {
  const state = parseHallState({ tab: "discount", category: "nail", page: "4" })

  it("기본값은 주소에서 뺀다", () => {
    expect(hallHref(parseHallState({}), {})).toBe("/membership-hall")
  })

  it("페이지만 바꾸면 나머지는 유지한다", () => {
    expect(hallHref(state, { page: 5 })).toBe(
      "/membership-hall?tab=discount&category=nail&page=5"
    )
  })

  it("정렬·분야·탭을 바꾸면 1페이지로 돌린다", () => {
    expect(hallHref(state, { sort: "discount" })).toBe(
      "/membership-hall?tab=discount&category=nail&sort=discount"
    )
    expect(hallHref(state, { field: null })).toBe(
      "/membership-hall?tab=discount"
    )
    expect(hallHref(state, { tab: "all" })).toBe(
      "/membership-hall?category=nail"
    )
  })
})

describe("visibleHallFields", () => {
  it("상품이 있는 분야만 고정 순서로 남긴다", () => {
    expect(
      visibleHallFields([
        { id: "a", handle: "cafe24-cat-28", count: 3 },
        { id: "b", handle: "cafe24-cat-246", count: 1 },
        { id: "c", handle: "cafe24-cat-271", count: 0 },
        { id: "d", handle: "b9og25", count: 9 },
      ])
    ).toEqual(["lash-perm", "nail"])
  })
})

describe("totalPages", () => {
  it("0개여도 1페이지다", () => {
    expect(totalPages(0)).toBe(1)
    expect(totalPages(41)).toBe(2)
  })
})
