import { describe, expect, it } from "vitest"
import { formatProductInfoText } from "./format-product-info-text"

describe("formatProductInfoText", () => {
  it("붙어 있는 사용방법의 각 단계를 새 줄에서 시작한다", () => {
    expect(
      formatProductInfoText(
        "① 파일링을 시작합니다.② 곡선형 스크러버로 살살 밀어줍니다.③ 미온수로 씻어냅니다."
      )
    ).toBe(
      "① 파일링을 시작합니다.\n② 곡선형 스크러버로 살살 밀어줍니다.\n③ 미온수로 씻어냅니다."
    )
  })

  it("기존 단계와 문단의 줄바꿈을 중복 없이 보존한다", () => {
    const value = "① 파일링을 시작합니다.\n② 씻어냅니다.\n\n사용 후 보관하세요."

    expect(formatProductInfoText(value)).toBe(value)
  })

  it("용량과 규격에 있는 숫자나 문장 내용은 바꾸지 않는다", () => {
    expect(formatProductInfoText("1.5ml / 10 × 20mm")).toBe("1.5ml / 10 × 20mm")
  })
})
