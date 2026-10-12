import { describe, expect, it } from "vitest"
import { parseScope, scopeFromSearch, scopeLevel, scopeQuery } from "./scope"

describe("BeautyTop geographic scope", () => {
  it("omits geographic filters for nationwide queries and keeps the category", () => {
    const scope = { sido: "", gugun: "", category: "네일" }
    expect(scopeLevel(scope)).toBe("national")
    expect(scopeQuery(scope)).toEqual({ category: "네일" })
  })
  it("distinguishes a province from its district", () => {
    expect(scopeQuery({ sido: "서울", gugun: "", category: "네일" })).toEqual({
      sido: "서울",
      category: "네일",
    })
    expect(scopeLevel({ sido: "서울", gugun: "", category: "네일" })).toBe(
      "province"
    )
    expect(
      scopeQuery({ sido: "서울", gugun: "마포구", category: "네일" })
    ).toEqual({ sido: "서울", gugun: "마포구", category: "네일" })
  })
  it("restores shared nationwide, province and legacy district links", () => {
    expect(scopeFromSearch("?category=네일")).toEqual({
      sido: "",
      gugun: "",
      category: "네일",
    })
    expect(scopeFromSearch("?sido=서울&gugun=&category=네일")).toEqual({
      sido: "서울",
      gugun: "",
      category: "네일",
    })
    expect(scopeFromSearch("?sido=서울&gugun=마포구&category=네일")).toEqual({
      sido: "서울",
      gugun: "마포구",
      category: "네일",
    })
  })
  it("rejects corrupt preferences, missing categories and orphan districts", () => {
    for (const invalid of [
      null,
      [],
      { sido: 1, gugun: "", category: "네일" },
      { sido: "", gugun: "마포구", category: "네일" },
      { sido: "서울", gugun: "", category: "" },
      { sido: "가".repeat(41), gugun: "", category: "네일" },
    ])
      expect(parseScope(invalid)).toBeNull()
    expect(scopeFromSearch("?sido=서울&gugun=마포구")).toBeNull()
  })
})
