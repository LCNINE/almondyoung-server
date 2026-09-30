import { memo } from "react"
import type { Layer } from "../lib/document"
import { FRAME_PATHS, LEGACY_CLIPART } from "../lib/art-library"
import { CLIPART_DATA } from "../lib/clipart-data"
import { imageSrc } from "../lib/image-ref"

export function fittedFontSize(layer: Layer) {
  const lines = (layer.text ?? "").split("\n")
  const longest = Math.max(
    1,
    ...lines.map((line) =>
      Array.from(line).reduce(
        (n, ch) => n + (/[\uac00-\ud7af]/.test(ch) ? 1 : 0.6),
        0
      )
    )
  )
  return Math.max(
    1,
    Math.min(
      layer.fontSize ?? 10,
      layer.width / (longest * ((layer.widthScale ?? 100) / 100)),
      layer.height / (lines.length * ((layer.lineHeight ?? 120) / 100))
    )
  )
}

function polygonPoints(layer: Layer, points: number[][]) {
  return points
    .map(
      ([x, y]) => `${layer.x + x * layer.width},${layer.y + y * layer.height}`
    )
    .join(" ")
}

const star = [
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
const heart =
  "M .5 .95 C .38 .83 0 .55 0 .3 C 0 .02 .35 -.07 .5 .18 C .65 -.07 1 .02 1 .3 C 1 .55 .62 .83 .5 .95 Z"
const shapePoints: Record<string, number[][]> = {
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

function LayerGraphicView({ layer }: { layer: Layer }) {
  if (layer.visible === false) return null
  const cx = layer.x + layer.width / 2,
    cy = layer.y + layer.height / 2
  const transform = `translate(${cx} ${cy}) rotate(${layer.rotation ?? 0}) scale(${layer.flipX ? -1 : 1} ${layer.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
  const paint = {
    fill: layer.fill,
    stroke: layer.stroke ?? "none",
    strokeWidth: layer.strokeWidth ?? 0,
  }
  const line = fittedFontSize(layer)
  const shape = layer.frameShape ?? "rect"
  const qrSize = layer.qrSize ?? 0
  const imageScale = layer.imageScale ?? 1
  const imageWidth = layer.width * imageScale,
    imageHeight = layer.height * imageScale
  const imageX =
    layer.x - (imageWidth - layer.width) * (layer.imageOffsetX ?? 0.5)
  const imageY =
    layer.y - (imageHeight - layer.height) * (layer.imageOffsetY ?? 0.5)
  const clipartSource =
    CLIPART_DATA[LEGACY_CLIPART[layer.clipartId ?? ""] ?? layer.clipartId ?? ""]
  return (
    <g transform={transform} opacity={layer.opacity ?? 1}>
      {layer.type === "rect" && layer.shapeVariant === "rounded" && (
        <rect
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          rx={Math.min(layer.width, layer.height) * 0.16}
          {...paint}
        />
      )}
      {layer.type === "rect" &&
        layer.shapeVariant &&
        shapePoints[layer.shapeVariant] && (
          <polygon
            points={polygonPoints(layer, shapePoints[layer.shapeVariant])}
            {...paint}
          />
        )}
      {layer.type === "rect" && !layer.shapeVariant && (
        <rect
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          {...paint}
        />
      )}
      {layer.type === "clipart" && clipartSource && (
        <image
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          href={clipartSource}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {layer.type === "ellipse" && (
        <ellipse
          cx={cx}
          cy={cy}
          rx={layer.width / 2}
          ry={layer.height / 2}
          {...paint}
        />
      )}
      {layer.type === "triangle" && (
        <polygon
          points={polygonPoints(layer, [
            [0.5, 0],
            [1, 1],
            [0, 1],
          ])}
          {...paint}
        />
      )}
      {layer.type === "star" && (
        <polygon points={polygonPoints(layer, star)} {...paint} />
      )}
      {layer.type === "line" && (
        <line
          x1={layer.x}
          y1={cy}
          x2={layer.x + layer.width}
          y2={cy}
          stroke={layer.stroke ?? layer.fill}
          strokeWidth={Math.max(0.3, layer.strokeWidth ?? 1)}
        />
      )}
      {layer.type === "heart" && (
        <path
          d={heart}
          transform={`translate(${layer.x} ${layer.y}) scale(${layer.width} ${layer.height})`}
          {...paint}
          strokeWidth={
            (layer.strokeWidth ?? 0) / Math.max(layer.width, layer.height)
          }
        />
      )}
      {layer.type === "image" && layer.image && (
        <>
          <defs>
            <clipPath id={`clip-${layer.id}`}>
              <rect
                x={layer.x}
                y={layer.y}
                width={layer.width}
                height={layer.height}
              />
            </clipPath>
          </defs>
          <image
            href={imageSrc(layer.image)}
            x={imageX}
            y={imageY}
            width={imageWidth}
            height={imageHeight}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#clip-${layer.id})`}
          />
        </>
      )}
      {layer.type === "frame" && (
        <>
          <defs>
            <clipPath id={`clip-${layer.id}`} clipPathUnits="objectBoundingBox">
              {shape === "ellipse" ? (
                <ellipse cx=".5" cy=".5" rx=".5" ry=".5" />
              ) : FRAME_PATHS[shape] ? (
                <path d={FRAME_PATHS[shape]} transform="scale(0.01)" />
              ) : shape === "star" ? (
                <polygon points={star.map((p) => p.join(",")).join(" ")} />
              ) : shape === "heart" ? (
                <path d={heart} />
              ) : (
                <rect width="1" height="1" />
              )}
            </clipPath>
          </defs>
          <rect
            x={layer.x}
            y={layer.y}
            width={layer.width}
            height={layer.height}
            fill="#e7e7e7"
            clipPath={`url(#clip-${layer.id})`}
          />
          {layer.image ? (
            <image
              href={imageSrc(layer.image)}
              x={imageX}
              y={imageY}
              width={imageWidth}
              height={imageHeight}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#clip-${layer.id})`}
            />
          ) : (
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#777"
              fontSize={Math.min(layer.width / 6, layer.height / 6)}
            >
              이미지 넣기
            </text>
          )}
        </>
      )}
      {layer.type === "qr" && qrSize > 0 && layer.qrBits && (
        <>
          <rect
            x={layer.x}
            y={layer.y}
            width={layer.width}
            height={layer.height}
            fill="white"
          />
          {Array.from(layer.qrBits).map((bit, i) =>
            bit === "1" ? (
              <rect
                key={i}
                x={layer.x + (((i % qrSize) + 4) * layer.width) / (qrSize + 8)}
                y={
                  layer.y +
                  ((Math.floor(i / qrSize) + 4) * layer.height) / (qrSize + 8)
                }
                width={layer.width / (qrSize + 8) + 0.01}
                height={layer.height / (qrSize + 8) + 0.01}
                fill={layer.fill}
              />
            ) : null
          )}
        </>
      )}
      {layer.type === "text" && (
        <text
          x={
            layer.align === "center"
              ? cx
              : layer.align === "right"
                ? layer.x + layer.width
                : layer.x
          }
          y={layer.y + line}
          textAnchor={
            layer.align === "center"
              ? "middle"
              : layer.align === "right"
                ? "end"
                : "start"
          }
          fill={layer.fill}
          fontSize={line}
          fontFamily={layer.fontFamily ?? "Arial, sans-serif"}
          fontWeight={layer.fontWeight ?? "normal"}
          fontStyle={layer.italic ? "italic" : "normal"}
          letterSpacing={layer.letterSpacing ?? 0}
          style={{ whiteSpace: "pre" }}
        >
          {(layer.text ?? "").split("\n").map((row, i) => (
            <tspan
              key={i}
              x={
                layer.align === "center"
                  ? cx
                  : layer.align === "right"
                    ? layer.x + layer.width
                    : layer.x
              }
              dy={i ? line * ((layer.lineHeight ?? 120) / 100) : 0}
            >
              {row}
            </tspan>
          ))}
        </text>
      )}
    </g>
  )
}

export const LayerGraphic = memo(LayerGraphicView)
