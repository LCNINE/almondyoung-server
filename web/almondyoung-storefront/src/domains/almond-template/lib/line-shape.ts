import type { Layer } from "./document"

export type Point = { x: number; y: number }

// 망고보드 끝모양 9종(없음 포함). 시작·끝 모두 같은 목록을 쓰고 방향만 바깥을 향한다
export const LINE_CAPS = [
  "dot",
  "ring",
  "square",
  "diamond",
  "arrow",
  "notched",
  "chevron",
  "bar",
] as const
export type LineCap = (typeof LINE_CAPS)[number]

// 선 스타일 프리셋: 두께 배수 (실선, 6종 중 나머지 5종)
export const LINE_DASHES: ReadonlyArray<[number, number] | null> = [
  null,
  [7, 3],
  [4, 2],
  [3, 1],
  [2, 2],
  [1, 1],
]

type LineLayer = Pick<
  Layer,
  | "x"
  | "y"
  | "width"
  | "height"
  | "rotation"
  | "strokeWidth"
  | "strokeDash"
  | "lineDash"
  | "lineDashCustom"
  | "linePath"
  | "lineCurved"
  | "lineStart"
  | "lineEnd"
  | "lineStartSize"
  | "lineEndSize"
>

export const lineWidth = (layer: Pick<Layer, "strokeWidth">) =>
  Math.max(0.3, layer.strokeWidth ?? 1)

// 회전 전 좌표. linePath 는 상자 안 비율이라 상자를 늘리면 같이 늘어난다
export function lineLocalPoints(layer: LineLayer): Point[] {
  const path = layer.linePath ?? [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
  ]
  return path.map((p) => ({
    x: layer.x + p.x * layer.width,
    y: layer.y + p.y * layer.height,
  }))
}

export function lineWorldPoints(layer: LineLayer): Point[] {
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return lineLocalPoints(layer).map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }))
}

const round = (value: number) => Math.round(value * 1000) / 1000

// 화면 좌표의 점들(시작, [꺾임점], 끝)로 선 상자를 다시 만든다. 시작→끝 방향이 회전, 그 축으로 감싼 사각형이 상자다
export function lineFromPoints(
  points: Point[],
  minHeight: number
): Pick<Layer, "x" | "y" | "width" | "height" | "rotation" | "linePath"> {
  const start = points[0]
  const end = points[points.length - 1]
  const rad = Math.atan2(end.y - start.y, end.x - start.x)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const local = points.map((p) => ({
    u: (p.x - start.x) * cos + (p.y - start.y) * sin,
    v: -(p.x - start.x) * sin + (p.y - start.y) * cos,
  }))
  const u0 = Math.min(...local.map((p) => p.u))
  const u1 = Math.max(...local.map((p) => p.u))
  const vMin = Math.min(...local.map((p) => p.v))
  const vMax = Math.max(...local.map((p) => p.v))
  const width = Math.max(0.1, u1 - u0)
  const height = Math.max(minHeight, vMax - vMin)
  const v0 = (vMin + vMax) / 2 - height / 2
  const mid = { u: u0 + width / 2, v: v0 + height / 2 }
  const cx = start.x + mid.u * cos - mid.v * sin
  const cy = start.y + mid.u * sin + mid.v * cos
  const straight = points.length === 2
  const r2 = (value: number) => Math.round(value * 100) / 100
  return {
    x: r2(cx - width / 2),
    y: r2(cy - height / 2),
    width: r2(width),
    height: r2(height),
    rotation: round((rad * 180) / Math.PI),
    linePath: straight
      ? undefined
      : local.map((p) => ({
          x: round((p.u - u0) / width),
          y: round((p.v - v0) / height),
        })),
  }
}

// 망고보드 규칙: 각진·둥근 끝이 양쪽으로 두께의 반씩 늘어나므로 dash 는 한 두께 줄이고 gap 은 한 두께 늘린다
export function lineDashArray(layer: LineLayer): string | undefined {
  const sw = lineWidth(layer)
  const preset =
    layer.lineDash ??
    (layer.strokeDash === "dashed"
      ? [4, 2]
      : layer.strokeDash === "dotted"
        ? [1, 1]
        : undefined)
  const [dash, gap] = layer.lineDashCustom
    ? layer.lineDashCustom
    : preset
      ? [preset[0] * sw, preset[1] * sw]
      : [0, 0]
  if (!dash && !gap) return undefined
  return `${round(Math.max(0, dash - sw))} ${round(gap + sw)}`
}

type CapDraw = { d: string; filled: boolean; stroked: boolean; cut: number }

// 바깥 방향이 +x, 끝점이 원점인 좌표(두께×크기 단위)로 그린 끝모양
const CAPS: Record<LineCap, (unit: number) => CapDraw> = {
  arrow: () => ({
    d: "M0,0 L-3.04,-1.67 L-3.04,1.67 z",
    filled: true,
    stroked: false,
    cut: 2.4,
  }),
  notched: () => ({
    d: "M0,0 L-3.6,-1.8 L-2.6,0 L-3.6,1.8 z",
    filled: true,
    stroked: false,
    cut: 2.4,
  }),
  chevron: () => ({
    d: "M-2.4,-1.8 L0,0 L-2.4,1.8",
    filled: false,
    stroked: true,
    cut: 0.5,
  }),
  dot: () => ({
    d: "M1.6,0 A1.6,1.6 0 1 0 -1.6,0 A1.6,1.6 0 1 0 1.6,0 z",
    filled: true,
    stroked: false,
    cut: 0,
  }),
  ring: () => ({
    d: "M1.6,0 A1.6,1.6 0 1 0 -1.6,0 A1.6,1.6 0 1 0 1.6,0 z",
    filled: false,
    stroked: true,
    cut: 1.6,
  }),
  square: () => ({
    d: "M-1.5,-1.5 L1.5,-1.5 L1.5,1.5 L-1.5,1.5 z",
    filled: true,
    stroked: false,
    cut: 0,
  }),
  diamond: () => ({
    d: "M2,0 L0,-2 L-2,0 L0,2 z",
    filled: true,
    stroked: false,
    cut: 0,
  }),
  bar: () => ({
    d: "M0,-2.5 L0,2.5",
    filled: false,
    stroked: true,
    cut: 0,
  }),
}

// 단위 좌표 path 를 끝점·방향·크기로 옮긴다. 원호는 반지름만 곱한다
function placeCap(d: string, at: Point, dir: Point, unit: number) {
  const toWorld = (x: number, y: number) =>
    `${round(at.x + (x * dir.x - y * dir.y) * unit)},${round(at.y + (x * dir.y + y * dir.x) * unit)}`
  return d
    .replace(
      /A([\d.]+),([\d.]+) 0 1 0 (-?[\d.]+),(-?[\d.]+)/g,
      (_, rx, ry, x, y) =>
        `A${round(rx * unit)},${round(ry * unit)} 0 1 0 ${toWorld(Number(x), Number(y))}`
    )
    .replace(
      /([ML])(-?[\d.]+),(-?[\d.]+)/g,
      (_, cmd, x, y) => `${cmd}${toWorld(Number(x), Number(y))}`
    )
}

const unitVector = (from: Point, to: Point): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

export type LineGeometry = {
  d: string
  caps: { d: string; filled: boolean; stroked: boolean }[]
}

// 회전 전 좌표로 본선과 끝모양을 만든다. 채운 촉은 본선을 촉 안쪽에서 끊어 선 끝이 삐져나오지 않게 한다
export function lineGeometry(layer: LineLayer): LineGeometry {
  const sw = lineWidth(layer)
  const points = lineLocalPoints(layer)
  const ends = [
    {
      cap: layer.lineStart,
      size: layer.lineStartSize ?? 1,
      at: points[0],
      dir: unitVector(points[1], points[0]),
    },
    {
      cap: layer.lineEnd,
      size: layer.lineEndSize ?? 1,
      at: points[points.length - 1],
      dir: unitVector(points[points.length - 2], points[points.length - 1]),
    },
  ]
  const caps: LineGeometry["caps"] = []
  const trimmed = points.map((p) => ({ ...p }))
  ends.forEach(({ cap, size, at, dir }, index) => {
    if (!cap) return
    const unit = sw * size
    const shape = CAPS[cap](unit)
    caps.push({
      d: placeCap(shape.d, at, dir, unit),
      filled: shape.filled,
      stroked: shape.stroked,
    })
    const target = index === 0 ? trimmed[0] : trimmed[trimmed.length - 1]
    target.x = at.x - dir.x * shape.cut * unit
    target.y = at.y - dir.y * shape.cut * unit
  })
  const [first, ...rest] = trimmed.map((p) => `${round(p.x)},${round(p.y)}`)
  const d =
    rest.length === 2 && layer.lineCurved
      ? `M${first} Q${rest[0]} ${rest[1]}`
      : `M${first} ${rest.map((p) => `L${p}`).join(" ")}`
  return { d, caps }
}
