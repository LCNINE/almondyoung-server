import type { Design, Layer } from "./document"
import { SANS_FONT } from "./fonts"

export const mm = (value: number) => Math.round(value * 10) / 10

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
  }[type]
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
  return {
    id: crypto.randomUUID(),
    type,
    name: layerName(type),
    x: mm((design.widthMm - width) / 2),
    y: mm(design.heightMm * 0.3),
    width: mm(width),
    height: mm(
      type === "text"
        ? Math.min(fontSize * 1.2, design.heightMm * 0.15)
        : design.heightMm * 0.2
    ),
    fill: "#202020",
    text: type === "text" ? "문구를 입력하세요" : undefined,
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
