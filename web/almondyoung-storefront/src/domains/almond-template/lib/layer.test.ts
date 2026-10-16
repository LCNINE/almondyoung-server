import { describe, expect, it } from "vitest"
import { isAutoTextName, makeLayer, textLayerName } from "./layer"
import { newDesign, parseDesign } from "./document"

describe("텍스트 레이어 이름", () => {
  it("문구 첫 줄을 30자까지 쓰고, 비면 '텍스트'", () => {
    expect(textLayerName("  오로시 네일\n010-0000-0000")).toBe("오로시 네일")
    expect(textLayerName("가".repeat(40))).toBe("가".repeat(30))
    expect(textLayerName("   ")).toBe("텍스트")
  })

  it("새 텍스트 레이어는 기본 문구가 이름이고 이미지는 '이미지'", () => {
    const design = newDesign("card")
    expect(makeLayer("text", design).name).toBe("문구를 입력하세요")
    expect(makeLayer("image", design).name).toBe("이미지")
  })

  it("직접 바꾼 이름은 자동 이름이 아니다", () => {
    const layer = makeLayer("text", newDesign("card"))
    expect(isAutoTextName(layer)).toBe(true)
    expect(isAutoTextName({ ...layer, name: "상호명" })).toBe(false)
  })

  it("예전에 저장된 '텍스트' 이름은 불러올 때 문구로 바뀐다", () => {
    const design = newDesign("card")
    const layer = {
      ...makeLayer("text", design),
      name: "텍스트",
      text: "가격표",
    }
    const custom = { ...layer, id: "b", name: "상호명" }
    const loaded = parseDesign({ ...design, front: [layer, custom] })
    expect(loaded.front.map((item) => item.name)).toEqual(["가격표", "상호명"])
  })
})
