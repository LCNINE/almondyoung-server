import { describe, expect, it } from "vitest"
import { ALL_TAB_KEY, deriveTimeSaleTabs } from "./time-sale-tabs"

const sources = [
  { key: "nail", name: "네일아트", handle: "cat-nail", categoryIds: ["nail", "nail-child"] },
  { key: "hair", name: "헤어", handle: "cat-hair", categoryIds: ["hair"] },
  { key: "tattoo", name: "타투", handle: "cat-tattoo", categoryIds: ["tattoo"] },
]

const products = [
  { id: "p1", categoryIds: ["nail-child"] },
  { id: "p2", categoryIds: ["hair"] },
  { id: "p3", categoryIds: ["nail"] },
]

describe("deriveTimeSaleTabs", () => {
  // 빈 탭은 손님에게 고장으로 읽힌다. 타투에 세일 상품이 없으면 탭도 없어야 한다.
  it("세일 상품이 없는 카테고리는 탭을 만들지 않는다", () => {
    const tabs = deriveTimeSaleTabs(products, sources, "전체")
    expect(tabs.map((tab) => tab.key)).toEqual([ALL_TAB_KEY, "nail", "hair"])
  })

  it("전체 탭이 맨 앞이고 세일 상품을 전부 담는다", () => {
    const [all] = deriveTimeSaleTabs(products, sources, "전체")
    expect(all.key).toBe(ALL_TAB_KEY)
    expect(all.productIds).toEqual(["p1", "p2", "p3"])
  })

  // 상품은 말단 카테고리에 붙으므로 루트만 보면 못 잡는다.
  it("자손 카테고리로 붙은 상품도 루트 탭에 들어간다", () => {
    const nail = deriveTimeSaleTabs(products, sources, "전체").find((tab) => tab.key === "nail")
    expect(nail?.productIds).toEqual(["p1", "p3"])
  })

  // "전체" 와 완전히 겹치는 탭 하나만 남으면 탭 줄이 정보를 주지 않는다.
  it("카테고리가 하나뿐이면 탭을 아예 그리지 않는다", () => {
    expect(deriveTimeSaleTabs([{ id: "p2", categoryIds: ["hair"] }], sources, "전체")).toEqual([])
  })

  it("세일 상품이 없으면 탭도 없다", () => {
    expect(deriveTimeSaleTabs([], sources, "전체")).toEqual([])
  })
})
