import { beforeEach, describe, expect, it, vi } from "vitest"
import { effectPadding } from "../components/graphic"
import { layerBounds } from "./canvas-math"
import { PRINT_SPECS, type PrintKind } from "./catalog"
import {
  MAX_IMAGE_FILE_BYTES,
  layerImageDpi,
  newDesign,
  type Layer,
} from "./document"
import { rasterize } from "./design-images"
import { rememberPreview } from "./image-previews"
import {
  mergeBounds,
  mergeDownReason,
  groupMergedLayers,
  isVectorMerge,
  mergeMaxPx,
  rasterMergedLayer,
  replaceMergedLayers,
} from "./merge-layers"

vi.mock("./design-images", () => ({ rasterize: vi.fn() }))
vi.mock("./image-previews", async (original) => ({
  ...(await original<typeof import("./image-previews")>()),
  rememberPreview: vi.fn().mockResolvedValue(undefined),
}))

const layer = (id: string, patch: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  type: "rect",
  x: 0,
  y: 0,
  width: 20,
  height: 10,
  fill: "#ff0000",
  ...patch,
})

beforeEach(() => vi.clearAllMocks())

describe("아래 레이어와 병합", () => {
  it.each([
    [{ type: "text" }, {}, "텍스트"],
    [{}, { type: "text" }, "텍스트"],
    [{ visible: false }, {}, "숨긴"],
    [{}, { visible: false }, "숨긴"],
    [{ locked: true }, {}, "잠금"],
    [{}, { locked: true }, "잠금"],
    [{ type: "rect", text: "OPEN" }, {}, "텍스트"],
    [{}, { blendMode: "multiply" }, "혼합 모드"],
    [{ type: "rect", blur: 50 }, {}, "필터"],
    [{}, { shadow: true, shadowMultiply: true }, "필터"],
    [{}, { knockout: true }, "뚫기"],
  ] as [Partial<Layer>, Partial<Layer>, string][])(
    "양쪽 레이어의 제한을 확인한다",
    (lower, upper, reason) => {
      expect(
        mergeDownReason([layer("a", lower), layer("b", upper)], "b", "designer")
      ).toContain(reason)
    }
  )

  it("맨 아래와 없는 레이어, 고객 편집 제한을 확인한다", () => {
    const layers = [layer("a", { editable: false }), layer("b")]

    expect(mergeDownReason(layers, "a", "designer")).toContain(
      "아래 레이어가 없습니다"
    )
    expect(mergeDownReason(layers, "missing", "designer")).toBeTruthy()
    expect(mergeDownReason(layers, "b", "customer")).toContain("편집할 수 없는")
    expect(mergeDownReason(layers, "b", "designer")).toBe("")
  })

  it("바로 아래 자리에서 두 레이어만 교체한다", () => {
    const layers = [layer("a"), layer("b"), layer("c"), layer("d")]
    const merged = layer("merged")

    expect(replaceMergedLayers(layers, "c", merged)).toEqual([
      layers[0],
      merged,
      layers[3],
    ])
    expect(layers).toHaveLength(4)
    expect(() => replaceMergedLayers(layers, "a", merged)).toThrow()
  })

  it("회전한 상자의 합집합을 사용한다", () => {
    expect(
      mergeBounds([layer("a"), layer("b", { x: 30, rotation: 90 })])
    ).toEqual({
      x: 0,
      y: -5,
      width: 45,
      height: 20,
    })
  })

  it("회전과 반전에도 그림자·글로우 필터 영역과 테두리를 포함한다", () => {
    const decorated = layer("a", {
      rotation: 45,
      flipX: true,
      shadow: true,
      shadowX: -12,
      shadowY: 20,
      shadowBlur: 4,
      glow: true,
      glowSize: 8,
      glowSpread: 50,
      stroke: "#000000",
      strokeWidth: 6,
    })
    const pad = effectPadding(decorated) + 12
    const expected = layerBounds({
      ...decorated,
      x: -pad,
      y: -pad,
      width: decorated.width + pad * 2,
      height: decorated.height + pad * 2,
    })
    const box = mergeBounds([decorated])

    expect(box.x).toBeCloseTo(expected.x0)
    expect(box.y).toBeCloseTo(expected.y0)
    expect(box.width).toBeCloseTo(expected.x1 - expected.x0)
    expect(box.height).toBeCloseTo(expected.y1 - expected.y0)
    expect(
      mergeBounds([layer("stroke", { stroke: "#000000", strokeWidth: 6 })]).x
    ).toBeLessThanOrEqual(-12)
  })

  it("선 끝모양·바깥 곡선 핸들·가장자리 흐림을 자르지 않는다", () => {
    const line = layer("line", {
      type: "line",
      lineStart: "arrow",
      lineStartSize: 3,
      strokeWidth: 2,
    })
    const path = layer("path", {
      type: "path",
      pathPoints: [
        { x: 0, y: 0, ox: 2, oy: -2 },
        { x: 1, y: 1 },
      ],
    })

    expect(mergeBounds([line]).x).toBeLessThan(-24)
    expect(mergeBounds([path]).y).toBeLessThanOrEqual(-20)
    expect(
      mergeBounds([layer("blur", { edgeBlur: 100 })]).width
    ).toBeGreaterThan(20)
  })

  it.each(Object.keys(PRINT_SPECS) as PrintKind[])(
    "%s의 파일 축척과 최소 DPI를 충족한다",
    (kind) => {
      const box = { width: 53.7, height: 0.1 }
      const maxPx = mergeMaxPx(kind, box)
      const image = layer("merged", {
        ...box,
        type: "image",
        image: "data:image/png;base64,AA==",
        pixelWidth: Math.ceil(maxPx),
        pixelHeight: Math.ceil((maxPx * box.height) / box.width),
      })

      expect(layerImageDpi(kind, image)).toBeGreaterThanOrEqual(
        PRINT_SPECS[kind].minImageDpi
      )
    }
  )

  it("큰 상품은 긴 변과 총 픽셀 수를 제한한다", () => {
    for (const box of [
      { width: 3000, height: 3000 },
      { width: 3000, height: 1 },
    ]) {
      const maxPx = mergeMaxPx("pet", box)
      const height = Math.ceil((maxPx * box.height) / box.width)

      expect(maxPx).toBeLessThanOrEqual(8192)
      expect(maxPx * height).toBeLessThanOrEqual(16_000_000)
    }
  })

  it.each([true, false])(
    "원본 SVG 순서와 이미지 저장 경로를 사용하고 공통 그룹만 남긴다 (%s)",
    async (sameGroup) => {
      const canvas = {
        width: 500,
        height: 250,
        toDataURL: vi.fn().mockReturnValue("data:image/png;base64,AA=="),
      } as unknown as HTMLCanvasElement
      vi.mocked(rasterize).mockResolvedValue(canvas)
      const lower = layer("lower", {
        groupId: "g",
        groupName: "패턴",
        rotation: 10,
        opacity: 0.5,
      })
      const upper = layer("upper", {
        fill: "#0000ff",
        groupId: sameGroup ? "g" : "other",
        shadow: true,
      })
      const result = await rasterMergedLayer(newDesign("card"), lower, upper)
      const [markup, previews, , options] = vi.mocked(rasterize).mock.calls[0]

      expect(markup.indexOf('fill="#ff0000"')).toBeLessThan(
        markup.indexOf('fill="#0000ff"')
      )
      expect(markup).not.toContain('fill="#ffffff"')
      expect(previews).toEqual({})
      expect(options).toEqual({ originals: true })
      expect(canvas.toDataURL).toHaveBeenCalledWith("image/png")
      expect(rememberPreview).toHaveBeenCalledWith(result.image, canvas)
      expect(result).toMatchObject({
        type: "image",
        name: "lower",
        locked: false,
        pixelWidth: 500,
        pixelHeight: 250,
        opacity: 1,
      })
      expect(result.groupId).toBe(sameGroup ? "g" : undefined)
      expect(result.groupName).toBe(sameGroup ? "패턴" : undefined)
      expect(result.rotation).toBeUndefined()
      expect(result.shadow).toBeUndefined()
      expect(result.id).not.toBe(lower.id)
    }
  )

  it("래스터화가 실패하면 결과를 만들지 않는다", async () => {
    vi.mocked(rasterize).mockRejectedValue(new Error("image failed"))

    await expect(
      rasterMergedLayer(newDesign("card"), layer("a"), layer("b"))
    ).rejects.toThrow("image failed")
    expect(rememberPreview).not.toHaveBeenCalled()
  })
})

it("저장 용량을 넘는 결과는 원본을 대체하지 않는다", async () => {
  vi.mocked(rasterize).mockResolvedValue({
    toDataURL: () =>
      "data:image/png;base64," +
      "A".repeat(Math.ceil((MAX_IMAGE_FILE_BYTES * 4) / 3)),
  } as HTMLCanvasElement)

  await expect(
    rasterMergedLayer(newDesign("card"), layer("a"), layer("b"))
  ).rejects.toThrow("4MB")
  expect(rememberPreview).not.toHaveBeenCalled()
})

describe("도형끼리 병합", () => {
  it("사진이 섞이지 않았을 때만 그룹으로 묶는다", () => {
    expect(isVectorMerge(layer("a"), layer("b", { type: "path" }))).toBe(true)
    expect(isVectorMerge(layer("a"), layer("b", { type: "image" }))).toBe(false)
    expect(isVectorMerge(layer("a", { image: "data:x" }), layer("b"))).toBe(
      false
    )
  })

  it("아래 레이어의 그룹을 이어 쓰고 레이어는 그대로 둔다", () => {
    const layers = [
      layer("a", { groupId: "g", groupName: "패턴" }),
      layer("b", { groupId: "g", groupName: "패턴" }),
      layer("c", { groupId: "other", groupName: "다른" }),
      layer("d"),
    ]
    const result = groupMergedLayers(layers, "c")

    expect(
      result.map((item) => [item.id, item.groupId, item.groupName])
    ).toEqual([
      ["a", "g", "패턴"],
      ["b", "g", "패턴"],
      ["c", "g", "패턴"],
      ["d", undefined, undefined],
    ])
  })

  it("둘 다 그룹이 없으면 새 그룹을 만든다", () => {
    const [a, b] = groupMergedLayers([layer("a"), layer("b")], "b")

    expect(a.groupId).toBeTruthy()
    expect(b.groupId).toBe(a.groupId)
    expect(a.groupName).toBe("그룹 1")
    expect(() => groupMergedLayers([layer("a")], "a")).toThrow()
  })
})
