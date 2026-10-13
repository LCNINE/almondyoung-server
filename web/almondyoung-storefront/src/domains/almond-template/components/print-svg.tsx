import { PRINT_SPECS } from "../lib/catalog"
import { sideBackground, type Design, type Layer } from "../lib/document"
import { Backdrop, LayerGraphic } from "./graphic"

const EDGE_MM = 0.5

export function bleedExtended(
  layer: Layer,
  widthMm: number,
  heightMm: number,
  bleedMm: number
): Layer {
  const fillsBox =
    layer.type === "rect" ||
    layer.type === "image" ||
    (layer.type === "frame" && (layer.frameShape ?? "rect") === "rect")
  if (!bleedMm || !fillsBox || layer.rotation || layer.strokeWidth)
    return layer
  const left = layer.x <= EDGE_MM ? Math.min(layer.x, -bleedMm) : layer.x
  const top = layer.y <= EDGE_MM ? Math.min(layer.y, -bleedMm) : layer.y
  const right =
    layer.x + layer.width >= widthMm - EDGE_MM
      ? Math.max(layer.x + layer.width, widthMm + bleedMm)
      : layer.x + layer.width
  const bottom =
    layer.y + layer.height >= heightMm - EDGE_MM
      ? Math.max(layer.y + layer.height, heightMm + bleedMm)
      : layer.y + layer.height
  return { ...layer, x: left, y: top, width: right - left, height: bottom - top }
}

export async function printSvg(
  design: Design,
  side: "front" | "back",
  bleedMm: number
) {
  const { renderToStaticMarkup } = await import("react-dom/server")
  const width = design.widthMm + bleedMm * 2
  const height = design.heightMm + bleedMm * 2
  const scale = PRINT_SPECS[design.kind].fileScale
  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={`${width * scale}mm`}
      height={`${height * scale}mm`}
      viewBox={`0 0 ${width} ${height}`}
    >
      <Backdrop
        value={sideBackground(design, side)}
        width={width}
        height={height}
      />
      <g transform={`translate(${bleedMm} ${bleedMm})`}>
        {design[side].map((layer) => (
          <LayerGraphic
            key={layer.id}
            layer={bleedExtended(
              layer,
              design.widthMm,
              design.heightMm,
              bleedMm
            )}
          />
        ))}
      </g>
    </svg>
  )
}
