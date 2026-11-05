import { describe, expect, it } from "vitest"
import type { Layer } from "./document"
import { mm } from "./layer"
import {
  cropToBox,
  gaps,
  currentCrop,
  panCrop,
  panPhoto,
  photoEditOffsets,
  scaleIntoBox,
  scalePhoto,
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
  it.each([
    [0.3, 0.3],
    [0.1, 0.1],
    [0.05, 0.1],
    [0.01, 0.1],
  ])("축소된 크기 %smm를 %smm로 제한한다", (size, expected) => {
    const from = { x0: 0, y0: 0, x1: 1, y1: 1 }
    const to = { x0: 0, y0: 0, x1: size, y1: size }
    const layer = { ...photo, x: 0, y: 0, width: 1, height: 1 }

    expect(scaleIntoBox(layer, from, to)).toMatchObject({
      width: expected,
      height: expected,
    })
    expect(mm(expected)).toBe(expected)
  })

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
  it.each([0.3, 0.1])("사진을 %smm까지 자를 수 있다", (size) => {
    const cut = cropToBox(photo, {
      x: 10,
      y: 10,
      width: size,
      height: size,
    })

    expect(cut).toMatchObject({ width: size, height: size })
  })

  it("최소 크기보다 작은 사진 자르기는 적용하지 않는다", () => {
    expect(
      cropToBox(photo, { x: 10, y: 10, width: 0.05, height: 0.05 })
    ).toEqual({})
  })

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

describe("도형 사진 이동", () => {
  const frame: Layer = {
    ...photo,
    type: "frame",
    imageOffsetMode: "cover",
    width: 20,
    height: 20,
  }

  it("cover 여유 폭으로 델타를 환산하고 여유 없는 축은 유지한다", () => {
    expect(panPhoto(frame, 5, 10)).toEqual({
      imageOffsetX: 0.25,
      imageOffsetY: 0.5,
    })
    expect(
      panPhoto({ ...frame, pixelWidth: 1000, pixelHeight: 2000 }, 10, -5)
    ).toEqual({
      imageOffsetX: 0.5,
      imageOffsetY: 0.75,
    })
  })

  it("확대하면 양 축을 옮길 수 있고 offset을 0~1로 제한한다", () => {
    const enlarged = { ...frame, imageScale: 2 }

    expect(panPhoto(enlarged, 15, -5)).toEqual({
      imageOffsetX: 0.25,
      imageOffsetY: 0.75,
    })
    expect(panPhoto(enlarged, 1000, -1000)).toEqual({
      imageOffsetX: 0,
      imageOffsetY: 1,
    })
    expect(panPhoto(enlarged, -1000, 1000)).toEqual({
      imageOffsetX: 1,
      imageOffsetY: 0,
    })
  })

  it.each([0, 30, 90, -120, 180])(
    "%s도 회전과 반전을 역변환한다",
    (rotation) => {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          const rad = (rotation * Math.PI) / 180
          const localX = 15 * (flipX ? -1 : 1)
          const localY = -5 * (flipY ? -1 : 1)
          const result = panPhoto(
            { ...frame, imageScale: 2, rotation, flipX, flipY },
            localX * Math.cos(rad) - localY * Math.sin(rad),
            localX * Math.sin(rad) + localY * Math.cos(rad)
          )

          expect(result.imageOffsetX).toBeCloseTo(0.25)
          expect(result.imageOffsetY).toBeCloseTo(0.75)
        }
      }
    }
  )

  it("원본 크기가 없는 옛 문서는 상자 비율을 쓰고 현재 offset에서 이동한다", () => {
    const result = panPhoto(
      {
        ...frame,
        pixelWidth: undefined,
        pixelHeight: undefined,
        imageScale: 2,
        imageOffsetX: 0.8,
        imageOffsetY: 0.2,
      },
      4,
      -4
    )

    expect(result.imageOffsetX).toBeCloseTo(0.6)
    expect(result.imageOffsetY).toBeCloseTo(0.4)
    expect(
      panPhoto(
        { ...frame, pixelWidth: undefined, pixelHeight: undefined },
        100,
        100
      )
    ).toEqual({ imageOffsetX: 0.5, imageOffsetY: 0.5 })
  })
})

it("옛 도형 사진의 실제 위치를 유지한 채 cover offset으로 전환한다", () => {
  const legacy: Layer = {
    ...photo,
    type: "frame",
    width: 20,
    height: 20,
    imageScale: 2,
    imageOffsetX: 1,
    imageOffsetY: 0,
  }
  const result = photoEditOffsets(legacy)

  expect(result.imageOffsetMode).toBe("cover")
  expect(result.imageOffsetX).toBeCloseTo(2 / 3)
  expect(result.imageOffsetY).toBe(0)
  expect(photoEditOffsets({ ...legacy, ...result })).toEqual(result)
})

describe("crop이 남은 도형 사진", () => {
  const cropped: Layer = {
    ...photo,
    type: "frame",
    width: 20,
    height: 20,
    crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  }

  it.each([0, 90])(
    "%s도 회전과 반전을 거쳐 crop을 실제 이동한다",
    (rotation) => {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          const rad = (rotation * Math.PI) / 180
          const dx = 5 * (flipX ? -1 : 1)
          const dy = -5 * (flipY ? -1 : 1)
          const result = panPhoto(
            { ...cropped, rotation, flipX, flipY },
            dx * Math.cos(rad) - dy * Math.sin(rad),
            dx * Math.sin(rad) + dy * Math.cos(rad)
          )

          expect(result.crop?.x).toBeCloseTo(0.125)
          expect(result.crop?.y).toBeCloseTo(0.375)
          expect(result.crop?.w).toBe(0.5)
          expect(result.crop?.h).toBe(0.5)
        }
      }
    }
  )

  it("crop 범위 끝에서 제한하고 여유 없는 축은 움직이지 않는다", () => {
    expect(panPhoto(cropped, 1000, -1000).crop).toEqual({
      x: 0,
      y: 0.5,
      w: 0.5,
      h: 0.5,
    })
    expect(panPhoto(cropped, -1000, 1000).crop).toEqual({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 0.5,
    })
    expect(
      panPhoto({ ...cropped, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }, 5, 5).crop
    ).toEqual({ x: 0.125, y: 0, w: 0.5, h: 1 })
  })

  it("확대는 crop 중심을 유지하고 축소는 원본 경계에서 제한한다", () => {
    const zoomed = { ...cropped, ...scalePhoto(cropped, 2) }

    expect(zoomed.crop).toEqual({ x: 0.375, y: 0.375, w: 0.25, h: 0.25 })
    expect(scalePhoto(zoomed, 1).crop).toEqual(cropped.crop)
    expect(
      scalePhoto(
        { ...cropped, imageScale: 3, crop: { x: 0.2, y: 0, w: 0.5, h: 1 } },
        1
      ).crop
    ).toEqual({ x: 0.2, y: 0, w: 0.5, h: 1 })
    expect(zoomed.imageOffsetMode).toBe("cover")
  })
})

it.each(["frame", "rect"] as const)(
  "옛 %s의 확대는 기존 배치에서 offset을 환산한다",
  (type) => {
    const result = scalePhoto(
      {
        ...photo,
        type,
        width: 20,
        imageScale: 2,
        imageOffsetX: 1,
        imageOffsetY: 0,
      },
      3
    )

    expect(result.imageOffsetMode).toBe("cover")
    expect(result.imageScale).toBe(3)
    expect(result.imageOffsetX).toBeCloseTo(2 / 3)
    expect(result.imageOffsetY).toBe(0)
  }
)
