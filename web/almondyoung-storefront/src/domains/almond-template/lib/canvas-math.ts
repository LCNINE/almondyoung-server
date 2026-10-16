import type { Layer } from "./document"
import { mm } from "./layer"
import { photoBox } from "../components/graphic"

export type Box = { x0: number; y0: number; x1: number; y1: number }
export type Guides = { x: number[]; y: number[] }

export function layerBounds(layer: Layer): Box {
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const halfW = (layer.width * cos + layer.height * sin) / 2
  const halfH = (layer.width * sin + layer.height * cos) / 2
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH }
}

export function unionBounds(layers: Layer[]): Box {
  const boxes = layers.map(layerBounds)
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  }
}

function nearest(lines: number[], targets: number[], threshold: number) {
  let best: { shift: number; at: number } | null = null
  for (const line of lines)
    for (const at of targets) {
      const shift = at - line
      if (
        Math.abs(shift) <= threshold &&
        (!best || Math.abs(shift) < Math.abs(best.shift))
      )
        best = { shift, at }
    }
  return best
}

// 옮기는 상자의 시작·가운데·끝이 종이나 다른 요소의 시작·가운데·끝에 threshold 안으로 들어오면 붙인다
export function snapBox(
  moving: Box,
  others: Box[],
  paper: { widthMm: number; heightMm: number },
  threshold: number
) {
  const xs = [0, paper.widthMm / 2, paper.widthMm]
  const ys = [0, paper.heightMm / 2, paper.heightMm]
  for (const b of others) {
    xs.push(b.x0, (b.x0 + b.x1) / 2, b.x1)
    ys.push(b.y0, (b.y0 + b.y1) / 2, b.y1)
  }
  const sx = nearest(
    [moving.x0, (moving.x0 + moving.x1) / 2, moving.x1],
    xs,
    threshold
  )
  const sy = nearest(
    [moving.y0, (moving.y0 + moving.y1) / 2, moving.y1],
    ys,
    threshold
  )
  const dx = sx?.shift ?? 0
  const dy = sy?.shift ?? 0
  const lines = (values: number[], value: number | undefined) =>
    value === undefined
      ? []
      : values.filter((v) => Math.abs(v - value) < 1e-6).slice(0, 1)
  const after = {
    x0: moving.x0 + dx,
    x1: moving.x1 + dx,
    y0: moving.y0 + dy,
    y1: moving.y1 + dy,
  }
  return {
    dx,
    dy,
    guides: {
      x: lines([after.x0, (after.x0 + after.x1) / 2, after.x1], sx?.at),
      y: lines([after.y0, (after.y0 + after.y1) / 2, after.y1], sy?.at),
    } as Guides,
  }
}

// 묶음 상자가 from 에서 to 로 바뀔 때 구성원 각각을 같은 비율로 옮기고 늘린다
export function scaleIntoBox(layer: Layer, from: Box, to: Box) {
  const sx = (to.x1 - to.x0) / Math.max(from.x1 - from.x0, 1e-6)
  const sy = (to.y1 - to.y0) / Math.max(from.y1 - from.y0, 1e-6)
  return {
    x: mm(to.x0 + (layer.x - from.x0) * sx),
    y: mm(to.y0 + (layer.y - from.y0) * sy),
    width: Math.max(1, mm(layer.width * sx)),
    height: Math.max(1, mm(layer.height * sy)),
  }
}

// 지금 보이는 사진 구간을 원본 대비 비율(crop)로 바꾼다. 예전 확대·위치 방식 사진을 자르기 시작할 때 쓴다
export function currentCrop(layer: Layer): NonNullable<Layer["crop"]> {
  if (layer.crop) return layer.crop
  const rect = photoBox(layer)
  const aspect =
    layer.pixelWidth && layer.pixelHeight
      ? layer.pixelWidth / layer.pixelHeight
      : rect.width / rect.height
  const drawnW =
    aspect > rect.width / rect.height ? rect.height * aspect : rect.width
  const drawnH =
    aspect > rect.width / rect.height ? rect.height : rect.width / aspect
  const drawnX = rect.x + (rect.width - drawnW) / 2
  const drawnY = rect.y + (rect.height - drawnH) / 2
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const x = clamp((layer.x - drawnX) / drawnW)
  const y = clamp((layer.y - drawnY) / drawnH)
  return {
    x,
    y,
    w: Math.min(1 - x, layer.width / drawnW),
    h: Math.min(1 - y, layer.height / drawnH),
  }
}

// 자르기: 사진은 제자리에 두고 상자만 바꾼다. 상자는 사진 밖으로 나갈 수 없다
export function cropToBox(
  layer: Layer,
  box: { x: number; y: number; width: number; height: number }
): Partial<Layer> {
  const photo = photoBox({ ...layer, crop: currentCrop(layer) })
  // 사진 끝에서 0.1mm 반올림이 밖으로 넘지 않게 안쪽으로 맞춘다
  const left = Math.ceil(Math.max(box.x, photo.x) * 10 - 1e-6) / 10
  const top = Math.ceil(Math.max(box.y, photo.y) * 10 - 1e-6) / 10
  const right =
    Math.floor(Math.min(box.x + box.width, photo.x + photo.width) * 10 + 1e-6) /
    10
  const bottom =
    Math.floor(
      Math.min(box.y + box.height, photo.y + photo.height) * 10 + 1e-6
    ) / 10
  if (right - left < 1 || bottom - top < 1) return {}
  return {
    x: left,
    y: top,
    width: mm(right - left),
    height: mm(bottom - top),
    crop: {
      x: (left - photo.x) / photo.width,
      y: (top - photo.y) / photo.height,
      w: (right - left) / photo.width,
      h: (bottom - top) / photo.height,
    },
  }
}

// 자르기 중 상자 안을 끌면 상자는 두고 사진을 민다
export function panCrop(layer: Layer, dx: number, dy: number): Partial<Layer> {
  const crop = currentCrop(layer)
  const photo = photoBox({ ...layer, crop })
  return {
    crop: {
      ...crop,
      x: Math.max(0, Math.min(1 - crop.w, crop.x - dx / photo.width)),
      y: Math.max(0, Math.min(1 - crop.h, crop.y - dy / photo.height)),
    },
  }
}
