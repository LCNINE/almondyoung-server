import { describe, expect, it } from "vitest"
import {
  markdownToMetaDescription,
  toMetaDescription,
} from "./meta-description"

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

describe("markdownToMetaDescription", () => {
  // 라이브 PIM 에서 그대로 가져온 형태 — 이미지 지시자만 있고 텍스트가 없다
  it("이미지 지시자만 있는 마크다운은 undefined", () => {
    const imageOnly = [
      '::product-image{fileId="019ff086-8b37-7546-b27a-faf872e2f713"}',
      '::product-image{fileId="019ff086-8b35-71ce-8948-f0453183c392"}',
    ].join("\n")
    expect(markdownToMetaDescription(imageOnly)).toBeUndefined()
  })

  it("지시자와 섞인 본문 텍스트는 남긴다", () => {
    const md = `## 상품 소개\n\n부드러운 **밍크모** 원사로 만든 래쉬입니다.\n\n::product-image{fileId="0000"}\n\n- 길이: 8~15mm\n- [브랜드 소개](https://example.invalid) 참고`
    const out = markdownToMetaDescription(md)!
    expect(out).toContain("부드러운 밍크모 원사로 만든 래쉬입니다.")
    expect(out).toContain("길이: 8~15mm")
    expect(out).toContain("브랜드 소개")
    expect(out).not.toContain("product-image")
    expect(out).not.toContain("#")
    expect(out).not.toContain("**")
  })

  it("시간 표기의 콜론은 지시자로 오인하지 않는다", () => {
    expect(markdownToMetaDescription("영업시간 10:00~18:00 안내")).toBe(
      "영업시간 10:00~18:00 안내"
    )
  })

  it("마크다운 이미지 문법은 제거한다", () => {
    expect(
      markdownToMetaDescription("![대체텍스트](https://example.invalid/x.png)")
    ).toBeUndefined()
  })

  it("155자를 넘으면 자른다", () => {
    const out = markdownToMetaDescription("가".repeat(300))!
    expect(out).toHaveLength(155)
    expect(out.endsWith("…")).toBe(true)
  })

  it("비어 있으면 undefined", () => {
    expect(markdownToMetaDescription(null)).toBeUndefined()
    expect(markdownToMetaDescription("")).toBeUndefined()
  })
})
