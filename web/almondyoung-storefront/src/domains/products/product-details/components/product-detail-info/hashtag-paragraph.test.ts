import { describe, expect, it } from "vitest"
import { parseHashtagParagraph } from "./hashtag-paragraph"

describe("parseHashtagParagraph", () => {
  it("해시태그만 있는 문단을 태그 배열로 쪼갠다", () => {
    expect(
      parseHashtagParagraph("#마카롱위생접시 #위생트레이 #PP트레이 #macarontray")
    ).toEqual(["#마카롱위생접시", "#위생트레이", "#PP트레이", "#macarontray"])
  })

  it("줄바꿈으로 나뉘어 있어도 같다", () => {
    expect(parseHashtagParagraph("#가\n#나\n#다")).toEqual(["#가", "#나", "#다"])
  })

  it("일반 문장은 null", () => {
    expect(parseHashtagParagraph("마카롱 위생접시 4종 세트입니다")).toBeNull()
  })

  it("해시태그가 섞인 문장은 null", () => {
    expect(parseHashtagParagraph("세척 후 사용하세요 #위생트레이 #미용트레이")).toBeNull()
  })

  it("태그가 2개 이하면 null", () => {
    expect(parseHashtagParagraph("#위생트레이 #미용트레이")).toBeNull()
  })

  it("빈 문단은 null", () => {
    expect(parseHashtagParagraph("   ")).toBeNull()
  })
})
