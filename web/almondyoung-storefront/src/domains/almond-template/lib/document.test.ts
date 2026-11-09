import { describe, expect, it } from "vitest"
import { PRINT_PRODUCTS, PRINT_SPECS, sizeFromOption } from "./catalog"
import { makeLayer } from "./layer"
import { CLIPART_IDS } from "./art-library"
import {
  hasProduct,
  imageDpi,
  newDesign,
  parseDesign,
  printIssues,
  printWarnings,
  printsBack,
  reorderLayer,
  resizeDesign,
  resizeLayerFromHandle,
  sideBackground,
  updateLayer,
  unfiltered,
  withProduct,
  withSideBackground,
  withBackgroundImage,
  type Design,
} from "./document"

const CARD_PRODUCT = "6c2b7437-7c72-4685-a72c-0cd18f9d7bfb"

describe("질감 설정 저장", () => {
  const design = newDesign("card")
  const layer = { ...makeLayer("rect", design), texture: true }

  it("새 필드가 없는 옛 문서를 그대로 읽는다", () => {
    const legacy = { ...design, front: [layer] }

    expect(parseDesign(legacy)).toEqual(legacy)
  })

  it.each(["grain", "paper"])(
    "%s 종류와 강도를 양면에 저장한다",
    (textureKind) => {
      for (const textureAmount of [1, 40, 100]) {
        const textured = { ...layer, textureKind, textureAmount }
        const saved = { ...design, front: [textured], back: [textured] }

        expect(parseDesign(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
      }
    }
  )

  it.each([
    { textureKind: "noise" },
    { textureKind: null },
    { textureKind: 1 },
    ...[0, -1, 101, NaN, Infinity, "40", null].map((textureAmount) => ({
      textureAmount,
    })),
  ])("잘못된 질감 설정 %j는 꺼져 있어도 거부한다", (patch) => {
    for (const side of ["front", "back"]) {
      expect(() =>
        parseDesign({
          ...design,
          [side]: [{ ...layer, texture: false, ...patch }],
        })
      ).toThrow()
    }
  })
})

describe("작업 상품 지정", () => {
  it("상품을 고르지 않은 새 시안은 저장 대상 상품이 없다", () => {
    expect(hasProduct(newDesign("pet"))).toBe(false)
    expect(hasProduct(newDesign("card", "not-a-uuid"))).toBe(false)
    expect(hasProduct(newDesign("card", CARD_PRODUCT))).toBe(true)
  })

  it("같은 유형의 상품을 고르면 레이어와 크기를 그대로 둔다", () => {
    const design = newDesign("card")
    design.title = "내 시안"
    design.front = [makeLayer("text", design)]

    const next = withProduct(design, CARD_PRODUCT)

    expect(next.productId).toBe(CARD_PRODUCT)
    expect(next.title).toBe("내 시안")
    expect(next.front).toEqual(design.front)
    expect(next.widthMm).toBe(design.widthMm)
  })

  it("유형이 다른 상품을 고르면 레이어를 지우지 않고 그 유형의 규격에 맞춘다", () => {
    const design = newDesign("pet")
    design.front = [makeLayer("text", design)]

    const next = withProduct(design, CARD_PRODUCT, "card")
    const [widthMm, heightMm] = PRINT_SPECS.card.sizes[0]

    expect(next.kind).toBe("card")
    expect([next.widthMm, next.heightMm]).toEqual([widthMm, heightMm])
    expect(next.front).toHaveLength(1)
    expect(next.front[0].id).toBe(design.front[0].id)
    expect(next.front[0].width).toBeLessThan(design.front[0].width)
  })
})

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

  it("화면용 축소본 목록은 file: 참조 쌍만 남긴다", () => {
    const original = "file:01a143cf-1e12-713c-9f50-431542f3fd0c"
    const preview = "file:01a143ce-fa94-7348-ad63-85721f2dd5d0"
    const design = {
      ...newDesign("card"),
      imagePreviews: {
        [original]: preview,
        "data:image/png;base64,AA==": preview,
        [preview]: "https://example.com/track.png",
      },
    }
    expect(parseDesign(design).imagePreviews).toEqual({ [original]: preview })
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
    expect(printWarnings(design).join("\n")).toContain(
      "권장 350dpi보다 낮아 흐리게 인쇄될 수 있습니다."
    )
  })

  it.each([
    [0.3, 0.3],
    [0.05, 0.1],
  ])("모든 손잡이에서 %smm 축소를 %smm로 제한한다", (size, expected) => {
    const layer = {
      ...makeLayer("rect", newDesign("card")),
      x: 10,
      y: 10,
      width: 1,
      height: 1,
    }

    for (const keepRatio of [false, true]) {
      for (const handle of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
        const dx = handle.includes("w") ? 1 - size : size - 1
        const dy = handle.includes("n") ? 1 - size : size - 1
        const resized = resizeLayerFromHandle(
          layer,
          handle,
          dx,
          dy,
          90,
          50,
          keepRatio
        )

        expect(resized.width).toBe(
          keepRatio || handle.includes("e") || handle.includes("w")
            ? expected
            : 1
        )
        expect(resized.height).toBe(
          keepRatio || handle.includes("n") || handle.includes("s")
            ? expected
            : 1
        )

        if (handle.includes("w")) {
          expect(resized.x! + resized.width!).toBeCloseTo(11)
        }

        if (handle.includes("n")) {
          expect(resized.y! + resized.height!).toBeCloseTo(11)
        }
      }
    }
  })

  it.each(["e", "w", "n", "s"])(
    "기존 작은 레이어의 %s 손잡이를 움직여도 양 축이 저장 가능한 크기다",
    (handle) => {
      const design = newDesign("card")
      const layer = {
        ...makeLayer("rect", design),
        x: 10,
        y: 10,
        width: 0.01,
        height: 0.01,
      }
      const loaded = parseDesign({ ...design, front: [layer] })

      expect(loaded.front[0]).toMatchObject({ width: 0.01, height: 0.01 })

      const resized = resizeLayerFromHandle(
        loaded.front[0],
        handle,
        handle === "w" ? -1 : handle === "e" ? 1 : 0,
        handle === "n" ? -1 : handle === "s" ? 1 : 0,
        design.widthMm,
        design.heightMm
      )
      const next = { ...loaded, front: [{ ...layer, ...resized }] }
      const horizontal = handle === "e" || handle === "w"

      expect(resized).toMatchObject({
        width: horizontal ? 1 : 0.1,
        height: horizontal ? 0.1 : 1,
      })
      expect(parseDesign(next)).toEqual(next)
    }
  )

  it("규격 축소 시 작은 레이어가 0mm가 되지 않고 저장된다", () => {
    const design = newDesign("pet")
    const layer = { ...makeLayer("rect", design), width: 0.1, height: 0.1 }
    design.front = [layer]
    design.back = [{ ...layer, id: "back" }]

    const resized = resizeDesign(design, 150, 300)

    expect(resized.front[0]).toMatchObject({ width: 0.1, height: 0.1 })
    expect(resized.back[0]).toMatchObject({ width: 0.1, height: 0.1 })
    expect(parseDesign(resized)).toEqual(resized)
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

  it("Shift 로 크기를 바꾸면 비율을 지키고 반대쪽을 고정한다", () => {
    const layer = {
      id: "a",
      type: "rect" as const,
      name: "도형",
      x: 20,
      y: 20,
      width: 40,
      height: 20,
      fill: "#ffffff",
    }
    expect(resizeLayerFromHandle(layer, "se", 40, 2, 90, 50, true)).toEqual({
      x: 20,
      y: 20,
      width: 80,
      height: 40,
    })
    expect(resizeLayerFromHandle(layer, "nw", -20, 0, 90, 50, true)).toEqual({
      x: 0,
      y: 10,
      width: 60,
      height: 30,
    })
    expect(resizeLayerFromHandle(layer, "e", 20, 0, 90, 50, true)).toEqual({
      x: 20,
      y: 15,
      width: 60,
      height: 30,
    })
  })

  it("도형만 채우기 없음을 허용한다", () => {
    const design = newDesign("pet")
    const shape = {
      id: "s",
      type: "ellipse" as const,
      name: "원",
      x: 5,
      y: 5,
      width: 10,
      height: 10,
      fill: "none",
    }
    design.front = [shape]
    expect(parseDesign(design).front[0].fill).toBe("none")
    design.front = [{ ...shape, type: "text", text: "가" }]
    expect(() => parseDesign(design)).toThrow()
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

  it("뒷면 배경을 앞면과 따로 저장하고, 없던 옛 시안은 앞면 배경을 따른다", () => {
    const legacy = { ...newDesign("card"), background: "#112233" }
    delete legacy.backBackground
    expect(sideBackground(legacy, "back").background).toBe("#112233")

    const design = withSideBackground(legacy, "back", { background: "#fff799" })
    expect(sideBackground(design, "front").background).toBe("#112233")
    expect(sideBackground(design, "back").background).toBe("#fff799")
    expect(parseDesign(design)).toEqual(design)
    expect(() =>
      parseDesign({ ...design, backBackground: { background: "red" } })
    ).toThrow()
  })

  it("앞면 배경을 색만으로 바꾸면 배경 이미지가 지워진다", () => {
    const withImage = withSideBackground(newDesign("card"), "front", {
      background: "#ffffff",
      backgroundImage: "file:00000000-0000-4000-8000-000000000000",
      backgroundPixelWidth: 100,
      backgroundPixelHeight: 100,
    })
    const cleared = withSideBackground(withImage, "front", {
      background: "#112233",
    })
    expect(sideBackground(cleared, "front")).toEqual({ background: "#112233" })
  })

  it("배경만 칠한 뒷면도 인쇄하고, 흰 빈 뒷면은 단면으로 본다", () => {
    const blank = newDesign("card")
    expect(printsBack(blank)).toBe(false)
    expect(
      printsBack(withSideBackground(blank, "back", { background: "#112233" }))
    ).toBe(true)
    const withImage = withSideBackground(blank, "back", {
      background: "#ffffff",
      backgroundImage: "file:00000000-0000-4000-8000-000000000000",
      backgroundPixelWidth: 100,
      backgroundPixelHeight: 100,
    })
    expect(printsBack(withImage)).toBe(true)
    expect(printWarnings(withImage).join("\n")).toContain(
      "뒷면 배경 이미지: 해상도"
    )
  })
  it("잘못된 레이어를 레이어 목록 기준 위치와 이름으로 짚는다", () => {
    const design = newDesign("card")
    const layer = {
      id: "a",
      type: "text" as const,
      name: "점선",
      x: 0,
      y: 0,
      width: 10,
      height: 5,
      fill: "#000000",
      text: "---",
    }
    design.front = [
      { ...layer, width: 9999 },
      { ...layer, id: "b", name: "제목" },
    ]
    expect(() => parseDesign(design)).toThrow(
      '앞면 레이어 목록 위에서 2번째 "점선" 레이어의 크기·위치가 허용 범위를 벗어났습니다. (가로 9999mm, 세로 5mm)'
    )
    design.front = [{ ...layer, fill: "red" }]
    expect(() => parseDesign(design)).toThrow(
      '앞면 레이어 목록 위에서 1번째 "점선" 레이어의 데이터가 올바르지 않습니다.'
    )
  })
})

describe("색 입히기", () => {
  it("이미지·클립아트의 imageTint 는 #rrggbb 만 받는다", () => {
    const design = newDesign("card")
    design.front = [
      {
        ...makeLayer("rect", design),
        type: "clipart",
        clipartId: Array.from(CLIPART_IDS)[0],
        imageTint: "#ff6600",
      },
    ]
    expect(parseDesign(design).front[0].imageTint).toBe("#ff6600")
    expect(() =>
      parseDesign({
        ...design,
        front: [{ ...design.front[0], imageTint: "red" }],
      })
    ).toThrow()
  })
})

describe("독립 블러", () => {
  it.each([0, 50, 100])(
    "옛 블러 강도 %s를 양면 레이어와 배경에서 옮긴다",
    (amount) => {
      const base = newDesign("card")
      const layer = makeLayer("rect", base)
      const legacy = {
        ...base,
        backgroundFilter: { kind: "blur", amount },
        backBackground: {
          background: "#112233",
          backgroundFilter: { kind: "blur", amount },
        },
        front: [{ ...layer, colorFilter: { kind: "blur", amount } }],
        back: [{ ...layer, colorFilter: { kind: "blur", amount } }],
      }
      const loaded = parseDesign(legacy)

      for (const side of ["front", "back"] as const) {
        expect(loaded[side][0].blur).toBe(amount)
        expect(loaded[side][0].colorFilter).toBeUndefined()
        expect(sideBackground(loaded, side).backgroundBlur).toBe(amount)
        expect(sideBackground(loaded, side).backgroundFilter).toBeUndefined()
      }

      expect(legacy.front[0].colorFilter.kind).toBe("blur")
      expect(parseDesign(loaded)).toEqual(loaded)
    }
  )

  it.each([0, 35, 100])("블러 %s와 색 필터를 함께 저장한다", (blur) => {
    const base = newDesign("card")
    const colorFilter = { kind: "grayscale" as const, amount: 70 }
    const layer = { ...makeLayer("rect", base), colorFilter, blur }
    const design = {
      ...base,
      backgroundFilter: colorFilter,
      backgroundBlur: blur,
      backBackground: {
        background: "#ffffff",
        backgroundFilter: colorFilter,
        backgroundBlur: blur,
      },
      front: [layer],
      back: [layer],
    }

    expect(parseDesign(JSON.parse(JSON.stringify(design)))).toEqual(design)
  })

  it.each([-1, 101, NaN, Infinity, "50", null])(
    "잘못된 블러 %s를 거절한다",
    (blur) => {
      const base = newDesign("card")
      const layer = makeLayer("rect", base)

      for (const side of ["front", "back"] as const) {
        expect(() =>
          parseDesign({ ...base, [side]: [{ ...layer, blur }] })
        ).toThrow()
      }

      expect(() => parseDesign({ ...base, backgroundBlur: blur })).toThrow()
      expect(() =>
        parseDesign({
          ...base,
          backBackground: { background: "#ffffff", backgroundBlur: blur },
        })
      ).toThrow()
      expect(() =>
        parseDesign({
          ...base,
          front: [{ ...layer, colorFilter: { kind: "blur", amount: blur } }],
        })
      ).toThrow()
      expect(() =>
        parseDesign({
          ...base,
          backgroundFilter: { kind: "blur", amount: blur },
        })
      ).toThrow()
    }
  )

  it("면별 복사와 배경 초기화 및 필터 무효화에 블러를 포함한다", () => {
    const design = {
      ...newDesign("card"),
      backgroundFilter: { kind: "grayscale" as const, amount: 60 },
      backgroundBlur: 40,
      backBackground: undefined,
    }
    const front = sideBackground(design, "front")
    const back = withSideBackground(design, "back", {
      ...front,
      backgroundBlur: 80,
    })

    expect(sideBackground(design, "back").backgroundBlur).toBe(40)
    expect(sideBackground(back, "front").backgroundBlur).toBe(40)
    expect(sideBackground(back, "back").backgroundBlur).toBe(80)
    expect(unfiltered(front).backgroundFilter).toBeUndefined()
    expect(unfiltered(front).backgroundBlur).toBeUndefined()
    expect(
      withSideBackground(design, "front", { background: "#ffffff" })
        .backgroundBlur
    ).toBeUndefined()
  })
})

describe("사진 위치 모드 저장", () => {
  const design = newDesign("card")
  const frame = makeLayer("frame", design)

  it.each([undefined, "cover"])(
    "%s 모드는 기존 문서와 함께 읽는다",
    (imageOffsetMode) => {
      const loaded = parseDesign({
        ...design,
        front: [{ ...frame, imageOffsetMode }],
      })

      expect(loaded.front[0].imageOffsetMode).toBe(imageOffsetMode)
    }
  )

  it.each([null, "invalid", 1, true])(
    "잘못된 모드 %s는 거부한다",
    (imageOffsetMode) => {
      expect(() =>
        parseDesign({ ...design, front: [{ ...frame, imageOffsetMode }] })
      ).toThrow()
    }
  )
})

describe("withBackgroundImage", () => {
  const filtered = {
    ...newDesign("card"),
    background: "#ffeecc",
    backgroundImage: "file:old",
    backgroundPixelWidth: 100,
    backgroundPixelHeight: 50,
    backgroundFilter: { kind: "grayscale", amount: 80 },
    backgroundBlur: 30,
  } as Design

  it("사진을 바꿔도 흑백·블러 효과와 바탕색은 그대로 둔다", () => {
    const next = withBackgroundImage(filtered, "front", {
      src: "data:image/png;base64,AA",
      pixelWidth: 300,
      pixelHeight: 200,
    })

    expect(next.backgroundImage).toBe("data:image/png;base64,AA")
    expect(next.backgroundPixelWidth).toBe(300)
    expect(next.backgroundFilter).toEqual(filtered.backgroundFilter)
    expect(next.backgroundBlur).toBe(30)
    expect(next.background).toBe("#ffeecc")
  })

  it("사진을 지운 뒤 새로 올려도 효과가 이어진다", () => {
    const removed = withBackgroundImage(filtered, "front")
    expect(removed.backgroundImage).toBeUndefined()

    const next = withBackgroundImage(removed, "front", {
      src: "file:new",
      pixelWidth: 10,
      pixelHeight: 10,
    })
    expect(next.backgroundFilter).toEqual(filtered.backgroundFilter)
    expect(next.backgroundBlur).toBe(30)
  })

  it("뒷면 배경도 같은 규칙을 따른다", () => {
    const design = {
      ...filtered,
      backBackground: { background: "#000000", backgroundBlur: 40 },
    } as Design

    const next = withBackgroundImage(design, "back", {
      src: "file:back",
      pixelWidth: 10,
      pixelHeight: 10,
    })
    expect(next.backBackground).toEqual({
      background: "#000000",
      backgroundBlur: 40,
      backgroundImage: "file:back",
      backgroundPixelWidth: 10,
      backgroundPixelHeight: 10,
    })
    expect(next.backgroundImage).toBe("file:old")
  })
})
