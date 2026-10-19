import { Fragment, memo } from "react"
import {
  SHAPE_TEXT_TYPES,
  type Layer,
  type SideBackground,
} from "../lib/document"
import { lineDashArray, lineGeometry, lineWidth } from "../lib/line-shape"
import { FRAME_PATHS, LEGACY_CLIPART } from "../lib/art-library"
import { DRAW_ART } from "../lib/draw-art"
import { CLIPART_DATA } from "../lib/clipart-data"
import { useImageSrc } from "../lib/image-previews"
import { fontStack } from "../lib/fonts"
import { useUploadedFont } from "../lib/use-uploaded-font"
import {
  HEART_PATH as heart,
  SHAPE_POINTS as shapePoints,
  STAR as star,
  layerPathData,
  starOf,
} from "../lib/path-shape"

const widthRatio = (layer: Layer) =>
  Math.max(10, Math.min(1000, layer.widthScale || 100)) / 100

const HANGUL = /[\uac00-\ud7af]/
let measurer: CanvasRenderingContext2D | null | undefined
const measured = new Map<string, number>()
if (typeof document !== "undefined")
  // 웹폰트가 늦게 도착하면 대체 글꼴로 잰 값을 버린다
  document.fonts?.addEventListener("loadingdone", () => measured.clear())

// 한 줄의 폭을 글자 크기 1 기준(em)으로 잰다. 브라우저 밖(테스트·SSR)에선 한글 1, 그 외 0.6 어림값
function lineEm(line: string, layer: Layer) {
  const guess = () =>
    Array.from(line).reduce((n, ch) => n + (HANGUL.test(ch) ? 1 : 0.6), 0)
  if (typeof document === "undefined") return guess()
  const font = `${layer.italic ? "italic " : ""}${layer.fontWeight === "bold" ? "bold " : ""}100px ${fontStack(layer.fontFamily)}`
  const key = `${font}\u0000${line}`
  const hit = measured.get(key)
  if (hit !== undefined) return hit
  measurer ??= document.createElement("canvas").getContext("2d")
  if (!measurer) return guess()
  measurer.font = font
  const em = measurer.measureText(line).width / 100
  measured.set(key, em)
  return em
}

export function textExtent(layer: Layer, stretched = true) {
  const lines = (layer.text ?? "").split("\n")
  const longest = Math.max(0.5, ...lines.map((line) => lineEm(line, layer)))
  return {
    width: longest * (stretched ? widthRatio(layer) : 1),
    height: lines.length * ((layer.lineHeight ?? 120) / 100),
  }
}

export function fittedFontSize(layer: Layer) {
  const extent = textExtent(layer)
  return Math.max(
    1,
    Math.min(
      layer.fontSize ?? 10,
      layer.width / extent.width,
      layer.height / extent.height
    )
  )
}

const ceil = (value: number) => Math.ceil(value * 10 - 1e-6) / 10

// 상자를 글자 크기에 딱 맞춘다. 정렬 기준(왼쪽·가운데·오른쪽) 자리는 그대로 둔다
export function textBoxFor(
  layer: Layer,
  fontSize: number,
  paper: { widthMm: number; heightMm: number }
) {
  const extent = textExtent(layer)
  const width = Math.min(paper.widthMm * 2, ceil(extent.width * fontSize))
  const shift =
    layer.align === "center"
      ? (layer.width - width) / 2
      : layer.align === "right"
        ? layer.width - width
        : 0
  return {
    fontSize,
    x: Math.round((layer.x + shift) * 10) / 10,
    width,
    height: Math.min(paper.heightMm * 2, ceil(extent.height * fontSize)),
  }
}

function polygonPoints(layer: Layer, points: number[][]) {
  return points
    .map(
      ([x, y]) => `${layer.x + x * layer.width},${layer.y + y * layer.height}`
    )
    .join(" ")
}

const effectSize = (layer: Layer) =>
  layer.type === "text"
    ? fittedFontSize(layer)
    : Math.min(layer.width, layer.height)

// 값을 비워 둔 그림자는 예전처럼 크기에 비례한 오른쪽 아래 그림자다
export function shadowOf(layer: Layer) {
  const offset = Math.max(0.2, effectSize(layer) * 0.06)
  return {
    x: layer.shadowX ?? Math.round(offset * 10) / 10,
    y: layer.shadowY ?? Math.round(offset * 10) / 10,
    blur: layer.shadowBlur ?? Math.round(offset * 6) / 10,
    color: layer.shadowColor ?? "#000000",
    opacity: layer.shadowOpacity ?? 0.35,
  }
}

export function bevelOf(layer: Layer) {
  return {
    size:
      layer.bevelSize ??
      Math.round(Math.max(0.2, effectSize(layer) * 0.05) * 10) / 10,
    depth: layer.bevelDepth ?? 60,
    angle: layer.bevelAngle ?? 135,
  }
}

// 필터는 회전·반전한 도형 안쪽 좌표로 그려진다. 그림자·빛 방향은 화면 기준이어야 하니 거꾸로 돌려 둔다
function toLayerSpace(layer: Layer, dx: number, dy: number) {
  const rad = (-(layer.rotation ?? 0) * Math.PI) / 180
  return {
    dx: (dx * Math.cos(rad) - dy * Math.sin(rad)) * (layer.flipX ? -1 : 1),
    dy: (dx * Math.sin(rad) + dy * Math.cos(rad)) * (layer.flipY ? -1 : 1),
  }
}

// 입체는 조명 필터 대신 흐린 윤곽을 빛 쪽·반대쪽으로 민 차이로 만든다.
// 조명 필터는 화면 픽셀 단위로 기울기를 재서 확대율·인쇄 해상도마다 세기가 달라진다
function BevelPrimitives({ layer }: { layer: Layer }) {
  const { size, depth, angle } = bevelOf(layer)
  const rad = (angle * Math.PI) / 180
  const { dx: lx, dy: ly } = toLayerSpace(
    layer,
    Math.cos(rad) * size * 0.6,
    -Math.sin(rad) * size * 0.6
  )
  const k = depth / 50
  return (
    <>
      <feGaussianBlur in="SourceAlpha" stdDeviation={size} result="bevelBlur" />
      <feOffset in="bevelBlur" dx={lx} dy={ly} result="bevelLit" />
      <feOffset in="bevelBlur" dx={-lx} dy={-ly} result="bevelDark" />
      {(
        [
          ["bevelLit", "bevelDark", "#ffffff", "bevelHi"],
          ["bevelDark", "bevelLit", "#000000", "bevelSh"],
        ] as const
      ).map(([a, b, tone, result]) => (
        <Fragment key={result}>
          <feComposite
            in={a}
            in2={b}
            operator="arithmetic"
            k2={k}
            k3={-k}
            result={`${result}Mask`}
          />
          <feFlood floodColor={tone} />
          <feComposite in2={`${result}Mask`} operator="in" />
          <feComposite in2="SourceAlpha" operator="in" result={result} />
        </Fragment>
      ))}
    </>
  )
}

function EffectFilter({ layer, id }: { layer: Layer; id: string }) {
  const size = effectSize(layer)
  const shadow = shadowOf(layer)
  const offset = toLayerSpace(layer, shadow.x, shadow.y)
  const bevel = bevelOf(layer)
  // 그림자를 멀리 밀어도 잘리지 않게 필터 영역을 실제 좌표로 넉넉히 잡는다
  const pad =
    (layer.shadow
      ? Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) + shadow.blur * 3
      : 0) +
    (layer.bevel ? bevel.size : 0) +
    (layer.strokeWidth ?? 0) +
    Math.max(1, size * 0.2)
  return (
    <filter
      id={id}
      filterUnits="userSpaceOnUse"
      x={layer.x - pad}
      y={layer.y - pad}
      width={layer.width + pad * 2}
      height={layer.height + pad * 2}
    >
      {layer.shadow && (
        <>
          <feGaussianBlur in="SourceAlpha" stdDeviation={shadow.blur} />
          <feOffset dx={offset.dx} dy={offset.dy} result="offset" />
          <feFlood floodColor={shadow.color} floodOpacity={shadow.opacity} />
          <feComposite in2="offset" operator="in" result="shadow" />
        </>
      )}
      {layer.bevel && <BevelPrimitives layer={layer} />}
      {layer.texture && (
        <>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={Math.max(0.05, 60 / Math.max(size, 1)) / 4}
            numOctaves="2"
            seed="3"
            result="noise"
          />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.1"
            result="speckle"
          />
          <feComposite
            in="speckle"
            in2="SourceGraphic"
            operator="in"
            result="grain"
          />
        </>
      )}
      <feMerge>
        {layer.shadow && <feMergeNode in="shadow" />}
        <feMergeNode in="SourceGraphic" />
        {layer.bevel && <feMergeNode in="bevelSh" />}
        {layer.bevel && <feMergeNode in="bevelHi" />}
        {layer.texture && <feMergeNode in="grain" />}
      </feMerge>
    </filter>
  )
}

export function shapeTextColor(layer: Layer) {
  if (layer.textColor) return layer.textColor
  const hex = /^#[0-9a-f]{6}$/i.test(layer.fill) ? layer.fill : "#ffffff"
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return r * 0.299 + g * 0.587 + b * 0.114 < 140 ? "#ffffff" : "#202020"
}

function ShapeText({ layer }: { layer: Layer }) {
  const rows = (layer.text ?? "").split("\n")
  const inner = {
    ...layer,
    width: layer.width * 0.84,
    height: layer.height * 0.84,
  }
  const size = fittedFontSize(inner)
  const step = size * ((layer.lineHeight ?? 120) / 100)
  const cx = layer.x + layer.width / 2
  const top =
    layer.y + layer.height / 2 - (step * (rows.length - 1)) / 2 + size * 0.35
  return (
    <text
      textAnchor="middle"
      fill={shapeTextColor(layer)}
      fontSize={size}
      fontFamily={fontStack(layer.fontFamily)}
      fontWeight={layer.fontWeight ?? "normal"}
      fontStyle={layer.italic ? "italic" : "normal"}
      style={{ whiteSpace: "pre" }}
    >
      {rows.map((row, i) => (
        <tspan key={i} x={cx} y={top + step * i}>
          {row}
        </tspan>
      ))}
    </text>
  )
}

type Paint = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  strokeDasharray?: string
  strokeLinecap?: "butt" | "round"
  strokeLinejoin?: "miter" | "round"
}

// 글자 테두리는 예전부터 둥근 모서리였으므로 각지게를 고른 때(false)만 각지게 그린다
type StrokeShape = Pick<Layer, "type" | "strokeRound" | "strokeDash">

export const strokeRounded = (layer: StrokeShape) =>
  layer.type === "text" ? layer.strokeRound !== false : !!layer.strokeRound

// 점선 간격은 선 두께에 비례한다. 점선은 끝이 둥글어야 점으로 보인다
export function strokeStyle(layer: StrokeShape, width: number): Paint {
  const round = strokeRounded(layer) || layer.strokeDash === "dotted"
  return {
    strokeDasharray: !width
      ? undefined
      : layer.strokeDash === "dashed"
        ? `${mmRound(width * 3)} ${mmRound(width * 2)}`
        : layer.strokeDash === "dotted"
          ? `0 ${mmRound(width * 2)}`
          : undefined,
    strokeLinecap: round ? "round" : "butt",
    strokeLinejoin: strokeRounded(layer) ? "round" : "miter",
  }
}

const mmRound = (value: number) => Math.round(value * 1000) / 1000

// 색을 칠하는 도형의 윤곽. 사진을 넣으면 같은 윤곽이 사진의 잘라내기 틀이 된다
function ShapeBody({ layer, paint }: { layer: Layer; paint: Paint }) {
  const box = {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
  }
  const variant = layer.shapeVariant
  // 상자 크기로 늘린 패스는 선 두께·점선 간격도 같이 늘어나므로 미리 줄여 둔다
  const scaled = (unit: number): Paint => {
    if (paint.strokeWidth === undefined) return paint
    const width =
      (paint.strokeWidth * unit) / Math.max(layer.width, layer.height)
    return {
      ...paint,
      strokeWidth: width,
      ...(paint.strokeDasharray ? strokeStyle(layer, width) : {}),
    }
  }
  if (layer.type === "rect" && variant === "rounded")
    return (
      <rect
        {...box}
        rx={Math.min(layer.width, layer.height) * 0.16}
        {...paint}
      />
    )
  const art = variant ? DRAW_ART[variant] : undefined
  if (layer.type === "rect" && art) {
    return (
      <path
        d={art.d}
        transform={`translate(${layer.x} ${layer.y}) scale(${layer.width / 100} ${layer.height / 100})`}
        {...(art.mode === "fill"
          ? scaled(100)
          : {
              fill: "none",
              stroke: paint.fill,
              strokeWidth: art.width ?? 6,
              strokeDasharray: art.dash,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            })}
      />
    )
  }
  if (layer.type === "rect" && variant && shapePoints[variant])
    return (
      <polygon points={polygonPoints(layer, shapePoints[variant])} {...paint} />
    )
  if (layer.type === "rect" && variant && FRAME_PATHS[variant])
    return (
      <path
        d={FRAME_PATHS[variant]}
        transform={`translate(${layer.x} ${layer.y}) scale(${layer.width / 100} ${layer.height / 100})`}
        {...scaled(100)}
      />
    )
  if (layer.type === "rect") return <rect {...box} {...paint} />
  if (layer.type === "ellipse")
    return (
      <ellipse
        cx={layer.x + layer.width / 2}
        cy={layer.y + layer.height / 2}
        rx={layer.width / 2}
        ry={layer.height / 2}
        {...paint}
      />
    )
  if (layer.type === "triangle")
    return (
      <polygon
        points={polygonPoints(layer, [
          [0.5, 0],
          [1, 1],
          [0, 1],
        ])}
        {...paint}
      />
    )
  if (layer.type === "star")
    return <polygon points={polygonPoints(layer, starOf(layer))} {...paint} />
  if (layer.type === "heart")
    return (
      <path
        d={heart}
        transform={`translate(${layer.x} ${layer.y}) scale(${layer.width} ${layer.height})`}
        {...scaled(1)}
      />
    )
  if (layer.type === "path") return <path d={layerPathData(layer)} {...paint} />
  return null
}

// 사진이 놓일 자리. crop 이 있으면 원본의 그 구간이 상자에 그대로 맞고, 없으면 예전 확대·위치 방식이다
export function photoBox(layer: Layer) {
  const crop = layer.crop
  if (crop) {
    const width = layer.width / crop.w
    const height = layer.height / crop.h
    return {
      x: layer.x - crop.x * width,
      y: layer.y - crop.y * height,
      width,
      height,
      preserveAspectRatio: "none",
    }
  }
  const scale = layer.imageScale ?? 1
  const width = layer.width * scale
  const height = layer.height * scale
  return {
    x: layer.x - (width - layer.width) * (layer.imageOffsetX ?? 0.5),
    y: layer.y - (height - layer.height) * (layer.imageOffsetY ?? 0.5),
    width,
    height,
    preserveAspectRatio: "xMidYMid slice",
  }
}

// 색 입히기: 그림의 모양(투명도)은 그대로 두고 칠한 부분만 고른 한 색으로 바꾼다. 로고·아이콘용
function TintFilter({ layer }: { layer: Layer }) {
  if (!layer.imageTint) return null
  return (
    <defs>
      <filter
        id={`tint-${layer.id}`}
        x="0"
        y="0"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feFlood floodColor={layer.imageTint} />
        <feComposite in2="SourceAlpha" operator="in" />
      </filter>
    </defs>
  )
}

function LayerGraphicView({ layer }: { layer: Layer }) {
  const imageSrc = useImageSrc()
  // 올린 글꼴은 늦게 도착하므로, 도착하면 잰 폭을 버리고 이 레이어를 다시 그린다
  useUploadedFont(layer.fontFamily, () => measured.clear())
  if (layer.visible === false) return null
  const filterId =
    layer.shadow || layer.texture || layer.bevel ? `fx-${layer.id}` : undefined
  const cx = layer.x + layer.width / 2,
    cy = layer.y + layer.height / 2
  const transform = `translate(${cx} ${cy}) rotate(${layer.rotation ?? 0}) scale(${layer.flipX ? -1 : 1} ${layer.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
  const paint = {
    fill: layer.fill,
    stroke: layer.stroke ?? "none",
    strokeWidth: layer.strokeWidth ?? 0,
    ...strokeStyle(layer, layer.strokeWidth ?? 0),
  }
  const line = fittedFontSize(layer)
  const textAnchorX =
    layer.align === "center"
      ? cx
      : layer.align === "right"
        ? layer.x + layer.width
        : layer.x
  const shape = layer.frameShape ?? "rect"
  const qrSize = layer.qrSize ?? 0
  const clipartSource =
    CLIPART_DATA[LEGACY_CLIPART[layer.clipartId ?? ""] ?? layer.clipartId ?? ""]
  return (
    <g transform={transform} opacity={layer.opacity ?? 1}>
      {filterId && (
        <defs>
          <EffectFilter layer={layer} id={filterId} />
        </defs>
      )}
      <g filter={filterId ? `url(#${filterId})` : undefined}>
        {SHAPE_TEXT_TYPES.has(layer.type) && (
          <ShapeBody layer={layer} paint={paint} />
        )}
        {SHAPE_TEXT_TYPES.has(layer.type) && layer.image && (
          <>
            <defs>
              <clipPath id={`clip-${layer.id}`}>
                <ShapeBody layer={layer} paint={{}} />
              </clipPath>
            </defs>
            <image
              href={imageSrc(layer.image)}
              {...photoBox(layer)}
              clipPath={`url(#clip-${layer.id})`}
            />
            {paint.stroke !== "none" && paint.strokeWidth > 0 && (
              <ShapeBody layer={layer} paint={{ ...paint, fill: "none" }} />
            )}
          </>
        )}
        {layer.type === "clipart" && clipartSource && (
          <>
            <TintFilter layer={layer} />
            <image
              x={layer.x}
              y={layer.y}
              width={layer.width}
              height={layer.height}
              href={clipartSource}
              preserveAspectRatio="xMidYMid meet"
              filter={layer.imageTint ? `url(#tint-${layer.id})` : undefined}
            />
          </>
        )}
        {layer.type === "line" &&
          (() => {
            const width = lineWidth(layer)
            const color = layer.stroke ?? layer.fill
            const { d, caps } = lineGeometry(layer)
            return (
              <>
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={width}
                  strokeDasharray={lineDashArray(layer)}
                  strokeLinecap={layer.strokeRound ? "round" : "square"}
                  strokeLinejoin={layer.strokeRound ? "round" : "miter"}
                />
                {caps.map((cap, index) => (
                  <path
                    key={index}
                    d={cap.d}
                    fill={cap.filled ? color : "none"}
                    stroke={cap.stroked ? color : "none"}
                    strokeWidth={cap.stroked ? width : undefined}
                    strokeLinejoin="miter"
                  />
                ))}
              </>
            )
          })()}
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
            <TintFilter layer={layer} />
            <image
              href={imageSrc(layer.image)}
              {...photoBox(layer)}
              clipPath={`url(#clip-${layer.id})`}
              filter={layer.imageTint ? `url(#tint-${layer.id})` : undefined}
            />
          </>
        )}
        {layer.type === "frame" && (
          <>
            <defs>
              <clipPath
                id={`clip-${layer.id}`}
                clipPathUnits="objectBoundingBox"
              >
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
                {...photoBox(layer)}
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
                  x={
                    layer.x + (((i % qrSize) + 4) * layer.width) / (qrSize + 8)
                  }
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
            transform={
              widthRatio(layer) === 1
                ? undefined
                : `translate(${textAnchorX}) scale(${widthRatio(layer)} 1) translate(${-textAnchorX})`
            }
            stroke={
              layer.stroke && layer.stroke !== "none" ? layer.stroke : undefined
            }
            strokeWidth={
              layer.stroke && layer.stroke !== "none"
                ? (layer.strokeWidth ?? 0)
                : undefined
            }
            strokeLinejoin={strokeRounded(layer) ? "round" : "miter"}
            paintOrder="stroke"
            x={textAnchorX}
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
            fontFamily={fontStack(layer.fontFamily)}
            fontWeight={layer.fontWeight ?? "normal"}
            fontStyle={layer.italic ? "italic" : "normal"}
            letterSpacing={layer.letterSpacing ?? 0}
            style={{ whiteSpace: "pre" }}
          >
            {(layer.text ?? "").split("\n").map((row, i) => (
              <tspan
                key={i}
                x={textAnchorX}
                dy={i ? line * ((layer.lineHeight ?? 120) / 100) : 0}
              >
                {row}
              </tspan>
            ))}
          </text>
        )}
        {SHAPE_TEXT_TYPES.has(layer.type) && layer.text && (
          <ShapeText layer={layer} />
        )}
      </g>
    </g>
  )
}

export const LayerGraphic = memo(LayerGraphicView)

export function Backdrop({
  value,
  width = "100%",
  height = "100%",
}: {
  value: SideBackground
  width?: number | string
  height?: number | string
}) {
  const imageSrc = useImageSrc()
  return (
    <>
      <rect width={width} height={height} fill={value.background} />
      {value.backgroundImage && (
        <image
          href={imageSrc(value.backgroundImage)}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid slice"
        />
      )}
    </>
  )
}
