import { describe, expect, it } from "vitest"
import type { Layer } from "../../../lib/document"
import { moveLayers } from "./layers-panel"

const layer = (id: string, groupId?: string): Layer => ({
  id,
  type: "rect",
  name: id,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  fill: "#000000",
  groupId,
})

// 배열은 아래에서 위 순서다
const layers = [
  layer("a1", "A"),
  layer("a2", "A"),
  layer("b1", "B"),
  layer("b2", "B"),
  layer("b3", "B"),
  layer("c"),
]
const order = (next: Layer[] | null) => next?.map((item) => item.id)

describe("레이어 패널 끌어 옮기기", () => {
  it("그룹째 다른 그룹 안에 놓아도 그 그룹을 쪼개지 않고 바깥 끝에 붙는다", () => {
    expect(order(moveLayers(layers, ["a1", "a2"], "b2", true))).toEqual([
      "b1",
      "b2",
      "b3",
      "a1",
      "a2",
      "c",
    ])
    expect(order(moveLayers(layers, ["b1", "b2", "b3"], "a2", true))).toEqual(
      ["b1", "b2", "b3", "a1", "a2", "c"]
    )
  })

  it("낱장을 그룹 안 줄에 놓으면 그 그룹에 들어간다", () => {
    const next = moveLayers(layers, ["c"], "b2", false)

    expect(order(next)).toEqual(["a1", "a2", "b1", "c", "b2", "b3"])
    expect(next?.find((item) => item.id === "c")?.groupId).toBe("B")
  })
})
