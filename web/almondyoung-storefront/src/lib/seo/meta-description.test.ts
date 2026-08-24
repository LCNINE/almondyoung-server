import { describe, expect, it } from "vitest"
import { toMetaDescription } from "./meta-description"

describe("toMetaDescription", () => {
  it("마크업을 걷어내고 한 줄 텍스트로 만든다", () => {
    expect(
      toMetaDescription(
        "<div><p>필름 롤을 끼워 쓰는 <strong>본체</strong>입니다.</p>\n<p>한 번 구매하면 계속 사용합니다.</p></div>"
      )
    ).toBe("필름 롤을 끼워 쓰는 본체입니다. 한 번 구매하면 계속 사용합니다.")
  })

  it("붙어버린 블록 사이에 공백을 넣는다", () => {
    expect(toMetaDescription("<p>앞</p><p>뒤</p>")).toBe("앞 뒤")
  })

  it("155자를 넘으면 자른다", () => {
    const long = toMetaDescription(`<p>${"가".repeat(300)}</p>`)!
    expect(long).toHaveLength(155)
    expect(long.endsWith("…")).toBe(true)
  })

  it("내용이 없으면 undefined 로 폴백을 넘긴다", () => {
    expect(toMetaDescription(null)).toBeUndefined()
    expect(toMetaDescription("")).toBeUndefined()
    expect(toMetaDescription('<img src="x"><p><br></p>')).toBeUndefined()
  })
})
