import { describe, expect, it } from "vitest"
import { PRINT_PRODUCTS, PRINT_SPECS, sizeFromOption } from "./catalog"
import {
  imageDpi,
  newDesign,
  parseDesign,
  printIssues,
  reorderLayer,
  resizeDesign,
  resizeLayerFromHandle,
  updateLayer,
} from "./document"

describe("아몬드템플릿", () => {
  it("50개 전환 상품을 모두 유형과 규격에 연결한다", () => {
    expect(Object.keys(PRINT_PRODUCTS)).toHaveLength(50)
    for (const [id, product] of Object.entries(PRINT_PRODUCTS)) {
      const design = newDesign(product.kind, id)
      expect(design.widthMm).toBeGreaterThan(0)
      expect(design.heightMm).toBeGreaterThan(0)
      expect(parseDesign(design)).toEqual(design)
    }
  })

  it("레이어 변경과 순서를 보존하고 위험한 이미지 URL을 거부한다", () => {
    const initial = newDesign("card")
    initial.front = [
      {
        id: "a",
        type: "text",
        name: "상호",
        x: 2,
        y: 2,
        width: 30,
        height: 10,
        fill: "#000000",
        text: "가게",
      },
      {
        id: "b",
        type: "rect",
        name: "배경",
        x: 0,
        y: 0,
        width: 90,
        height: 50,
        fill: "#ffffff",
      },
    ]
    expect(
      updateLayer(initial, "front", "a", { text: "새 가게" }).front[0].text
    ).toBe("새 가게")
    expect(reorderLayer(initial, "front", "a", 1).front[1].id).toBe("a")
    expect(() =>
      parseDesign({
        ...initial,
        front: [
          { ...initial.front[0], image: "https://example.com/track.png" },
        ],
      })
    ).toThrow()
  })

  it("필터 원복용 원본 이미지를 저장하고 잘못된 필터를 거부한다", () => {
    const design = newDesign("card")
    design.front = [
      {
        id: "photo",
        type: "image",
        name: "사진",
        x: 2,
        y: 2,
        width: 30,
        height: 20,
        fill: "#ffffff",
        image: "data:image/png;base64,AA==",
        originalImage: "data:image/png;base64,AA==",
        imageFilter: "sepia",
      },
    ]
    expect(parseDesign(design).front[0].originalImage).toBe(
      design.front[0].originalImage
    )
    expect(() =>
      parseDesign({
        ...design,
        front: [{ ...design.front[0], imageFilter: "unsafe" }],
      })
    ).toThrow()
  })

  it("상품 옵션의 cm·mm 크기를 편집 캔버스에 연결한다", () => {
    expect(sizeFromOption("mini", "15×30cm 거치대 포함")).toEqual([150, 300])
    expect(sizeFromOption("window", "80 x 80 cm")).toEqual([800, 800])
    expect(sizeFromOption("pet", "600×1800mm")).toEqual([600, 1800])
  })

  it("규격 변경 후 레이어가 인쇄 영역 안에 있고 QR 데이터가 검증된다", () => {
    const original = newDesign("pet")
    original.front = [
      {
        id: "q",
        type: "qr",
        name: "QR",
        x: 450,
        y: 1500,
        width: 150,
        height: 300,
        fill: "#000000",
        qrSize: 21,
        qrBits: "0".repeat(441),
      },
    ]
    const resized = resizeDesign(original, 150, 300)
    expect(resized.front[0]).toMatchObject({
      x: 112.5,
      y: 250,
      width: 37.5,
      height: 50,
    })
    expect(parseDesign(resized)).toEqual(resized)
    expect(() =>
      parseDesign({ ...resized, front: [{ ...resized.front[0], qrBits: "1" }] })
    ).toThrow()
  })

  it("공식 칼선 축척과 상품별 해상도로 경고하고 빈 모양틀을 막는다", () => {
    expect(PRINT_SPECS.pet.fileScale).toBe(1)
    expect(PRINT_SPECS.mini.fileScale).toBe(1)
    expect(PRINT_SPECS.window.fileScale).toBe(0.1)
    expect(PRINT_SPECS.mini.safetyMm).toBe(15)
    expect(imageDpi("pet", 1000, 1000, 100, 100)).toBe(254)
    expect(imageDpi("mini", 1000, 1000, 100, 100)).toBe(254)
    expect(imageDpi("window", 1000, 1000, 100, 100)).toBe(2540)
    const design = newDesign("mini")
    design.front = [
      {
        id: "f",
        type: "frame",
        name: "사진",
        x: 20,
        y: 20,
        width: 50,
        height: 50,
        fill: "#ffffff",
      },
    ]
    expect(printIssues(design)).toContain("앞면의 사진: 사진을 넣어 주세요.")
    design.front[0] = {
      ...design.front[0],
      image: "data:image/png;base64,AA==",
      pixelWidth: 500,
      pixelHeight: 500,
    }
    expect(printIssues(design)).toContain(
      "앞면의 사진: 이미지 해상도가 350dpi보다 낮습니다."
    )
  })

  it("서쪽·북쪽 핸들로 크기를 바꿀 때 반대쪽 모서리를 고정한다", () => {
    const layer = {
      id: "a",
      type: "rect" as const,
      name: "도형",
      x: 20,
      y: 20,
      width: 40,
      height: 30,
      fill: "#ffffff",
    }
    expect(resizeLayerFromHandle(layer, "nw", 10, 5, 90, 50)).toEqual({
      x: 30,
      y: 25,
      width: 30,
      height: 25,
    })
    expect(resizeLayerFromHandle(layer, "se", 100, 100, 90, 50)).toEqual({
      x: 20,
      y: 20,
      width: 140,
      height: 100,
    })
  })

  it("오브젝트를 인쇄 영역 밖에 배치해도 저장과 규격 변경을 유지한다", () => {
    const design = newDesign("pet")
    design.front = [
      {
        id: "photo",
        type: "image",
        name: "사진",
        x: -60,
        y: -100,
        width: 400,
        height: 600,
        fill: "#ffffff",
        image: "data:image/png;base64,AA==",
      },
    ]
    expect(parseDesign(design)).toEqual(design)
    const resized = resizeDesign(design, 300, 900)
    expect(resized.front[0]).toMatchObject({
      x: -30,
      y: -50,
      width: 200,
      height: 300,
    })
    expect(parseDesign(resized)).toEqual(resized)
  })

  it("도형과 클립아트를 저장하되 등록되지 않은 그림을 거부한다", () => {
    const design = newDesign("pet")
    design.front = [
      {
        id: "shape",
        type: "rect",
        name: "육각형",
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        fill: "#ffffff",
        shapeVariant: "hexagon",
      },
      {
        id: "cat",
        type: "clipart",
        name: "고양이",
        x: 80,
        y: 10,
        width: 50,
        height: 50,
        fill: "#000000",
        clipartId: "cat",
      },
      {
        id: "frame",
        type: "frame",
        name: "고양이 모양틀",
        x: 140,
        y: 10,
        width: 50,
        height: 50,
        fill: "#eeeeee",
        frameShape: "cat-head",
      },
    ]
    expect(parseDesign(design)).toEqual(design)
    expect(() =>
      parseDesign({
        ...design,
        front: [{ ...design.front[1], clipartId: "unknown" }],
      })
    ).toThrow()
    expect(() =>
      parseDesign({
        ...design,
        front: [{ ...design.front[2], frameShape: "unknown" }],
      })
    ).toThrow()
  })
})
