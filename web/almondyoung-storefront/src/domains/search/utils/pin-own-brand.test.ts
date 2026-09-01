import { describe, expect, it } from "vitest"
import { pinOwnBrand } from "./pin-own-brand"
import { findOwnBrandAlias } from "../data/own-brand-aliases"

describe("pinOwnBrand", () => {
  it("자사 상품이 1위면 그대로 둔다", () => {
    expect(pinOwnBrand(["own", "a", "b"], ["own"], 1)).toEqual(["own", "a", "b"])
  })

  it("1위가 고정 후보 중 하나면 순서를 건드리지 않는다", () => {
    expect(pinOwnBrand(["own2", "a", "b"], ["own1", "own2"], 1)).toEqual([
      "own2",
      "a",
      "b",
    ])
  })

  it("결과 안에 있으면 2위로 끌어올린다", () => {
    expect(pinOwnBrand(["a", "b", "own", "c"], ["own"], 1)).toEqual([
      "a",
      "own",
      "b",
      "c",
    ])
  })

  it("두 개면 2위·3위에 나란히 끼운다", () => {
    expect(pinOwnBrand(["a", "b", "c"], ["own1", "own2"], 1)).toEqual([
      "a",
      "own1",
      "own2",
      "b",
      "c",
    ])
  })

  it("결과가 1건뿐이어도 뒤에 붙는다", () => {
    expect(pinOwnBrand(["a"], ["own"], 1)).toEqual(["a", "own"])
  })

  it("2페이지 이후에는 1페이지에 고정된 상품을 중복 노출하지 않는다", () => {
    expect(pinOwnBrand(["a", "own1", "b", "own2"], ["own1", "own2"], 2)).toEqual(
      ["a", "b"]
    )
  })

  it("고정 대상이 없으면 순서를 건드리지 않는다", () => {
    expect(pinOwnBrand(["a", "b"], [], 1)).toEqual(["a", "b"])
  })
})

describe("findOwnBrandAlias", () => {
  it("등록된 타사 브랜드는 대체 검색어로 바뀐다", () => {
    expect(findOwnBrandAlias("롤리킹")).toBe("속눈썹펌 롯드")
    expect(findOwnBrandAlias("마스트")).toBe("니들")
  })

  it("공백·대소문자는 무시한다", () => {
    expect(findOwnBrandAlias("퍼마 럭스")).toBe("색소")
    expect(findOwnBrandAlias(" 마스트 프로 니들 ")).toBe("니들")
  })

  it("부분일치로는 걸리지 않는다", () => {
    expect(findOwnBrandAlias("코스메틱")).toBeNull()
    expect(findOwnBrandAlias("퍼마블렌드")).toBeNull()
  })

  it("등록 안 된 검색어는 null", () => {
    expect(findOwnBrandAlias("테이프")).toBeNull()
  })
})
