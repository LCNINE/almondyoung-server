import { describe, expect, it } from "vitest"
import type { Layer } from "../lib/document"
import { fittedFontSize, photoBox, textBoxFor } from "./graphic"

const layer: Layer = {
  id: "t",
  name: "텍스트",
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 30,
  fill: "#000000",
  text: "테스트배너",
  fontSize: 20,
}

const paper = { widthMm: 210, heightMm: 297 }

describe("textBoxFor", () => {
  it("키운 글자 크기가 그대로 렌더되도록 상자를 맞춘다", () => {
    const resized = { ...layer, ...textBoxFor(layer, 56.5, paper) }
    expect(fittedFontSize(resized)).toBeCloseTo(56.5)
  })

  it("상자를 글자 폭에 딱 맞추고 정렬 기준 자리는 지킨다", () => {
    expect(textBoxFor(layer, 10, paper)).toEqual({
      fontSize: 10,
      x: 0,
      width: 50,
      height: 12,
    })
    expect(textBoxFor({ ...layer, align: "center" }, 10, paper).x).toBe(25)
    expect(textBoxFor({ ...layer, align: "right" }, 10, paper).x).toBe(50)
  })

  it("키워도 상자가 저장 가능한 범위(용지의 2배)를 넘지 않는다", () => {
    const dashes = { ...layer, text: "-".repeat(67), width: 40, height: 6 }
    const grown = textBoxFor(dashes, 30.85, paper)
    expect(grown.width).toBe(420)
    expect(textBoxFor({ ...dashes, ...grown }, 5, paper).width).toBe(201)
  })
})

describe("photoBox", () => {
  const photo = {
    ...layer,
    width: 20,
    height: 20,
    imageOffsetMode: "cover" as const,
    pixelWidth: 2000,
    pixelHeight: 1000,
  }

  it.each(["frame", "rect", "ellipse", "path"] as const)(
    "%s 사진을 원본 비율로 cover하고 양 끝까지 배치한다",
    (type) => {
      const left = photoBox({ ...photo, type, imageOffsetX: 0 })
      const right = photoBox({ ...photo, type, imageOffsetX: 1 })

      expect(left).toMatchObject({ x: 0, y: 0, width: 40, height: 20 })
      expect(right).toMatchObject({ x: -20, y: 0, width: 40, height: 20 })
      expect(right.x + right.width).toBe(photo.x + photo.width)
    }
  )

  it("일반 이미지의 기존 배치와 crop 계산은 유지한다", () => {
    expect(
      photoBox({ ...photo, type: "image", imageScale: 2, imageOffsetX: 1 })
    ).toMatchObject({ x: -20, y: -10, width: 40, height: 40 })
    expect(
      photoBox({
        ...photo,
        type: "image",
        crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
      })
    ).toEqual({
      x: -10,
      y: 0,
      width: 40,
      height: 20,
      preserveAspectRatio: "none",
    })
  })
})

it("새 위치 모드가 없는 옛 도형 사진은 기존 SVG 배치를 유지한다", () => {
  expect(
    photoBox({
      ...layer,
      type: "frame",
      width: 20,
      height: 20,
      pixelWidth: 2000,
      pixelHeight: 1000,
      imageScale: 2,
      imageOffsetX: 1,
    })
  ).toMatchObject({ x: -20, y: -10, width: 40, height: 40 })
})
