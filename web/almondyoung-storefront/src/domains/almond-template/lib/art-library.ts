import legacyClipart from "../assets/legacy-clipart.json"
import frameLibrary from "../assets/frame-library.json"
export { CLIPART, CLIPART_ITEMS } from "./clipart-library"
import { CLIPART_ITEMS } from "./clipart-library"
import { DRAW_ART } from "./draw-art"

// Designs saved with the earlier icon library still load.
export const LEGACY_CLIPART: Record<string, string> = legacyClipart

export const CLIPART_IDS: ReadonlySet<string> = new Set([
  ...CLIPART_ITEMS.map(([id]) => id),
  ...Object.keys(LEGACY_CLIPART),
])

export const FRAME_LIBRARY: Record<string, string[][]> = frameLibrary
export const FRAME_PATHS: Record<string, string> = Object.fromEntries(
  Object.values(FRAME_LIBRARY)
    .flat()
    .map(([id, , path]) => [id, path])
)
export const FRAME_IDS: ReadonlySet<string> = new Set([
  "rect",
  "ellipse",
  "star",
  "heart",
  ...Object.keys(FRAME_PATHS),
])

const BASIC_SHAPES = {
  기본도형: [
    ["line", "선", "line"],
    ["rect", "사각형", "rect"],
    ["ellipse", "원형", "ellipse"],
    ["triangle", "삼각형", "triangle"],
    ["hexagon", "육각형", "rect"],
    ["rounded", "둥근 사각형", "rect"],
    ["pentagon", "오각형", "rect"],
    ["octagon", "팔각형", "rect"],
    ["star", "별", "star"],
    ["rounded-pentagon", "둥근 오각형", "rect"],
    ["diamond", "마름모", "rect"],
    ["trapezoid", "사다리꼴", "rect"],
    ["parallelogram", "평행사변형", "rect"],
    ["arrow", "오른쪽 화살표", "rect"],
    ["arrow-left", "왼쪽 화살표", "rect"],
    ["arrow-up", "위쪽 화살표", "rect"],
    ["arrow-down", "아래쪽 화살표", "rect"],
    ["chevron", "갈매기", "rect"],
    ["cross", "십자", "rect"],
    ["speech", "말풍선", "rect"],
    ["shield", "방패", "rect"],
    ["heptagon", "칠각형", "rect"],
    ["decagon", "십각형", "rect"],
    ["burst", "햇살", "rect"],
  ],
  기본: [
    ["heart", "하트", "heart"],
    ["tag", "태그", "rect"],
    ["bookmark", "책갈피", "rect"],
    ["flag", "깃발", "rect"],
  ],
} as const

const basicIds = new Set(
  Object.values(BASIC_SHAPES)
    .flat()
    .map(([id]) => id as string)
)

// 모양틀 윤곽을 색을 채우는 도형으로도 쓴다. 기본 도형과 겹치는 모양은 뺀다
export const SHAPES: Record<
  string,
  ReadonlyArray<readonly [string, string, string]>
> = {
  ...BASIC_SHAPES,
  ...Object.fromEntries(
    Object.entries(FRAME_LIBRARY).map(([category, items]) => [
      category.replace("모양틀", "") === "기본"
        ? "모양틀"
        : `모양틀 · ${category.replace("모양틀", "")}`,
      items
        .filter(([id]) => !basicIds.has(id))
        .map(([id, label]) => [id, label, "rect"] as const),
    ])
  ),
}

export const SHAPE_VARIANTS: ReadonlySet<string> = new Set([
  ...Object.values(SHAPES)
    .flat()
    .filter(([id, , type]) => id !== type)
    .map(([id]) => id),
  ...Object.keys(DRAW_ART),
])
