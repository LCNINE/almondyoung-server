import { PRINT_SPECS, type PrintKind } from "./catalog"
import { CLIPART_IDS, FRAME_IDS, SHAPE_VARIANTS } from "./art-library"
import { FILE_IMAGE_REF } from "./image-ref"

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
    | "clipart"
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
}

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
  front: Layer[]
  back: Layer[]
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
    front: [],
    back: [],
  }
}

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
  for (const layer of [...data.front, ...data.back]) {
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
      ].includes(layer.type) ||
      typeof layer.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(layer.id) ||
      typeof layer.name !== "string" ||
      layer.name.length > 100 ||
      typeof layer.fill !== "string" ||
      !color.test(layer.fill) ||
      (layer.stroke !== undefined &&
        layer.stroke !== "none" &&
        !color.test(layer.stroke)) ||
      ![layer.x, layer.y, layer.width, layer.height].every(Number.isFinite) ||
      layer.x < -(data.widthMm ?? 0) ||
      layer.y < -(data.heightMm ?? 0) ||
      layer.x > (data.widthMm ?? 0) * 2 ||
      layer.y > (data.heightMm ?? 0) * 2 ||
      layer.width <= 0 ||
      layer.height <= 0 ||
      layer.width > (data.widthMm ?? 0) * 2 ||
      layer.height > (data.heightMm ?? 0) * 2 ||
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
      (layer.image?.length ?? 0) > 8_000_000 ||
      (layer.image && !isImageValue(layer.image)) ||
      (layer.originalImage !== undefined &&
        (layer.originalImage.length > 8_000_000 ||
          !isImageValue(layer.originalImage))) ||
      (layer.imageFilter !== undefined &&
        !["grayscale", "emboss", "boxblur", "brightness", "sepia"].includes(
          layer.imageFilter
        )) ||
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
      (layer.qrData !== undefined &&
        (typeof layer.qrData !== "string" || layer.qrData.length > 2000)) ||
      (layer.qrBits &&
        (!/^[01]+$/.test(layer.qrBits) ||
          layer.qrBits.length > 177 * 177 ||
          layer.qrBits.length !== (layer.qrSize ?? 0) ** 2))
    ) {
      throw new Error("레이어 데이터가 올바르지 않습니다.")
    }
  }
  if (
    data.backgroundImage &&
    (!isImageValue(data.backgroundImage) ||
      data.backgroundImage.length > 8_000_000)
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
  return data as Design
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
  canvasHeight: number
): Partial<Layer> {
  const round = (value: number) => Math.round(value * 10) / 10
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

export function printIssues(design: Design): string[] {
  const issues: string[] = []
  const minDpi = PRINT_SPECS[design.kind].minImageDpi
  if (!design.front.length) issues.push("앞면에 인쇄할 내용이 없습니다.")
  if (
    design.backgroundImage &&
    (!design.backgroundPixelWidth ||
      !design.backgroundPixelHeight ||
      imageDpi(
        design.kind,
        design.backgroundPixelWidth,
        design.backgroundPixelHeight,
        design.widthMm,
        design.heightMm
      ) < minDpi)
  )
    issues.push(`배경 이미지 해상도가 ${minDpi}dpi보다 낮습니다.`)
  for (const [side, layers] of [
    ["앞면", design.front],
    ["뒷면", design.back],
  ] as const) {
    for (const layer of layers) {
      if (layer.visible === false) continue
      if (layer.type === "frame" && !layer.image)
        issues.push(`${side}의 ${layer.name}: 사진을 넣어 주세요.`)
      if (
        (layer.type === "frame" || layer.type === "image") &&
        layer.image &&
        layer.pixelWidth &&
        layer.pixelHeight &&
        imageDpi(
          design.kind,
          layer.pixelWidth,
          layer.pixelHeight,
          layer.width,
          layer.height,
          layer.imageScale
        ) < minDpi
      )
        issues.push(
          `${side}의 ${layer.name}: 이미지 해상도가 ${minDpi}dpi보다 낮습니다.`
        )
      if (layer.type === "text" && !(layer.text ?? "").trim())
        issues.push(`${side}의 ${layer.name}: 문구가 비어 있습니다.`)
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
