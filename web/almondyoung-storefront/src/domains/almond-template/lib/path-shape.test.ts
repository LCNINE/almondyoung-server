import { describe, expect, it } from "vitest"
import { moveHandle, toggleSmooth } from "../hooks/use-pen-tool"
import { newDesign, parseDesign, type Layer } from "./document"
import {
  fitPath,
  pathData,
  refitPathLayer,
  shapeOutline,
  smoothStroke,
  starPolygon,
  toAbsolute,
} from "./path-shape"

// 도형 좌표를 회전·반전까지 적용한 화면 좌표로
function world(layer: Layer, p: { x: number; y: number }) {
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  const dx = (p.x - cx) * (layer.flipX ? -1 : 1)
  const dy = (p.y - cy) * (layer.flipY ? -1 : 1)
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  }
}

describe("펜 도형", () => {
  it("그린 점을 곡선에 맞는 상자와 0~1 좌표로 바꾼다", () => {
    const fitted = fitPath(
      [
        { x: 10, y: 20 },
        { x: 30, y: 20, ix: 20, iy: 0, ox: 40, oy: 40 },
        { x: 50, y: 30 },
      ],
      false
    )
    expect(fitted.x).toBe(10)
    expect(fitted.width).toBe(40)
    // 곡선이 위로 튀어나간 만큼 상자가 위로 늘어난다
    expect(fitted.y).toBeLessThan(20)
    expect(fitted.pathPoints[0]).toEqual({ x: 0, y: expect.any(Number) })
    expect(fitted.pathPoints[1].ix).toBeDefined()
  })

  it("일직선도 최소 상자를 가진다", () => {
    const fitted = fitPath(
      [
        { x: 0, y: 5 },
        { x: 20, y: 5 },
      ],
      false
    )
    expect(fitted.height).toBe(1)
    expect(fitted.pathPoints.map((p) => p.y)).toEqual([0.5, 0.5])
  })

  it("회전·반전한 도형의 상자를 다시 맞춰도 화면 위 점은 제자리다", () => {
    const layer: Layer = {
      ...newDesign("card").front[0],
      id: "p",
      type: "path",
      name: "펜",
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      fill: "none",
      rotation: 30,
      flipX: true,
      pathClosed: true,
      pathPoints: [
        { x: 0, y: 0 },
        { x: 1.5, y: 0.2 },
        { x: 0.4, y: 1.8 },
      ],
    }
    const next = { ...layer, ...refitPathLayer(layer) }
    const before = toAbsolute(layer.pathPoints!, layer).map((p) =>
      world(layer, p)
    )
    const after = toAbsolute(next.pathPoints!, next).map((p) => world(next, p))
    after.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i].x, 1)
      expect(p.y).toBeCloseTo(before[i].y, 1)
    })
    expect(next.pathPoints!.every((p) => p.x >= 0 && p.x <= 1)).toBe(true)
  })

  it("핸들 하나를 옮기면 반대쪽은 각도만 맞추고, Alt 면 그대로 둔다", () => {
    const point = { x: 0, y: 0, ix: -2, iy: 0, ox: 2, oy: 0 }
    const mirrored = moveHandle(point, "out", { x: 0, y: 5 }, false)
    expect(mirrored.ix).toBeCloseTo(0)
    expect(mirrored.iy).toBeCloseTo(-2)
    const free = moveHandle(point, "out", { x: 0, y: 5 }, true)
    expect([free.ix, free.iy]).toEqual([-2, 0])
  })

  it("꺾인 점과 부드러운 점을 오간다", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { x: 6, y: 0 },
    ]
    const smooth = toggleSmooth(points, 1, false)
    // 이웃을 잇는 방향(가로)으로, 이웃까지 거리의 1/3 만큼
    expect(smooth[1].ix).toBeCloseTo(3 - Math.SQRT2)
    expect(smooth[1].oy).toBeCloseTo(3)
    expect(toggleSmooth(smooth, 1, false)[1]).toEqual({ x: 3, y: 3 })
  })

  it("별은 꼭짓점 수만큼 뾰족하고 상자를 꽉 채운다", () => {
    const star = starPolygon(7, 0.5)
    expect(star).toHaveLength(14)
    expect(Math.min(...star.map(([x]) => x))).toBeCloseTo(0)
    expect(Math.max(...star.map(([, y]) => y))).toBeCloseTo(1)
  })

  it("기본 도형을 점 편집용 윤곽으로 바꾸고, 모양틀 윤곽은 바꾸지 않는다", () => {
    const base = { ...newDesign("card").front[0] } as Layer
    for (const [type, shapeVariant] of [
      ["rect", undefined],
      ["rect", "rounded"],
      ["rect", "hexagon"],
      ["ellipse", undefined],
      ["triangle", undefined],
      ["star", undefined],
      ["heart", undefined],
    ] as const) {
      const outline = shapeOutline({
        ...base,
        type,
        shapeVariant,
        width: 10,
        height: 10,
      })
      expect(outline?.length).toBeGreaterThan(2)
      expect(pathData(outline!, true)).toMatch(/Z$/)
    }
    expect(
      shapeOutline({ ...base, type: "rect", shapeVariant: "cloud" })
    ).toBeNull()
  })

  it("저장 파일의 펜 도형·효과 값을 검사한다", () => {
    const design = newDesign("card")
    const path: Layer = {
      id: "pen",
      type: "path",
      name: "펜",
      x: 5,
      y: 5,
      width: 20,
      height: 10,
      fill: "none",
      stroke: "#202020",
      strokeWidth: 0.4,
      strokeDash: "dotted",
      strokeRound: true,
      shadow: true,
      shadowX: -2,
      shadowColor: "#ff0000",
      bevel: true,
      bevelAngle: 45,
      pathClosed: false,
      pathPoints: [
        { x: 0, y: 0, ox: 0.5, oy: -0.4 },
        { x: 1, y: 1 },
      ],
    }
    expect(parseDesign({ ...design, front: [path] }).front[0]).toEqual(path)
    for (const broken of [
      { pathPoints: [{ x: 0, y: 0 }] },
      {
        pathPoints: [
          { x: 0, y: 0, ox: 1 },
          { x: 1, y: 1 },
        ],
      },
      { strokeDash: "wavy" },
      { shadowColor: "red" },
      { starPoints: 2.5 },
    ])
      expect(() =>
        parseDesign({ ...design, front: [{ ...path, ...broken }] })
      ).toThrow()
  })

  it("연필의 떨리는 선을 적은 점의 매끈한 곡선으로 줄인다", () => {
    // 가로로 그은 선에 위아래 0.05mm 떨림
    const shaky = Array.from({ length: 80 }, (_, i) => ({
      x: i * 0.25,
      y: 10 + (i % 2 ? 0.05 : -0.05),
    }))
    const flat = smoothStroke(shaky, 0.1, 50)
    expect(flat.closed).toBe(false)
    expect(flat.points.length).toBeLessThanOrEqual(3)
    // 시작과 끝 자리는 그대로 둔다
    expect(flat.points[0]).toMatchObject({ x: 0 })
    expect(flat.points.at(-1)).toMatchObject({ x: 79 * 0.25 })

    // 손으로 그은 물결선: 보정을 올리면 떨림부터 걸러지고, 더 올리면 잔물결까지 편다
    const wavy = Array.from({ length: 120 }, (_, i) => ({
      x: i * 0.2,
      y: 10 + Math.sin(i / 6) * 2 + (i % 3) * 0.15,
    }))
    const counts = [0, 50, 100].map(
      (level) => smoothStroke(wavy, 0.1, level).points.length
    )
    expect(counts[0]).toBeGreaterThan(counts[1] * 3)
    expect(counts[2]).toBeLessThanOrEqual(counts[1])

    const circle = Array.from({ length: 60 }, (_, i) => ({
      x: 20 + 10 * Math.cos((i / 59) * Math.PI * 2),
      y: 20 + 10 * Math.sin((i / 59) * Math.PI * 2),
    }))
    const round = smoothStroke(circle, 0.1, 50)
    expect(round.closed).toBe(true)
    expect(round.points.every((p) => p.ix !== undefined)).toBe(true)
  })
})
