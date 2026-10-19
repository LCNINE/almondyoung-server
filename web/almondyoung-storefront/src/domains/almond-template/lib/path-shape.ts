import type { Layer } from "./document"

// 펜으로 그린 점. 좌표는 상자 기준 0~1 이라 상자를 늘리고 뒤집어도 그대로 따라온다.
// ix/iy 는 이 점으로 들어오는 핸들, ox/oy 는 나가는 핸들 (핸들도 같은 좌표계)
export type PathPoint = {
  x: number
  y: number
  ix?: number
  iy?: number
  ox?: number
  oy?: number
}

type Box = { x: number; y: number; width: number; height: number }

export const STAR = [
  [0.5, 0],
  [0.62, 0.35],
  [1, 0.35],
  [0.69, 0.57],
  [0.81, 1],
  [0.5, 0.74],
  [0.19, 1],
  [0.31, 0.57],
  [0, 0.35],
  [0.38, 0.35],
]

export const SHAPE_POINTS: Record<string, number[][]> = {
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  pentagon: [
    [0.5, 0],
    [1, 0.38],
    [0.81, 1],
    [0.19, 1],
    [0, 0.38],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
  octagon: [
    [0.3, 0],
    [0.7, 0],
    [1, 0.3],
    [1, 0.7],
    [0.7, 1],
    [0.3, 1],
    [0, 0.7],
    [0, 0.3],
  ],
  trapezoid: [
    [0.25, 0],
    [0.75, 0],
    [1, 1],
    [0, 1],
  ],
  parallelogram: [
    [0.25, 0],
    [1, 0],
    [0.75, 1],
    [0, 1],
  ],
  arrow: [
    [0, 0.25],
    [0.58, 0.25],
    [0.58, 0],
    [1, 0.5],
    [0.58, 1],
    [0.58, 0.75],
    [0, 0.75],
  ],
  chevron: [
    [0, 0],
    [0.55, 0],
    [1, 0.5],
    [0.55, 1],
    [0, 1],
    [0.45, 0.5],
  ],
  cross: [
    [0.35, 0],
    [0.65, 0],
    [0.65, 0.35],
    [1, 0.35],
    [1, 0.65],
    [0.65, 0.65],
    [0.65, 1],
    [0.35, 1],
    [0.35, 0.65],
    [0, 0.65],
    [0, 0.35],
    [0.35, 0.35],
  ],
  speech: [
    [0, 0],
    [1, 0],
    [1, 0.78],
    [0.4, 0.78],
    [0.2, 1],
    [0.2, 0.78],
    [0, 0.78],
  ],
  "rounded-pentagon": [
    [0.5, 0],
    [0.96, 0.33],
    [0.78, 1],
    [0.22, 1],
    [0.04, 0.33],
  ],
  "arrow-left": [
    [1, 0.25],
    [0.42, 0.25],
    [0.42, 0],
    [0, 0.5],
    [0.42, 1],
    [0.42, 0.75],
    [1, 0.75],
  ],
  "arrow-up": [
    [0.25, 1],
    [0.25, 0.42],
    [0, 0.42],
    [0.5, 0],
    [1, 0.42],
    [0.75, 0.42],
    [0.75, 1],
  ],
  "arrow-down": [
    [0.25, 0],
    [0.75, 0],
    [0.75, 0.58],
    [1, 0.58],
    [0.5, 1],
    [0, 0.58],
    [0.25, 0.58],
  ],
  shield: [
    [0.5, 0],
    [1, 0.2],
    [0.92, 0.68],
    [0.5, 1],
    [0.08, 0.68],
    [0, 0.2],
  ],
  heptagon: [
    [0.5, 0],
    [0.89, 0.19],
    [1, 0.61],
    [0.72, 1],
    [0.28, 1],
    [0, 0.61],
    [0.11, 0.19],
  ],
  decagon: Array.from({ length: 10 }, (_, n) => [
    0.5 + 0.5 * Math.sin((n * Math.PI) / 5),
    0.5 - 0.5 * Math.cos((n * Math.PI) / 5),
  ]),
  burst: Array.from({ length: 16 }, (_, n) => {
    const radius = n % 2 ? 0.34 : 0.5
    return [
      0.5 + radius * Math.sin((n * Math.PI) / 8),
      0.5 - radius * Math.cos((n * Math.PI) / 8),
    ]
  }),
  tag: [
    [0, 0],
    [0.74, 0],
    [1, 0.5],
    [0.74, 1],
    [0, 1],
  ],
  bookmark: [
    [0.1, 0],
    [0.9, 0],
    [0.9, 1],
    [0.5, 0.72],
    [0.1, 1],
  ],
  flag: [
    [0.1, 0],
    [0.9, 0],
    [0.7, 0.5],
    [0.9, 1],
    [0.1, 1],
  ],
}

export const HEART_PATH =
  "M .5 .95 C .38 .83 0 .55 0 .3 C 0 .02 .35 -.07 .5 .18 C .65 -.07 1 .02 1 .3 C 1 .55 .62 .83 .5 .95 Z"

const HEART: PathPoint[] = [
  { x: 0.5, y: 0.95, ix: 0.62, iy: 0.83, ox: 0.38, oy: 0.83 },
  { x: 0, y: 0.3, ix: 0, iy: 0.55, ox: 0, oy: 0.02 },
  { x: 0.5, y: 0.18, ix: 0.35, iy: -0.07, ox: 0.65, oy: -0.07 },
  { x: 1, y: 0.3, ix: 1, iy: 0.02, ox: 1, oy: 0.55 },
]

// 원을 베지어 넷으로 그릴 때 핸들 길이 비율
const KAPPA = 0.5523

export const STAR_POINTS_RANGE = [3, 20] as const

// 꼭짓점 n 개, 안쪽 반지름 비율 ratio 인 별을 상자에 꽉 맞춘다
export function starPolygon(count: number, ratio: number) {
  const raw = Array.from({ length: count * 2 }, (_, i) => {
    const radius = i % 2 ? ratio : 1
    const angle = (i * Math.PI) / count - Math.PI / 2
    return [radius * Math.cos(angle), radius * Math.sin(angle)]
  })
  const xs = raw.map(([x]) => x)
  const ys = raw.map(([, y]) => y)
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ]
  return raw.map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)])
}

export function starOf(layer: Layer) {
  if (layer.starPoints === undefined && layer.starRatio === undefined)
    return STAR
  return starPolygon(layer.starPoints ?? 5, layer.starRatio ?? 0.38)
}

const corners = (points: number[][]): PathPoint[] =>
  points.map(([x, y]) => ({ x, y }))

function roundedRect(rx: number, ry: number): PathPoint[] {
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  return [
    { x: rx, y: 0, ix: rx - kx, iy: 0 },
    { x: 1 - rx, y: 0, ox: 1 - rx + kx, oy: 0 },
    { x: 1, y: ry, ix: 1, iy: ry - ky },
    { x: 1, y: 1 - ry, ox: 1, oy: 1 - ry + ky },
    { x: 1 - rx, y: 1, ix: 1 - rx + kx, iy: 1 },
    { x: rx, y: 1, ox: rx - kx, oy: 1 },
    { x: 0, y: 1 - ry, ix: 0, iy: 1 - ry + ky },
    { x: 0, y: ry, ox: 0, oy: ry - ky },
  ]
}

// 점 편집으로 넘길 수 있는 도형의 윤곽. 모양틀 윤곽처럼 따로 그린 패스는 null
export function shapeOutline(layer: Layer): PathPoint[] | null {
  const variant = layer.shapeVariant
  if (layer.type === "rect" && variant === "rounded") {
    const r = Math.min(layer.width, layer.height) * 0.16
    return roundedRect(r / layer.width, r / layer.height)
  }
  if (layer.type === "rect" && variant)
    return SHAPE_POINTS[variant] ? corners(SHAPE_POINTS[variant]) : null
  if (layer.type === "rect")
    return corners([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
  if (layer.type === "triangle")
    return corners([
      [0.5, 0],
      [1, 1],
      [0, 1],
    ])
  if (layer.type === "star") return corners(starOf(layer))
  if (layer.type === "heart") return HEART.map((point) => ({ ...point }))
  if (layer.type === "ellipse") {
    const k = KAPPA / 2
    return [
      { x: 0.5, y: 0, ix: 0.5 - k, iy: 0, ox: 0.5 + k, oy: 0 },
      { x: 1, y: 0.5, ix: 1, iy: 0.5 - k, ox: 1, oy: 0.5 + k },
      { x: 0.5, y: 1, ix: 0.5 + k, iy: 1, ox: 0.5 - k, oy: 1 },
      { x: 0, y: 0.5, ix: 0, iy: 0.5 + k, ox: 0, oy: 0.5 - k },
    ]
  }
  return null
}

const outOf = (p: PathPoint) =>
  p.ox === undefined || p.oy === undefined ? null : { x: p.ox, y: p.oy }
const inOf = (p: PathPoint) =>
  p.ix === undefined || p.iy === undefined ? null : { x: p.ix, y: p.iy }

function segments(points: PathPoint[], closed: boolean) {
  const pairs: [PathPoint, PathPoint][] = []
  for (let i = 1; i < points.length; i++) pairs.push([points[i - 1], points[i]])
  if (closed && points.length > 2)
    pairs.push([points[points.length - 1], points[0]])
  return pairs
}

const round = (value: number) => Math.round(value * 1000) / 1000

// 상자 좌표(0~1)를 그대로 쓰면 선 두께도 상자 비율로 늘어나므로, 실제 좌표로 펼쳐서 그린다
export function toAbsolute(points: PathPoint[], box: Box): PathPoint[] {
  const ax = (value: number | undefined) =>
    value === undefined ? undefined : box.x + value * box.width
  const ay = (value: number | undefined) =>
    value === undefined ? undefined : box.y + value * box.height
  return points.map((p) => ({
    x: box.x + p.x * box.width,
    y: box.y + p.y * box.height,
    ix: ax(p.ix),
    iy: ay(p.iy),
    ox: ax(p.ox),
    oy: ay(p.oy),
  }))
}

export function pathData(points: PathPoint[], closed: boolean) {
  if (!points.length) return ""
  const parts = [`M${round(points[0].x)} ${round(points[0].y)}`]
  for (const [a, b] of segments(points, closed)) {
    const c1 = outOf(a)
    const c2 = inOf(b)
    parts.push(
      c1 || c2
        ? `C${round((c1 ?? a).x)} ${round((c1 ?? a).y)} ${round((c2 ?? b).x)} ${round((c2 ?? b).y)} ${round(b.x)} ${round(b.y)}`
        : `L${round(b.x)} ${round(b.y)}`
    )
  }
  if (closed && points.length > 2) parts.push("Z")
  return parts.join(" ")
}

export function layerPathData(layer: Layer) {
  return pathData(toAbsolute(layer.pathPoints ?? [], layer), !!layer.pathClosed)
}

function curveExtent(points: PathPoint[], closed: boolean) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  // 베지어 극값은 핸들 안쪽에 있다. 표본으로 훑으면 인쇄 상자 정도의 정밀도로 충분하다
  for (const [a, b] of segments(points, closed)) {
    const c1 = outOf(a) ?? a
    const c2 = inOf(b) ?? b
    for (let i = 1; i < 24; i++) {
      const t = i / 24
      const u = 1 - t
      xs.push(
        u * u * u * a.x +
          3 * u * u * t * c1.x +
          3 * u * t * t * c2.x +
          t * t * t * b.x
      )
      ys.push(
        u * u * u * a.y +
          3 * u * u * t * c1.y +
          3 * u * t * t * c2.y +
          t * t * t * b.y
      )
    }
  }
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  }
}

export const MIN_PATH_BOX = 1

// 실제 좌표의 점들을 곡선에 꼭 맞는 상자와 그 상자 기준 좌표로 바꾼다
export function fitPath(points: PathPoint[], closed: boolean) {
  const e = curveExtent(points, closed)
  const width = Math.max(MIN_PATH_BOX, e.x1 - e.x0)
  const height = Math.max(MIN_PATH_BOX, e.y1 - e.y0)
  // 일직선처럼 폭이 거의 없는 쪽은 최소 상자 가운데에 놓는다
  const x = (e.x0 + e.x1) / 2 - width / 2
  const y = (e.y0 + e.y1) / 2 - height / 2
  const nx = (value: number | undefined) =>
    value === undefined ? undefined : round((value - x) / width)
  const ny = (value: number | undefined) =>
    value === undefined ? undefined : round((value - y) / height)
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    pathPoints: points.map((p) => {
      const point: PathPoint = { x: nx(p.x)!, y: ny(p.y)! }
      if (p.ix !== undefined && p.iy !== undefined) {
        point.ix = nx(p.ix)
        point.iy = ny(p.iy)
      }
      if (p.ox !== undefined && p.oy !== undefined) {
        point.ox = nx(p.ox)
        point.oy = ny(p.oy)
      }
      return point
    }),
  }
}

// 점을 고친 뒤 상자를 곡선에 다시 맞춘다. 회전·반전한 도형도 화면에서 제자리에 남도록 중심을 옮긴다
export function refitPathLayer(layer: Layer): Partial<Layer> {
  const local = toAbsolute(layer.pathPoints ?? [], layer)
  const fitted = fitPath(local, !!layer.pathClosed)
  const oldCx = layer.x + layer.width / 2
  const oldCy = layer.y + layer.height / 2
  const newCx = fitted.x + fitted.width / 2
  const newCy = fitted.y + fitted.height / 2
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  const dx = (newCx - oldCx) * (layer.flipX ? -1 : 1)
  const dy = (newCy - oldCy) * (layer.flipY ? -1 : 1)
  const cx = oldCx + dx * Math.cos(rad) - dy * Math.sin(rad)
  const cy = oldCy + dx * Math.sin(rad) + dy * Math.cos(rad)
  return {
    ...fitted,
    x: round(cx - fitted.width / 2),
    y: round(cy - fitted.height / 2),
  }
}

// 화면 좌표를 회전·반전 전 도형 좌표로 되돌린다
export function toLocal(layer: Layer, point: { x: number; y: number }) {
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  const rad = (-(layer.rotation ?? 0) * Math.PI) / 180
  const dx = point.x - cx
  const dy = point.y - cy
  return {
    x: cx + (dx * Math.cos(rad) - dy * Math.sin(rad)) * (layer.flipX ? -1 : 1),
    y: cy + (dx * Math.sin(rad) + dy * Math.cos(rad)) * (layer.flipY ? -1 : 1),
  }
}

type Point = { x: number; y: number }
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

// 선분 a-b 에서 가장 멀리 떨어진 점이 tolerance 안이면 그 사이 점을 모두 버린다 (Douglas–Peucker)
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points
  const a = points[0]
  const b = points[points.length - 1]
  const length = gap(a, b)
  let far = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const d = length
      ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length
      : gap(a, p)
    if (d > far) {
      far = d
      index = i
    }
  }
  if (far <= tolerance) return [a, b]
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ]
}

// 연필로 그린 떨리는 선을 매끈한 곡선으로 바꾼다. px 는 화면 1px 의 mm, level 은 보정 세기(0~100)
export function smoothStroke(
  raw: Point[],
  px: number,
  level: number
): { points: PathPoint[]; closed: boolean } {
  // 세기를 올릴수록 이웃을 넓게, 여러 번 평균 내서 떨림뿐 아니라 굽이도 펴 준다
  const radius = Math.round(level / 20)
  const passes = level > 60 ? 3 : level > 30 ? 2 : 1
  let averaged = raw
  for (let pass = 0; pass < passes; pass++)
    averaged = averaged.map((p, i, all) => {
      if (i === 0 || i === all.length - 1) return p
      const near = all.slice(Math.max(0, i - radius), i + radius + 1)
      return {
        x: near.reduce((sum, q) => sum + q.x, 0) / near.length,
        y: near.reduce((sum, q) => sum + q.y, 0) / near.length,
      }
    })
  const travelled = raw.reduce(
    (sum, p, i) => (i ? sum + gap(p, raw[i - 1]) : 0),
    0
  )
  // 끝을 시작점 가까이에서 뗐으면 닫힌 도형으로 본다
  const closed =
    raw.length > 3 &&
    gap(raw[0], raw[raw.length - 1]) <= px * 6 &&
    travelled > px * 60
  let kept = simplify(averaged, px * (0.2 + level * 0.06))
  if (closed && kept.length > 3) kept = kept.slice(0, -1)
  if (kept.length < 3)
    return { points: kept.map((p) => ({ ...p })), closed: false }
  const at = (i: number) =>
    closed
      ? kept[(i + kept.length) % kept.length]
      : kept[Math.max(0, Math.min(kept.length - 1, i))]
  // 접선은 양 이웃을 잇는 방향, 핸들 길이는 각 쪽 구간의 1/3 이다. 간격이 고르지 않아도 넘치지 않는다
  const points: PathPoint[] = kept.map((p, i) => {
    const prev = at(i - 1)
    const next = at(i + 1)
    const span = gap(prev, next) || 1
    const ux = (next.x - prev.x) / span
    const uy = (next.y - prev.y) / span
    const back = gap(prev, p) / 3
    const ahead = gap(next, p) / 3
    return {
      x: p.x,
      y: p.y,
      ix: p.x - ux * back,
      iy: p.y - uy * back,
      ox: p.x + ux * ahead,
      oy: p.y + uy * ahead,
    }
  })
  return { points, closed }
}
