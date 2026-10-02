import type { Design } from "../lib/document"
import { imageSrc } from "../lib/image-ref"
import { LayerGraphic } from "./graphic"

export async function printSvg(
  design: Design,
  side: "front" | "back",
  bleedMm: number
) {
  const { renderToStaticMarkup } = await import("react-dom/server")
  const width = design.widthMm + bleedMm * 2
  const height = design.heightMm + bleedMm * 2
  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={`${width}mm`}
      height={`${height}mm`}
      viewBox={`0 0 ${width} ${height}`}
    >
      <rect width={width} height={height} fill={design.background} />
      {design.backgroundImage && (
        <image
          href={imageSrc(design.backgroundImage)}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid slice"
        />
      )}
      <g transform={`translate(${bleedMm} ${bleedMm})`}>
        {design[side].map((layer) => (
          <LayerGraphic key={layer.id} layer={layer} />
        ))}
      </g>
    </svg>
  )
}
