export const BLEND_MODES = [
  ["normal", "기본"],
  ["multiply", "곱하기"],
  ["screen", "스크린"],
  ["overlay", "오버레이"],
  ["soft-light", "소프트 라이트"],
  ["color-dodge", "발광 닷지"],
  ["color-burn", "색상 번"],
  ["darken", "어둡게"],
  ["lighten", "밝게"],
  ["luminosity", "광도"],
] as const

export type BlendMode = (typeof BLEND_MODES)[number][0]

export const COLOR_FILTERS = [
  ["grayscale", "흑백"],
  ["blur", "블러"],
  ["tone", "톤"],
  ["retro", "레트로"],
  ["overlay", "오버레이"],
  ["color-dodge", "발광 닷지"],
  ["color-burn", "색상 번"],
  ["multiply", "곱하기"],
] as const

export type ColorFilterKind = (typeof COLOR_FILTERS)[number][0]

// amount 는 0~100. color 는 톤·오버레이·발광 닷지·색상 번·곱하기에서 덮는 색이다
export type ColorFilter = {
  kind: ColorFilterKind
  amount: number
  color?: string
}

export const COLORED_FILTERS: ReadonlySet<ColorFilterKind> =
  new Set<ColorFilterKind>([
    "tone",
    "overlay",
    "color-dodge",
    "color-burn",
    "multiply",
  ])

export const DEFAULT_FILTER_COLOR: Record<ColorFilterKind, string> = {
  grayscale: "#000000",
  blur: "#000000",
  tone: "#c08a4a",
  retro: "#000000",
  overlay: "#ff7a3d",
  "color-dodge": "#ffb36b",
  "color-burn": "#6b3d8f",
  multiply: "#4a7bd0",
}

// angle 은 선형일 때 왼쪽→오른쪽을 0° 로 시계 방향. 투명도는 0~1
export type Gradient = {
  type: "linear" | "radial"
  from: string
  to: string
  fromOpacity: number
  toOpacity: number
  angle: number
}

export const DEFAULT_GRADIENT: Gradient = {
  type: "linear",
  from: "#ff7a3d",
  to: "#6b3d8f",
  fromOpacity: 1,
  toOpacity: 1,
  angle: 0,
}

const color = /^#[0-9a-fA-F]{6}$/
const within = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export function validBlendMode(value: unknown) {
  return value === undefined || BLEND_MODES.some(([key]) => key === value)
}

export function validColorFilter(value: unknown) {
  if (value === undefined) return true
  if (!isObject(value)) return false

  return (
    COLOR_FILTERS.some(([key]) => key === value.kind) &&
    within(value.amount, 0, 100) &&
    (value.color === undefined ||
      (typeof value.color === "string" && color.test(value.color)))
  )
}

export function validGradient(value: unknown) {
  if (value === undefined) return true
  if (!isObject(value)) return false

  return (
    (value.type === "linear" || value.type === "radial") &&
    typeof value.from === "string" &&
    color.test(value.from) &&
    typeof value.to === "string" &&
    color.test(value.to) &&
    within(value.fromOpacity, 0, 1) &&
    within(value.toOpacity, 0, 1) &&
    within(value.angle, -360, 360)
  )
}
