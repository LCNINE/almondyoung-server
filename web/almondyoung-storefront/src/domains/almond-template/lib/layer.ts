import type { Design, Layer } from "./document"

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
  const width = type === "text" ? design.widthMm * 0.55 : design.widthMm * 0.35
  return {
    id: crypto.randomUUID(),
    type,
    name: layerName(type),
    x: mm((design.widthMm - width) / 2),
    y: mm(design.heightMm * 0.3),
    width: mm(width),
    height: mm(
      type === "text"
        ? Math.min(30, design.heightMm * 0.15)
        : design.heightMm * 0.2
    ),
    fill: "#202020",
    text: type === "text" ? "문구를 입력하세요" : undefined,
    fontSize: Math.max(3, mm(design.widthMm / 13)),
    fontFamily: "Arial, sans-serif",
    opacity: 1,
    strokeWidth: 0,
    align: "left",
    editable: true,
  }
}
