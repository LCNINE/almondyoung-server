import { describe, expect, it } from "vitest"
import {
  lineDashArray,
  lineFromPoints,
  lineGeometry,
  lineWorldPoints,
} from "./line-shape"
import { newDesign, parseDesign } from "./document"
import { makeLayer } from "./layer"

const base = { x: 0, y: 0, width: 100, height: 4, strokeWidth: 2 }

describe("선 스타일 점선", () => {
  it("망고보드 공식 (a·sw − sw), (b·sw + sw)", () => {
    expect(lineDashArray({ ...base, strokeWidth: 10, lineDash: [7, 3] })).toBe(
      "60 40"
    )
    expect(lineDashArray({ ...base, strokeWidth: 10, lineDash: [1, 1] })).toBe(
      "0 20"
    )
  })

  it("실선은 없음, 사용자 지정은 mm 값을 그대로 쓴다", () => {
    expect(lineDashArray(base)).toBeUndefined()
    expect(lineDashArray({ ...base, lineDashCustom: [5, 5] })).toBe("3 7")
  })
})

describe("점으로 선 상자 만들기", () => {
  it("두 점이면 길이가 너비, 방향이 회전이다", () => {
    const box = lineFromPoints(
      [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
      ],
      4
    )
    expect(box).toMatchObject({ width: 50, height: 4, rotation: 90 })
    expect(box.linePath).toBeUndefined()
    const [start, end] = lineWorldPoints({ ...base, ...box })
    expect(start.x).toBeCloseTo(0)
    expect(start.y).toBeCloseTo(0)
    expect(end.x).toBeCloseTo(0)
    expect(end.y).toBeCloseTo(50)
  })

  it("꺾임점이 있으면 상자가 그 점까지 감싸고 점들이 제자리에 남는다", () => {
    const points = [
      { x: 10, y: 10 },
      { x: 40, y: 50 },
      { x: 70, y: 10 },
    ]
    const box = lineFromPoints(points, 4)
    expect(box.height).toBeCloseTo(40)
    lineWorldPoints({ ...base, ...box }).forEach((p, i) => {
      expect(p.x).toBeCloseTo(points[i].x, 2)
      expect(p.y).toBeCloseTo(points[i].y, 2)
    })
  })
})

describe("선 모양", () => {
  it("직선은 꺾은선, 곡선은 Q", () => {
    const linePath = [
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 },
    ]
    expect(lineGeometry({ ...base, linePath }).d).toBe("M0,0 L50,4 L100,0")
    expect(lineGeometry({ ...base, linePath, lineCurved: true }).d).toBe(
      "M0,0 Q50,4 100,0"
    )
  })

  it("채운 화살촉은 끝점에 촉을 두고 본선을 촉 안쪽에서 끊는다", () => {
    const geometry = lineGeometry({ ...base, lineEnd: "arrow" })
    expect(geometry.caps).toHaveLength(1)
    expect(geometry.caps[0].d.startsWith("M100,2")).toBe(true)
    expect(geometry.d).toBe("M0,2 L95.2,2")
  })

  it("머리 크기는 시작 촉만 키운다", () => {
    const geometry = lineGeometry({
      ...base,
      lineStart: "square",
      lineStartSize: 2,
    })
    expect(geometry.caps[0].d).toBe("M6,8 L-6,8 L-6,-4 L6,-4 z")
  })
})

describe("저장한 시안 불러오기", () => {
  it("새 선 필드와 손그림 모양이 검증을 통과한다", () => {
    const design = newDesign("card")
    design.front = [
      {
        ...makeLayer("line", design),
        lineStart: "dot",
        lineEnd: "notched",
        lineStartSize: 2,
        lineDash: [7, 3],
        lineCurved: true,
        linePath: [
          { x: 0, y: 0 },
          { x: 0.5, y: 1 },
          { x: 1, y: 0 },
        ],
      },
      { ...makeLayer("rect", design), shapeVariant: "hand-heart" },
    ]
    expect(parseDesign(design).front).toHaveLength(2)
    expect(() =>
      parseDesign({
        ...design,
        front: [{ ...design.front[0], lineEnd: "spiral" as never }],
      })
    ).toThrow()
  })
})
