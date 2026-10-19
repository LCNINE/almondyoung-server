import { SHAPE_TEXT_TYPES, type Design, type Layer } from "./document"
import { shapeTextColor } from "../components/graphic"
import { SANS_FONT } from "./fonts"

export const mm = (value: number) => Math.round(value * 10) / 10

// 망고보드 수치(1080px 캔버스 기준 px)를 규격 짧은 변에 비례한 mm 로 바꾸는 배율
export const pxUnit = (design: { widthMm: number; heightMm: number }) =>
  Math.min(design.widthMm, design.heightMm) / 1080

function layerName(type: Layer["type"]) {
  return {
    text: "텍스트",
    rect: "사각형",
    ellipse: "원형",
    image: "이미지",
    triangle: "삼각형",
    line: "선",
    star: "별",
    heart: "하트",
    frame: "모양틀",
    qr: "QR코드",
    clipart: "클립아트",
    path: "펜 도형",
  }[type]
}

// 텍스트 레이어는 문구 첫 줄이 곧 이름이다. 사용자가 이름을 직접 바꾸면 그 뒤로는 따라가지 않는다
export function textLayerName(text = "") {
  return text.trim().split("\n")[0].trim().slice(0, 30) || layerName("text")
}

export function isAutoTextName(layer: Layer) {
  return (
    layer.type === "text" &&
    (layer.name === layerName("text") ||
      layer.name === textLayerName(layer.text))
  )
}

export function makeLayer(type: Layer["type"], design: Design): Layer {
  const fontSize = Math.max(3, mm(design.widthMm / 13))
  if (type === "clipart" || type === "qr") {
    const side =
      Math.min(design.widthMm, design.heightMm) * (type === "qr" ? 0.25 : 0.3)
    return {
      ...makeLayer("rect", design),
      type,
      name: layerName(type),
      x: mm((design.widthMm - side) / 2),
      y: mm((design.heightMm - side) / 2),
      width: mm(side),
      height: mm(side),
    }
  }
  const width = type === "text" ? design.widthMm * 0.8 : design.widthMm * 0.35
  const text = type === "text" ? "문구를 입력하세요" : undefined
  return {
    id: crypto.randomUUID(),
    type,
    name: type === "text" ? textLayerName(text) : layerName(type),
    x: mm((design.widthMm - width) / 2),
    y: mm(design.heightMm * 0.3),
    width: mm(width),
    height: mm(
      type === "text"
        ? Math.min(fontSize * 1.2, design.heightMm * 0.15)
        : design.heightMm * 0.2
    ),
    fill: "#202020",
    text,
    fontSize,
    fontFamily: SANS_FONT,
    opacity: 1,
    strokeWidth: 0,
    align: "left",
    editable: true,
  }
}

export function imageBox(
  design: Design,
  pixelWidth: number,
  pixelHeight: number
) {
  const scale = Math.min(
    (design.widthMm * 0.5) / pixelWidth,
    (design.heightMm * 0.5) / pixelHeight
  )
  const width = pixelWidth * scale
  const height = pixelHeight * scale
  return {
    x: mm((design.widthMm - width) / 2),
    y: mm((design.heightMm - height) / 2),
    width: mm(width),
    height: mm(height),
  }
}

const COLOR_FIELDS = ["fill", "stroke", "textColor"] as const

export function swapColor(layer: Layer, from: string, to: string) {
  const patch: Partial<Layer> = {}
  const shown = {
    ...layer,
    textColor:
      layer.textColor ??
      (SHAPE_TEXT_TYPES.has(layer.type) && layer.text
        ? shapeTextColor(layer)
        : undefined),
  }
  for (const field of COLOR_FIELDS)
    if (shown[field]?.toLowerCase() === from.toLowerCase()) patch[field] = to
  return patch
}

// 앞·뒷면 모든 요소에 patchOf 를 대 보고 바뀌는 것만 새 객체로 만든다. 한 번의 change 라 실행 취소도 한 번이다
export function replaceEverywhere(
  design: Design,
  editable: (layer: Layer) => boolean,
  patchOf: (layer: Layer) => Partial<Layer>
): Design {
  const side = (layers: Layer[]) =>
    layers.map((layer) => {
      if (!editable(layer)) return layer
      const patch = patchOf(layer)
      return Object.keys(patch).length ? { ...layer, ...patch } : layer
    })
  return { ...design, front: side(design.front), back: side(design.back) }
}
