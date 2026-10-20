import {
  EFFECT_LAYERS,
  validMotionMask,
  type EffectKind,
  type MotionMask,
} from "./effect-layer"
import { validPhotoEffects, type PhotoEffects } from "./photo-effects"
import { PRINT_SPECS, type PrintKind } from "./catalog"
import { CLIPART_IDS, FRAME_IDS, SHAPE_VARIANTS } from "./art-library"
import { FILE_IMAGE_REF } from "./image-ref"
import type { PathPoint } from "./path-shape"
import { LINE_CAPS, type LineCap } from "./line-shape"
import { fittedFontSize } from "../components/graphic"
import { isAutoTextName, textLayerName } from "./layer"

export type Layer = {
  id: string
  type:
    | "text"
    | "rect"
    | "ellipse"
    | "image"
    | "triangle"
    | "line"
    | "star"
    | "heart"
    | "frame"
    | "qr"
    | "effect"
    | "clipart"
    | "path"
  name: string
  x: number
  y: number
  width: number
  height: number
  fill: string
  text?: string
  fontSize?: number
  image?: string
  originalImage?: string
  imageFilter?: "grayscale" | "emboss" | "boxblur" | "brightness" | "sepia"
  effectKind?: EffectKind
  effectDensity?: number
  imageMotionMask?: MotionMask
  photoEffects?: PhotoEffects
  imageMotionBlur?: number
  imageMotionMix?: number
  imageTint?: string
  pixelWidth?: number
  pixelHeight?: number
  imageScale?: number
  imageOffsetX?: number
  imageOffsetY?: number
  fontFamily?: string
  fontWeight?: "normal" | "bold"
  italic?: boolean
  align?: "left" | "center" | "right"
  letterSpacing?: number
  lineHeight?: number
  widthScale?: number
  rotation?: number
  opacity?: number
  stroke?: string
  strokeWidth?: number
  flipX?: boolean
  flipY?: boolean
  frameShape?: string
  shapeVariant?: string
  clipartId?: string
  qrBits?: string
  qrSize?: number
  qrData?: string
  visible?: boolean
  locked?: boolean
  editable?: boolean
  textColor?: string
  strokeDash?: "dashed" | "dotted"
  strokeRound?: boolean
  shadow?: boolean
  shadowX?: number
  shadowY?: number
  shadowBlur?: number
  shadowColor?: string
  shadowOpacity?: number
  texture?: boolean
  bevel?: boolean
  bevelSize?: number
  bevelDepth?: number
  bevelAngle?: number
  starPoints?: number
  starRatio?: number
  pathPoints?: PathPoint[]
  pathClosed?: boolean
  crop?: { x: number; y: number; w: number; h: number }
  groupId?: string
  groupName?: string
  brush?: "pen" | "highlighter"
  lineStart?: LineCap
  lineEnd?: LineCap
  lineStartSize?: number
  lineEndSize?: number
  lineDash?: [number, number]
  lineDashCustom?: [number, number]
  linePath?: { x: number; y: number }[]
  lineCurved?: boolean
}

export const SHAPE_TEXT_TYPES: ReadonlySet<Layer["type"]> = new Set<
  Layer["type"]
>(["rect", "ellipse", "triangle", "star", "heart", "path"])

export type Design = {
  version: 1
  title?: string
  industry?: string
  purpose?: string
  kind: PrintKind
  productId: string
  widthMm: number
  heightMm: number
  background: string
  backgroundImage?: string
  backgroundPixelWidth?: number
  backgroundPixelHeight?: number
  backBackground?: SideBackground
  // 원본 file: 참조 → 편집 화면용 축소본 file: 참조
  imagePreviews?: Record<string, string>
  front: Layer[]
  back: Layer[]
}

export type SideBackground = Pick<
  Design,
  | "background"
  | "backgroundImage"
  | "backgroundPixelWidth"
  | "backgroundPixelHeight"
>

export function sideBackground(
  design: Design,
  side: "front" | "back"
): SideBackground {
  if (side === "back" && design.backBackground) return design.backBackground
  return {
    background: design.background,
    backgroundImage: design.backgroundImage,
    backgroundPixelWidth: design.backgroundPixelWidth,
    backgroundPixelHeight: design.backgroundPixelHeight,
  }
}

export function printsBack(design: Design): boolean {
  const bg = design.backBackground
  return (
    design.back.length > 0 ||
    !!bg?.backgroundImage ||
    (!!bg && bg.background.toLowerCase() !== "#ffffff")
  )
}

export function withSideBackground(
  design: Design,
  side: "front" | "back",
  value: SideBackground
): Design {
  if (side === "back") return { ...design, backBackground: value }
  return {
    ...design,
    backgroundImage: undefined,
    backgroundPixelWidth: undefined,
    backgroundPixelHeight: undefined,
    ...value,
  }
}

export function newDesign(kind: PrintKind, productId = ""): Design {
  const [widthMm, heightMm] = PRINT_SPECS[kind].sizes[0]
  return {
    version: 1,
    kind,
    productId,
    widthMm,
    heightMm,
    background: "#ffffff",
    backBackground: { background: "#ffffff" },
    front: [],
    back: [],
  }
}

// 원본이 uploadFile 서버액션으로 Lambda 를 지나는데, 이진 본문은 base64 로 실려 6MB 이벤트 상한에 걸린다
export const MAX_IMAGE_FILE_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_DATA_LENGTH = Math.ceil((MAX_IMAGE_FILE_BYTES * 4) / 3) + 100

const kinds = new Set(Object.keys(PRINT_SPECS))
const color = /^#[0-9a-fA-F]{6}$/
const dataImage = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/
const isImageValue = (value: string) =>
  dataImage.test(value) || FILE_IMAGE_REF.test(value)

export function parseDesign(value: unknown): Design {
  if (!value || typeof value !== "object")
    throw new Error("디자인 파일 형식이 올바르지 않습니다.")
  const data = value as Partial<Design>
  if (data.version !== 1 || !data.kind || !kinds.has(data.kind))
    throw new Error("지원하지 않는 디자인입니다.")
  if (
    data.title !== undefined &&
    (typeof data.title !== "string" || data.title.length > 80)
  )
    throw new Error("시안 이름이 올바르지 않습니다.")
  for (const tag of [data.industry, data.purpose])
    if (tag !== undefined && (typeof tag !== "string" || tag.length > 40))
      throw new Error("시안 분류가 올바르지 않습니다.")
  if (
    typeof data.background !== "string" ||
    !color.test(data.background) ||
    typeof data.productId !== "string" ||
    data.productId.length > 100
  )
    throw new Error("디자인 기본 정보가 올바르지 않습니다.")
  if (
    !Number.isFinite(data.widthMm) ||
    !Number.isFinite(data.heightMm) ||
    (data.widthMm ?? 0) < 35 ||
    (data.heightMm ?? 0) < 35 ||
    (data.widthMm ?? 0) > 1800 ||
    (data.heightMm ?? 0) > 1800
  ) {
    throw new Error("인쇄 크기가 허용 범위를 벗어났습니다.")
  }
  if (
    !Array.isArray(data.front) ||
    !Array.isArray(data.back) ||
    data.front.length + data.back.length > 150
  )
    throw new Error("레이어 수가 너무 많습니다.")
  for (const side of ["front", "back"] as const) {
    const layers = data[side] ?? []
    layers.forEach((layer, index) => {
      const where = `${side === "front" ? "앞면" : "뒷면"} 레이어 목록 위에서 ${layers.length - index}번째${typeof layer?.name === "string" ? ` "${layer.name.slice(0, 30)}"` : ""}`
      checkLayer(layer, where)
    })
  }
  function checkLayer(layer: Layer, where: string) {
    if (
      !layer ||
      ![
        "text",
        "rect",
        "ellipse",
        "image",
        "triangle",
        "line",
        "star",
        "heart",
        "frame",
        "qr",
        "clipart",
        "effect",
        "path",
      ].includes(layer.type) ||
      typeof layer.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(layer.id) ||
      typeof layer.name !== "string" ||
      layer.name.length > 100 ||
      typeof layer.fill !== "string" ||
      !(
        color.test(layer.fill) ||
        (layer.fill === "none" && SHAPE_TEXT_TYPES.has(layer.type))
      ) ||
      (layer.textColor !== undefined && !color.test(layer.textColor)) ||
      (layer.imageTint !== undefined && !color.test(layer.imageTint)) ||
      (layer.groupId !== undefined &&
        (typeof layer.groupId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(layer.groupId))) ||
      (layer.crop !== undefined && !validCrop(layer.crop)) ||
      (layer.stroke !== undefined &&
        layer.stroke !== "none" &&
        !color.test(layer.stroke)) ||
      ![layer.x, layer.y, layer.width, layer.height].every(Number.isFinite) ||
      (layer.type === "text" && typeof layer.text !== "string") ||
      (layer.type === "image" && !layer.image) ||
      (layer.type === "clipart" && !CLIPART_IDS.has(layer.clipartId ?? "")) ||
      (layer.shapeVariant !== undefined &&
        !SHAPE_VARIANTS.has(layer.shapeVariant)) ||
      (layer.type === "frame" &&
        layer.frameShape !== undefined &&
        !FRAME_IDS.has(layer.frameShape)) ||
      (layer.type === "qr" &&
        (!layer.qrBits || !Number.isInteger(layer.qrSize))) ||
      (layer.text?.length ?? 0) > 500 ||
      (layer.image?.length ?? 0) > MAX_IMAGE_DATA_LENGTH ||
      (layer.image && !isImageValue(layer.image)) ||
      (layer.originalImage !== undefined &&
        (layer.originalImage.length > MAX_IMAGE_DATA_LENGTH ||
          !isImageValue(layer.originalImage))) ||
      (layer.imageFilter !== undefined &&
        !["grayscale", "emboss", "boxblur", "brightness", "sepia"].includes(
          layer.imageFilter
        )) ||
      [layer.imageMotionBlur, layer.imageMotionMix, layer.effectDensity].some(
        (value) =>
          value !== undefined &&
          (!Number.isFinite(value) || value < 0 || value > 100)
      ) ||
      (layer.pixelWidth !== undefined &&
        (!Number.isFinite(layer.pixelWidth) || layer.pixelWidth < 1)) ||
      (layer.pixelHeight !== undefined &&
        (!Number.isFinite(layer.pixelHeight) || layer.pixelHeight < 1)) ||
      (layer.imageScale !== undefined &&
        (!Number.isFinite(layer.imageScale) ||
          layer.imageScale < 1 ||
          layer.imageScale > 3)) ||
      (layer.imageOffsetX !== undefined &&
        (!Number.isFinite(layer.imageOffsetX) ||
          layer.imageOffsetX < 0 ||
          layer.imageOffsetX > 1)) ||
      (layer.imageOffsetY !== undefined &&
        (!Number.isFinite(layer.imageOffsetY) ||
          layer.imageOffsetY < 0 ||
          layer.imageOffsetY > 1)) ||
      (layer.rotation !== undefined &&
        (!Number.isFinite(layer.rotation) || Math.abs(layer.rotation) > 360)) ||
      (layer.opacity !== undefined &&
        (!Number.isFinite(layer.opacity) ||
          layer.opacity < 0 ||
          layer.opacity > 1)) ||
      (layer.strokeWidth !== undefined &&
        (!Number.isFinite(layer.strokeWidth) ||
          layer.strokeWidth < 0 ||
          layer.strokeWidth > 50)) ||
      !validEffects(layer) ||
      !validPhotoEffects(layer.photoEffects) ||
      !validMotionMask(layer.imageMotionMask) ||
      (layer.type === "effect" &&
        !EFFECT_LAYERS.some(([key]) => key === layer.effectKind)) ||
      (layer.type === "path" && !validPath(layer)) ||
      (layer.qrData !== undefined &&
        (typeof layer.qrData !== "string" || layer.qrData.length > 2000)) ||
      (layer.qrBits &&
        (!/^[01]+$/.test(layer.qrBits) ||
          layer.qrBits.length > 177 * 177 ||
          layer.qrBits.length !== (layer.qrSize ?? 0) ** 2))
    ) {
      throw new Error(`${where} 레이어의 데이터가 올바르지 않습니다.`)
    }
    const w = data.widthMm ?? 0
    const h = data.heightMm ?? 0
    if (
      layer.x < -w ||
      layer.y < -h ||
      layer.x > w * 2 ||
      layer.y > h * 2 ||
      layer.width <= 0 ||
      layer.height <= 0 ||
      layer.width > w * 2 ||
      layer.height > h * 2
    )
      throw new Error(
        `${where} 레이어의 크기·위치가 허용 범위를 벗어났습니다. (가로 ${layer.width}mm, 세로 ${layer.height}mm)`
      )
  }
  if (data.backBackground !== undefined) {
    if (
      !data.backBackground ||
      typeof data.backBackground.background !== "string" ||
      !color.test(data.backBackground.background)
    )
      throw new Error("뒷면 배경이 올바르지 않습니다.")
    checkBackgroundImage(data.backBackground)
  }
  checkBackgroundImage(data)
  const design = data as Design
  const named = (layers: Layer[]) =>
    layers.map((layer) =>
      isAutoTextName(layer)
        ? { ...layer, name: textLayerName(layer.text) }
        : layer
    )
  const imagePreviews =
    design.imagePreviews && typeof design.imagePreviews === "object"
      ? Object.fromEntries(
          Object.entries(design.imagePreviews).filter(
            ([original, preview]) =>
              FILE_IMAGE_REF.test(original) &&
              typeof preview === "string" &&
              FILE_IMAGE_REF.test(preview)
          )
        )
      : undefined
  return {
    ...design,
    imagePreviews,
    front: named(design.front),
    back: named(design.back),
  }
}

function checkBackgroundImage(data: Partial<SideBackground>) {
  if (
    data.backgroundImage &&
    (!isImageValue(data.backgroundImage) ||
      data.backgroundImage.length > MAX_IMAGE_DATA_LENGTH)
  )
    throw new Error("배경 이미지가 올바르지 않습니다.")
  if (
    (data.backgroundPixelWidth !== undefined &&
      (!Number.isFinite(data.backgroundPixelWidth) ||
        data.backgroundPixelWidth < 1)) ||
    (data.backgroundPixelHeight !== undefined &&
      (!Number.isFinite(data.backgroundPixelHeight) ||
        data.backgroundPixelHeight < 1))
  )
    throw new Error("배경 이미지 해상도가 올바르지 않습니다.")
}

export function updateLayer(
  design: Design,
  side: "front" | "back",
  id: string,
  change: Partial<Layer>
): Design {
  return {
    ...design,
    [side]: design[side].map((layer) =>
      layer.id === id ? { ...layer, ...change } : layer
    ),
  }
}

export function reorderLayer(
  design: Design,
  side: "front" | "back",
  id: string,
  direction: -1 | 1
): Design {
  const layers = [...design[side]]
  const index = layers.findIndex((layer) => layer.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= layers.length) return design
  ;[layers[index], layers[target]] = [layers[target], layers[index]]
  return { ...design, [side]: layers }
}

export function resizeDesign(
  design: Design,
  widthMm: number,
  heightMm: number
): Design {
  const sx = widthMm / design.widthMm,
    sy = heightMm / design.heightMm
  const resize = (layer: Layer): Layer => {
    const x = Math.round(layer.x * sx * 10) / 10,
      y = Math.round(layer.y * sy * 10) / 10
    return {
      ...layer,
      x,
      y,
      width: Math.round(layer.width * sx * 10) / 10,
      height: Math.round(layer.height * sy * 10) / 10,
      fontSize:
        layer.fontSize === undefined
          ? undefined
          : Math.round(layer.fontSize * Math.min(sx, sy) * 10) / 10,
    }
  }
  return {
    ...design,
    widthMm,
    heightMm,
    front: design.front.map(resize),
    back: design.back.map(resize),
  }
}

const within = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
const optional = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined || check(value)
const isBool = (value: unknown) => typeof value === "boolean"
const isCap = (value: unknown) => LINE_CAPS.includes(value as LineCap)
const isPair = (value: unknown, min: number, max: number) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((v) => within(v, min, max))

function validEffects(layer: Layer) {
  return (
    optional(layer.strokeDash, (v) => v === "dashed" || v === "dotted") &&
    optional(layer.strokeRound, isBool) &&
    optional(layer.groupName, (v) => typeof v === "string" && v.length <= 40) &&
    optional(layer.brush, (v) => v === "pen" || v === "highlighter") &&
    optional(layer.lineStart, isCap) &&
    optional(layer.lineEnd, isCap) &&
    optional(layer.lineStartSize, (v) => within(v, 1, 5)) &&
    optional(layer.lineEndSize, (v) => within(v, 1, 5)) &&
    optional(layer.lineDash, (v) => isPair(v, 0, 20)) &&
    optional(layer.lineDashCustom, (v) => isPair(v, 0, 500)) &&
    optional(layer.lineCurved, isBool) &&
    optional(
      layer.linePath,
      (v) =>
        Array.isArray(v) &&
        v.length === 3 &&
        v.every((p) => within(p?.x, -1, 2) && within(p?.y, -1, 2))
    ) &&
    optional(layer.shadowX, (v) => within(v, -50, 50)) &&
    optional(layer.shadowY, (v) => within(v, -50, 50)) &&
    optional(layer.shadowBlur, (v) => within(v, 0, 20)) &&
    optional(
      layer.shadowColor,
      (v) => typeof v === "string" && color.test(v)
    ) &&
    optional(layer.shadowOpacity, (v) => within(v, 0, 1)) &&
    optional(layer.bevel, isBool) &&
    optional(layer.bevelSize, (v) => within(v, 0.05, 20)) &&
    optional(layer.bevelDepth, (v) => within(v, 0, 100)) &&
    optional(layer.bevelAngle, (v) => within(v, -360, 360)) &&
    optional(
      layer.starPoints,
      (v) => Number.isInteger(v) && within(v, 3, 20)
    ) &&
    optional(layer.starRatio, (v) => within(v, 0.05, 1))
  )
}

// 핸들은 곡선 상자 밖으로 나갈 수 있어 0~1 보다 넓게 받는다
function validPath(layer: Layer) {
  const points = layer.pathPoints
  const coord = (v: unknown) => within(v, -10, 11)
  return (
    Array.isArray(points) &&
    points.length >= 2 &&
    points.length <= 400 &&
    optional(layer.pathClosed, isBool) &&
    points.every(
      (p) =>
        !!p &&
        typeof p === "object" &&
        coord(p.x) &&
        coord(p.y) &&
        (p.ix === undefined) === (p.iy === undefined) &&
        (p.ox === undefined) === (p.oy === undefined) &&
        optional(p.ix, coord) &&
        optional(p.iy, coord) &&
        optional(p.ox, coord) &&
        optional(p.oy, coord)
    )
  )
}

function validCrop(crop: Layer["crop"]) {
  if (!crop || typeof crop !== "object") return false
  const { x, y, w, h } = crop
  return (
    [x, y, w, h].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    w > 0 &&
    h > 0 &&
    x + w <= 1.0001 &&
    y + h <= 1.0001
  )
}

// 사진이 실제로 쓰는 픽셀로 잰 해상도. 잘라낸 사진은 남은 구간의 픽셀만 인쇄에 쓰인다
export function layerImageDpi(kind: PrintKind, layer: Layer) {
  if (!layer.image || !layer.pixelWidth || !layer.pixelHeight) return Infinity
  if (layer.crop)
    return imageDpi(
      kind,
      layer.pixelWidth * layer.crop.w,
      layer.pixelHeight * layer.crop.h,
      layer.width,
      layer.height
    )
  return imageDpi(
    kind,
    layer.pixelWidth,
    layer.pixelHeight,
    layer.width,
    layer.height,
    layer.imageScale
  )
}

export function imageDpi(
  kind: PrintKind,
  pixelWidth: number,
  pixelHeight: number,
  widthMm: number,
  heightMm: number,
  scale = 1
) {
  const fileScale = PRINT_SPECS[kind].fileScale
  return Math.floor(
    Math.min(pixelWidth / (widthMm / 25.4), pixelHeight / (heightMm / 25.4)) /
      fileScale /
      scale
  )
}

export function resizeLayerFromHandle(
  layer: Layer,
  handle: string,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
  keepRatio = false
): Partial<Layer> {
  const round = (value: number) => Math.round(value * 10) / 10
  if (keepRatio) {
    const corner = handle.length === 2
    const sx = (layer.width + (handle.includes("w") ? -dx : dx)) / layer.width
    const sy = (layer.height + (handle.includes("n") ? -dy : dy)) / layer.height
    const wanted = corner
      ? Math.max(sx, sy)
      : handle === "e" || handle === "w"
        ? sx
        : sy
    const s = Math.max(
      2 / Math.min(layer.width, layer.height),
      Math.min(
        wanted,
        (canvasWidth * 2) / layer.width,
        (canvasHeight * 2) / layer.height
      )
    )
    const width = layer.width * s
    const height = layer.height * s
    const x = handle.includes("w")
      ? layer.x + layer.width - width
      : handle.includes("e")
        ? layer.x
        : layer.x + (layer.width - width) / 2
    const y = handle.includes("n")
      ? layer.y + layer.height - height
      : handle.includes("s")
        ? layer.y
        : layer.y + (layer.height - height) / 2
    return {
      x: round(x),
      y: round(y),
      width: round(width),
      height: round(height),
    }
  }
  let { x, y, width, height } = layer
  if (handle.includes("w")) {
    x = Math.max(
      -canvasWidth,
      layer.x + layer.width - canvasWidth * 2,
      Math.min(layer.x + layer.width - 2, layer.x + dx)
    )
    width = layer.x + layer.width - x
  }
  if (handle.includes("e"))
    width = Math.max(2, Math.min(canvasWidth * 2, layer.width + dx))
  if (handle.includes("n")) {
    y = Math.max(
      -canvasHeight,
      layer.y + layer.height - canvasHeight * 2,
      Math.min(layer.y + layer.height - 2, layer.y + dy)
    )
    height = layer.y + layer.height - y
  }
  if (handle.includes("s"))
    height = Math.max(2, Math.min(canvasHeight * 2, layer.height + dy))
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  }
}

const MIN_PRINT_TEXT_MM = 1.76

// 주문을 막지는 않고 "흐리게 인쇄될 수 있다"고 한 번 더 묻는 항목. 그대로 진행하면 고객 책임이다
export function printWarnings(design: Design): string[] {
  const warnings: string[] = []
  const minDpi = PRINT_SPECS[design.kind].minImageDpi
  const low = (dpi: number) =>
    `해상도 ${Math.floor(dpi)}dpi — 권장 ${minDpi}dpi보다 낮아 흐리게 인쇄될 수 있습니다.`
  for (const [label, side] of [
    ["앞면", "front"],
    ["뒷면", "back"],
  ] as const) {
    const bg = sideBackground(design, side)
    if (side === "back" && !printsBack(design)) continue
    if (!bg.backgroundImage) continue
    const dpi =
      bg.backgroundPixelWidth && bg.backgroundPixelHeight
        ? imageDpi(
            design.kind,
            bg.backgroundPixelWidth,
            bg.backgroundPixelHeight,
            design.widthMm,
            design.heightMm
          )
        : 0
    if (dpi < minDpi) warnings.push(`${label} 배경 이미지: ${low(dpi)}`)
  }
  for (const [side, layers] of [
    ["앞면", design.front],
    ["뒷면", design.back],
  ] as const)
    for (const layer of layers) {
      if (layer.visible === false || !layer.image) continue
      const dpi = layerImageDpi(design.kind, layer)
      if (dpi < minDpi) warnings.push(`${side}의 ${layer.name}: ${low(dpi)}`)
    }
  return warnings
}

export function printIssues(design: Design): string[] {
  const issues: string[] = []
  if (!design.front.length) issues.push("앞면에 인쇄할 내용이 없습니다.")
  for (const [side, layers] of [
    ["앞면", design.front],
    ["뒷면", design.back],
  ] as const) {
    for (const layer of layers) {
      if (layer.visible === false) continue
      if (layer.type === "frame" && !layer.image)
        issues.push(`${side}의 ${layer.name}: 사진을 넣어 주세요.`)
      if (layer.type === "text" && !(layer.text ?? "").trim())
        issues.push(`${side}의 ${layer.name}: 문구가 비어 있습니다.`)
      if (
        layer.type === "text" &&
        (layer.text ?? "").trim() &&
        fittedFontSize(layer) * PRINT_SPECS[design.kind].fileScale <
          MIN_PRINT_TEXT_MM
      )
        issues.push(
          `${side}의 ${layer.name}: 글자가 너무 작아 인쇄 시 뭉개질 수 있습니다. 더 크게 키워 주세요.`
        )
      if (
        (layer.type === "text" || layer.type === "qr") &&
        (layer.x < PRINT_SPECS[design.kind].safetyMm ||
          layer.y < PRINT_SPECS[design.kind].safetyMm ||
          layer.x + layer.width >
            design.widthMm - PRINT_SPECS[design.kind].safetyMm ||
          layer.y + layer.height >
            design.heightMm - PRINT_SPECS[design.kind].safetyMm)
      )
        issues.push(`${side}의 ${layer.name}: 안전영역 안으로 옮겨 주세요.`)
    }
  }
  return issues
}
