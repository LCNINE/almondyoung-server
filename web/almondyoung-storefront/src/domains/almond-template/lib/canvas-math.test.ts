import { describe, expect, it } from "vitest"
import type { Layer } from "./document"
import {
  cropToBox,
  gaps,
  currentCrop,
  panCrop,
  scaleIntoBox,
  snapBox,
} from "./canvas-math"

const paper = { widthMm: 100, heightMm: 60 }
const photo: Layer = {
  id: "p",
  type: "image",
  name: "사진",
  x: 10,
  y: 10,
  width: 40,
  height: 20,
  fill: "#000000",
  image: "data:image/png;base64,AA==",
  pixelWidth: 2000,
  pixelHeight: 1000,
}

describe("스마트 가이드", () => {
  it("가운데가 종이 가운데에 가까우면 붙이고 그 선을 알려준다", () => {
    const snap = snapBox({ x0: 29, x1: 69, y0: 3, y1: 13 }, [], paper, 2)
    expect(snap.dx).toBeCloseTo(1)
    expect(snap.guides.x).toEqual([50])
  })
  it("다른 요소의 끝선에 시작선을 맞춘다", () => {
    const other = { x0: 0, x1: 20, y0: 40, y1: 50 }
    const snap = snapBox({ x0: 21, x1: 31, y0: 10, y1: 15 }, [other], paper, 2)
    expect(snap.dx).toBeCloseTo(-1)
  })
  it("멀면 그대로 둔다", () => {
    const snap = snapBox({ x0: 11, x1: 21, y0: 21, y1: 26 }, [], paper, 1)
    expect([snap.dx, snap.dy, snap.guides.x.length]).toEqual([0, 0, 0])
  })
})

describe("묶음 크기 조절", () => {
  it("묶음 상자를 두 배로 늘리면 구성원 위치·크기도 두 배가 된다", () => {
    const from = { x0: 10, y0: 10, x1: 50, y1: 30 }
    const to = { x0: 10, y0: 10, x1: 90, y1: 50 }
    expect(
      scaleIntoBox({ ...photo, x: 30, y: 20, width: 20, height: 10 }, from, to)
    ).toEqual({
      x: 50,
      y: 30,
      width: 40,
      height: 20,
    })
  })
})

describe("사진 자르기", () => {
  it("비율이 같은 사진은 처음엔 전체가 보인다", () => {
    expect(currentCrop(photo)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
  it("상자를 줄이면 사진은 제자리에 두고 그 구간만 남긴다", () => {
    const cut = cropToBox(photo, { x: 20, y: 10, width: 20, height: 20 })
    expect(cut.crop).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 })
    expect([cut.x, cut.width]).toEqual([20, 20])
  })
  it("상자는 사진 밖으로 나가지 않는다", () => {
    const cut = cropToBox(photo, { x: 0, y: 0, width: 80, height: 80 })
    expect([cut.x, cut.y, cut.width, cut.height]).toEqual([10, 10, 40, 20])
  })
  it("안쪽을 끌면 사진만 밀리고 원본 끝에서 멈춘다", () => {
    const cropped = {
      ...photo,
      ...cropToBox(photo, { x: 20, y: 10, width: 20, height: 20 }),
    }
    expect(panCrop(cropped, 5, 0).crop?.x).toBeCloseTo(0.125)
    expect(panCrop(cropped, 100, 0).crop?.x).toBe(0)
  })
})

describe("gaps", () => {
  it("떨어진 두 상자는 사이 거리 하나를 겹친 높이 가운데에 잰다", () => {
    expect(
      gaps({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 15, y0: 4, x1: 20, y1: 20 })
    ).toEqual([{ x1: 10, y1: 7, x2: 15, y2: 7, mm: 5 }])
  })

  it("안에 든 상자는 바깥 상자 네 변까지 잰다", () => {
    expect(
      gaps({ x0: 2, y0: 3, x1: 8, y1: 9 }, { x0: 0, y0: 0, x1: 10, y1: 10 })
    ).toEqual([
      { x1: 0, y1: 6, x2: 2, y2: 6, mm: 2 },
      { x1: 8, y1: 6, x2: 10, y2: 6, mm: 2 },
      { x1: 5, y1: 0, x2: 5, y2: 3, mm: 3 },
      { x1: 5, y1: 9, x2: 5, y2: 10, mm: 1 },
    ])
  })

  it("한 축에서 비스듬히 겹치면 그 축은 재지 않는다", () => {
    expect(
      gaps({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 5, y0: 20, x1: 15, y1: 30 })
    ).toEqual([{ x1: 7.5, y1: 10, x2: 7.5, y2: 20, mm: 10 }])
  })
})
