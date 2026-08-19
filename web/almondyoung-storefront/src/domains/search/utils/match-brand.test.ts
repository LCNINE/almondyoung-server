import { describe, expect, it } from "vitest"
import { matchBrandForQuery } from "./match-brand"

const BRANDS = [
  { name: "노몬드 No mond" },
  { name: "아이니 INi" },
  { name: "래쉬몬스터 LA:MON" },
  { name: "이탈 Ital" },
]

describe("matchBrandForQuery", () => {
  it("브랜드명만 검색해도 매칭된다", () => {
    expect(matchBrandForQuery(BRANDS, "노몬드")?.name).toBe("노몬드 No mond")
  })

  it("브랜드명 + 상품어 조합, 붙여쓰기도 매칭된다", () => {
    expect(matchBrandForQuery(BRANDS, "노몬드 오일")?.name).toBe(
      "노몬드 No mond"
    )
    expect(matchBrandForQuery(BRANDS, "노몬드펌글루")?.name).toBe(
      "노몬드 No mond"
    )
  })

  it("영문 토큰(3자 이상)으로도 매칭된다", () => {
    expect(matchBrandForQuery(BRANDS, "INI 젤")?.name).toBe("아이니 INi")
  })

  it("짧은 라틴 조각(no 등)으로는 오탐하지 않는다", () => {
    expect(matchBrandForQuery(BRANDS, "no show 양말")).toBeNull()
  })

  it("무관한 검색어는 null", () => {
    expect(matchBrandForQuery(BRANDS, "속눈썹 리무버")).toBeNull()
  })

  it("여러 브랜드가 걸리면 더 긴 토큰 매칭을 고른다", () => {
    const brands = [{ name: "몬드" }, { name: "노몬드" }]
    expect(matchBrandForQuery(brands, "노몬드 글루")?.name).toBe("노몬드")
  })

  it("한 글자 검색어는 무시한다", () => {
    expect(matchBrandForQuery(BRANDS, "노")).toBeNull()
  })
})
