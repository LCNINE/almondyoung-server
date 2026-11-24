import { createElement } from "react"
import { effectPadding } from "../components/graphic"
import { isFilterWindow, LayerStack } from "../components/layer-stack"
import { PRINT_SPECS, type PrintKind } from "./catalog"
import { unionBounds } from "./canvas-math"
import { DRAW_ART } from "./draw-art"
import {
  MAX_IMAGE_FILE_BYTES,
  SHAPE_TEXT_TYPES,
  type Design,
  type Layer,
} from "./document"
import { rasterize } from "./design-images"
import { rememberPreview } from "./image-previews"
import { makeLayer } from "./layer"
import { lineWidth } from "./line-shape"
import type { PathPoint } from "./path-shape"

export function mergeDownReason(
  layers: Layer[],
  id: string,
  mode: "designer" | "customer"
) {
  const index = layers.findIndex((layer) => layer.id === id)
  const upper = layers[index]
  const lower = layers[index - 1]

  if (
    [upper, lower].some(
      (layer) =>
        layer?.type === "text" ||
        (layer && SHAPE_TEXT_TYPES.has(layer.type) && layer.text)
    )
  ) {
    return "텍스트 레이어는 병합할 수 없습니다"
  }

  if (!upper || !lower) {
    return "아래 레이어가 없습니다"
  }

  if ([upper, lower].some((layer) => layer.visible === false)) {
    return "숨긴 레이어는 병합할 수 없습니다"
  }

  if ([upper, lower].some((layer) => layer.locked)) {
    return "잠금을 해제한 뒤 병합해 주세요"
  }

  if (
    [upper, lower].some(
      (layer) =>
        isFilterWindow(layer) ||
        layer.filterBypass ||
        (layer.blendMode && layer.blendMode !== "normal") ||
        layer.shadowMultiply ||
        layer.knockout
    )
  ) {
    return "필터·혼합 모드·뚫기가 걸린 레이어는 병합할 수 없습니다"
  }

  if (
    mode === "customer" &&
    [upper, lower].some((layer) => layer.editable === false)
  ) {
    return "편집할 수 없는 레이어가 있습니다"
  }

  return ""
}

export function mergeBounds(layers: Layer[]) {
  const padded = layers.map((layer) => {
    const art = layer.shapeVariant ? DRAW_ART[layer.shapeVariant] : undefined
    const stroke =
      layer.type === "line"
        ? lineWidth(layer)
        : layer.stroke && layer.stroke !== "none"
          ? (layer.strokeWidth ?? 0)
          : 0
    // SVG 기본 miterlimit(4)과 선 끝모양까지 포함한다.
    let pad = stroke * 2

    if (layer.type === "line") {
      pad +=
        stroke *
        4 *
        Math.max(
          layer.lineStart ? (layer.lineStartSize ?? 1) : 0,
          layer.lineEnd ? (layer.lineEndSize ?? 1) : 0
        )
    }

    if (art?.mode === "stroke") {
      pad += ((art.width ?? 6) / 200) * Math.max(layer.width, layer.height)
    }

    const points: PathPoint[] | undefined =
      layer.type === "path" ? layer.pathPoints : layer.linePath

    for (const point of points ?? []) {
      const xs = [point.x, point.ix ?? point.x, point.ox ?? point.x]
      const ys = [point.y, point.iy ?? point.y, point.oy ?? point.y]

      pad = Math.max(
        pad,
        ...xs.map((x) => Math.max(-x, x - 1, 0) * layer.width + stroke * 2),
        ...ys.map((y) => Math.max(-y, y - 1, 0) * layer.height + stroke * 2)
      )
    }

    if (layer.shadow || layer.glow || layer.bevel || layer.texture) {
      pad += effectPadding(layer)
    }

    pad +=
      Math.min(layer.width, layer.height) *
      0.006 *
      ((layer.edgeBlur ?? 0) + (layer.blur ?? 0))

    return {
      ...layer,
      x: layer.x - pad,
      y: layer.y - pad,
      width: layer.width + pad * 2,
      height: layer.height + pad * 2,
    }
  })
  const box = unionBounds(padded)

  return {
    x: box.x0,
    y: box.y0,
    width: box.x1 - box.x0,
    height: box.y1 - box.y0,
  }
}

export function mergeMaxPx(
  kind: PrintKind,
  box: { width: number; height: number }
) {
  const spec = PRINT_SPECS[kind]
  const longest = Math.max(box.width, box.height)
  const requested = (longest * spec.fileScale * (spec.minImageDpi + 1)) / 25.4
  // ponytail: 긴 변 8,192px·총 1,600만 픽셀 상한. 더 큰 인쇄 원본이 필요하면 서버 렌더링으로 전환한다.
  const ceiling = Math.min(
    8192,
    ((Math.sqrt(16_000_000) - 2) / Math.sqrt(box.width * box.height)) * longest
  )

  return Math.min(Math.ceil(requested), Math.floor(ceiling))
}

export function replaceMergedLayers(
  layers: Layer[],
  upperId: string,
  merged: Layer
) {
  const index = layers.findIndex((layer) => layer.id === upperId)

  if (index < 1) {
    throw new Error("아래 레이어가 없습니다")
  }

  return [...layers.slice(0, index - 1), merged, ...layers.slice(index + 1)]
}

export async function rasterMergedLayer(
  design: Design,
  lower: Layer,
  upper: Layer
): Promise<Layer> {
  const box = mergeBounds([lower, upper])
  const { renderToStaticMarkup } = await import("react-dom/server")
  // shortcut: 혼합·필터는 두 레이어 안에서만 합성한다. 배경까지 보존하려면 전체 합성이 필요하다.
  const markup = renderToStaticMarkup(
    createElement(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: `${box.x} ${box.y} ${box.width} ${box.height}`,
      },
      createElement(LayerStack, { layers: [lower, upper] })
    )
  )
  const canvas = await rasterize(markup, {}, mergeMaxPx(design.kind, box), {
    originals: true,
  })
  const image = canvas.toDataURL("image/png")

  if (!image.startsWith("data:image/png")) {
    throw new Error("병합 이미지를 만들지 못했습니다")
  }

  if (image.length > (MAX_IMAGE_FILE_BYTES * 4) / 3) {
    throw new Error(
      "병합 이미지가 4MB를 넘습니다. 더 작은 범위로 병합해 주세요."
    )
  }

  await rememberPreview(image, canvas)

  return {
    ...makeLayer("image", design),
    ...box,
    name: lower.name,
    image,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    locked: false,
    editable: lower.editable !== false && upper.editable !== false,
    groupId: lower.groupId === upper.groupId ? lower.groupId : undefined,
    groupName:
      lower.groupId && lower.groupId === upper.groupId
        ? lower.groupName
        : undefined,
  }
}
