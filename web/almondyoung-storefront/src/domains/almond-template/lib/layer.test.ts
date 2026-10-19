import { describe, expect, it } from "vitest"
import {
  isAutoTextName,
  makeLayer,
  replaceEverywhere,
  swapColor,
  textLayerName,
} from "./layer"
import { newDesign, parseDesign, type Layer } from "./document"

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

describe("replaceEverywhere", () => {
  const layer = (patch: Partial<Layer>): Layer => ({
    id: patch.id ?? "a",
    type: "text",
    name: "글자",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    fill: "#111111",
    ...patch,
  })
  const design = {
    ...newDesign("card", "p"),
    front: [
      layer({ id: "a", fill: "#FF0000", stroke: "#ff0000" }),
      layer({ id: "b", fill: "#00ff00", textColor: "#ff0000" }),
      layer({ id: "c", fill: "#ff0000", locked: true }),
    ],
    back: [layer({ id: "d", fill: "#ff0000" })],
  }

  it("앞·뒷면에서 같은 색을 대소문자 상관없이 모든 색 칸에서 바꾸고, 못 고치는 요소는 둔다", () => {
    const next = replaceEverywhere(
      design,
      (item) => !item.locked,
      (item) => swapColor(item, "#ff0000", "#0000ff")
    )
    expect(
      next.front.map((item) => [item.fill, item.stroke, item.textColor])
    ).toEqual([
      ["#0000ff", "#0000ff", undefined],
      ["#00ff00", undefined, "#0000ff"],
      ["#ff0000", undefined, undefined],
    ])
    expect(next.back[0].fill).toBe("#0000ff")
  })

  it("글자색을 정하지 않은 도형 글자는 보이는 색(채우기 밝기로 정해진 색)으로 비교한다", () => {
    const shape = layer({ type: "rect", fill: "#111111", text: "안녕" })
    expect(swapColor(shape, "#ffffff", "#ff0000")).toEqual({
      textColor: "#ff0000",
    })
    expect(
      swapColor({ ...shape, text: undefined }, "#ffffff", "#ff0000")
    ).toEqual({})
  })

  it("바뀐 게 없는 요소는 그대로 두어 다시 그리지 않는다", () => {
    const next = replaceEverywhere(
      design,
      () => true,
      (item) => swapColor(item, "#123456", "#0000ff")
    )
    expect(next.front[1]).toBe(design.front[1])
  })
})
