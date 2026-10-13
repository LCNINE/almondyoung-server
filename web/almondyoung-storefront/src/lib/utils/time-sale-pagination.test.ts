import { describe, expect, it } from "vitest"
import {
  buildPager,
  chunk,
  pageCount,
  pageIds,
  pageWindowItems,
  parsePage,
  morePageSize,
} from "./time-sale-pagination"
import { defaultTimeSaleSettings } from "@packages/domain-types/time-sale"

const ids = Array.from({ length: 120 }, (_, i) => `p${i + 1}`)

describe("더보기 페이지 나누기", () => {
  it("기본 더보기는 라이브처럼 PC·모바일 모두 한 페이지 40개다", () => {
    const settings = defaultTimeSaleSettings()
    expect(morePageSize(settings, "pc")).toBe(40)
    expect(morePageSize(settings, "mobile")).toBe(40)
  })
  it("120개를 6개씩이면 20 페이지, 20 페이지는 115~120", () => {
    expect(pageCount(120, 6)).toBe(20)
    expect(pageIds(ids, 20, 6)).toEqual([
      "p115",
      "p116",
      "p117",
      "p118",
      "p119",
      "p120",
    ])
  })

  it("범위를 벗어나거나 이상한 page 는 보정한다", () => {
    expect(parsePage(undefined, 20)).toBe(1)
    expect(parsePage("abc", 20)).toBe(1)
    expect(parsePage("0", 20)).toBe(1)
    expect(parsePage("2abc", 20)).toBe(1)
    expect(parsePage("2.5", 20)).toBe(1)
    expect(parsePage("2e3", 20)).toBe(1)
    expect(parsePage("99", 20)).toBe(20)
    expect(parsePage("7", 20)).toBe(7)
  })

  it("chunk 는 상한 단위로 자른다", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe("페이지 윈도우", () => {
  it("원본처럼 1 … 3 4 5 6 7 … 9", () => {
    expect(pageWindowItems(5, 9, 5)).toEqual([
      1,
      "gap",
      3,
      4,
      5,
      6,
      7,
      "gap",
      9,
    ])
  })

  it("가장자리는 한쪽만 말줄임", () => {
    expect(pageWindowItems(1, 20, 5)).toEqual([1, 2, 3, 4, 5, "gap", 20])
    expect(pageWindowItems(20, 20, 5)).toEqual([1, "gap", 16, 17, 18, 19, 20])
  })

  it("한 페이지뿐이면 비운다", () => {
    expect(pageWindowItems(1, 1, 5)).toEqual([])
  })

  it("링크와 현재 페이지 표시를 만든다", () => {
    const pager = buildPager(2, 3, (n) => `/kr/time-sale?page=${n}`)

    expect(pager).toEqual([
      { label: "1", href: "/kr/time-sale?page=1", current: false },
      { label: "2", href: "/kr/time-sale?page=2", current: true },
      { label: "3", href: "/kr/time-sale?page=3", current: false },
    ])
  })
})
