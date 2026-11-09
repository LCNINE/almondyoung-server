import { MotionMaskGraphic } from "./motion-mask"
import { EffectLayerGraphic } from "./effect-layer"
import { PhotoEffectsGraphic } from "./photo-effects"
import {
  ColorFilterDef,
  GradientDef,
  GradientPaint,
  colorFilterId,
  gradientId,
} from "./style-defs"
import { Fragment, memo, useId } from "react"
import {
  SHAPE_TEXT_TYPES,
  type Design,
  type Layer,
  type SideBackground,
} from "../lib/document"
import { lineDashArray, lineGeometry, lineWidth } from "../lib/line-shape"
import { FRAME_PATHS, LEGACY_CLIPART } from "../lib/art-library"
import { DRAW_ART } from "../lib/draw-art"
import { CLIPART_DATA } from "../lib/clipart-data"
import { useImageSrc } from "../lib/image-previews"
import { fontStack, loadUploadedFont } from "../lib/fonts"
import { useUploadedFont } from "../lib/use-uploaded-font"
import {
  HEART_PATH as heart,
  SHAPE_POINTS as shapePoints,
  STAR as star,
  cornerRadiusMm,
  layerPathData,
  roundableRect,
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

const fontOf = (layer: Layer, px: number) =>
  `${layer.italic ? "italic " : ""}${layer.fontWeight === "bold" ? "bold " : ""}${px}px ${fontStack(layer.fontFamily)}`

// 한 줄의 폭을 글자 크기 1 기준(em)으로 잰다. 브라우저 밖(테스트·SSR)에선 한글 1, 그 외 0.6 어림값
function lineEm(line: string, layer: Layer) {
  const guess = () =>
    Array.from(line).reduce((n, ch) => n + (HANGUL.test(ch) ? 1 : 0.6), 0)
  if (typeof document === "undefined") return guess()
  const font = fontOf(layer, 100)
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

// 텍스트는 상자를 꽉 채운다. 높이가 글자 크기를, 남는 가로 비율이 장평을 정한다
export function stretchText(layer: Layer, box: Partial<Layer>): Partial<Layer> {
  if (layer.type !== "text" || !box.width || !box.height) return box
  const plain = textExtent(layer, false)
  const fontSize = Math.max(1, box.height / plain.height)
  return {
    ...box,
    fontSize: Math.round(fontSize * 100) / 100,
    widthScale:
      Math.round(
        Math.max(
          10,
          Math.min(1000, (box.width / (plain.width * fontSize)) * 100)
        ) * 10
      ) / 10,
  }
}

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, "")

function hasLoadedFace(layer: Layer) {
  const primary = unquote(fontStack(layer.fontFamily).split(",")[0])

  return Array.from(document.fonts).some(
    (face) => unquote(face.family) === primary && face.status === "loaded"
  )
}

// 바깥에서 만든 시안(JSON)은 상자 폭이 글꼴과 안 맞을 수 있다. 글꼴을 받은 뒤 편집기처럼 글자에 맞춘다
export async function fitTextBoxes(design: Design): Promise<Design> {
  const texts = [...design.front, ...design.back].filter(
    (layer) => layer.type === "text" && (layer.fontSize ?? 10) > 0
  )
  // 받지 못한 글꼴의 글상자는 그대로 둔다. 대체 글꼴 폭으로 맞추면 글꼴이 나중에 도착했을 때 다시 어긋난다
  // fonts.check 는 대체 글꼴로도 참이 되므로, 첫 글꼴의 면이 실제로 받아졌는지 본다
  const loaded = new Set(
    (
      await Promise.all(
        texts.map((layer) =>
          Promise.resolve(loadUploadedFont(layer.fontFamily))
            .then(() =>
              document.fonts.load(fontOf(layer, 16), layer.text || undefined)
            )
            .then(() => (hasLoadedFace(layer) ? layer : null))
            .catch(() => null)
        )
      )
    ).filter((layer) => layer !== null)
  )
  measured.clear()

  const fit = (layer: Layer) =>
    loaded.has(layer)
      ? { ...layer, ...textBoxFor(layer, layer.fontSize ?? 10, design) }
      : layer

  return { ...design, front: design.front.map(fit), back: design.back.map(fit) }
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

// 값을 비워 둔 글로우는 크기에 비례한 흰빛이다
export function glowOf(layer: Layer) {
  return {
    style: layer.glowStyle ?? "soft",
    size:
      layer.glowSize ??
      Math.round(Math.max(0.3, effectSize(layer) * 0.12) * 10) / 10,
    color: layer.glowColor ?? "#ffffff",
    opacity: layer.glowOpacity ?? 0.8,
    spread: layer.glowSpread ?? 0,
  }
}

// 빛 한가운데는 하얗게 타 보인다. 고른 색을 흰색 쪽으로 섞어 그 부분을 칠한다
export function hotColor(color: string, amount: number) {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff"
  return `#${[1, 3, 5]
    .map((i) => {
      const value = parseInt(hex.slice(i, i + 2), 16)
      return Math.round(value + (255 - value) * amount)
        .toString(16)
        .padStart(2, "0")
    })
    .join("")}`
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

function TexturePrimitives({ layer }: { layer: Layer }) {
  const size = Math.max(effectSize(layer), 1)
  const paper = layer.textureKind === "paper"
  const amplitude = ((layer.textureAmount ?? 40) / 100) * (paper ? 0.2 : 0.16)

  return (
    <>
      <feTurbulence
        type="fractalNoise"
        baseFrequency={paper ? `${120 / size} ${40 / size}` : 60 / size}
        numOctaves="2"
        seed="3"
        result="textureFine"
        colorInterpolationFilters="sRGB"
      />
      {paper && (
        <>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={4 / size}
            numOctaves="2"
            seed="7"
            result="textureCoarse"
            colorInterpolationFilters="sRGB"
          />
          <feComposite
            in="textureFine"
            in2="textureCoarse"
            operator="arithmetic"
            k2={0.7}
            k3={0.3}
            result="textureNoise"
            colorInterpolationFilters="sRGB"
          />
        </>
      )}
      <feColorMatrix
        in={paper ? "textureNoise" : "textureFine"}
        type="matrix"
        values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 0 1"
        result="textureMono"
        colorInterpolationFilters="sRGB"
      />
      {/* 알파는 마지막에 한 번만 곱해 반투명 채우기와 가장자리를 보존한다. */}
      <feComponentTransfer
        in="SourceGraphic"
        result="textureSource"
        colorInterpolationFilters="sRGB"
      >
        <feFuncA type="table" tableValues="1 1" />
      </feComponentTransfer>
      {/* 0.5 중심의 작은 밝기 차이만 더하므로 흰색에도 어두운 결이 남는다. */}
      <feComposite
        in="textureSource"
        in2="textureMono"
        operator="arithmetic"
        k2={1}
        k3={amplitude}
        k4={-amplitude / 2}
        result="textureColor"
        colorInterpolationFilters="sRGB"
      />
      <feComposite
        in="textureColor"
        in2="SourceAlpha"
        operator="in"
        result="textured"
        colorInterpolationFilters="sRGB"
      />
    </>
  )
}

// 넓게 번진 빛 위에 좁고 진한 빛을 겹쳐야 가장자리가 또렷하게 빛난다. 한 겹이면 뿌연 얼룩처럼 보인다
// 실제 빛처럼 가장자리에 붙은 짧은 번짐 + 중간 번짐 + 멀리 가는 긴 꼬리를 더해 그린다.
// 하나의 블러를 진하게 올리면 띠가 생겨 번진 윤곽선처럼 보인다. 가장자리 가까운 빛은 흰색 쪽으로 밝힌다
function GlowPrimitives({ glow }: { glow: ReturnType<typeof glowOf> }) {
  const { size, spread } = glow
  // 네온관은 빛이 세다. 같은 세기 값에서 바깥 빛을 더 밀어 준다
  const opacity = glow.opacity * (glow.style === "neon" ? 1.35 : 1)
  const base = spread > 0 ? "glowBase" : "SourceAlpha"
  return (
    <>
      {spread > 0 && (
        <feMorphology
          in="SourceAlpha"
          operator="dilate"
          radius={(size * spread) / 100}
          result="glowBase"
        />
      )}
      <feGaussianBlur in={base} stdDeviation={size * 0.12} result="glowA" />
      <feGaussianBlur in={base} stdDeviation={size * 0.45} result="glowB" />
      <feGaussianBlur in={base} stdDeviation={size * 1.4} result="glowC" />
      <feComposite
        in="glowB"
        in2="glowC"
        operator="arithmetic"
        k2={1.1 * opacity}
        k3={2 * opacity}
        result="glowFar"
      />
      <feFlood floodColor={glow.color} />
      <feComposite in2="glowFar" operator="in" result="glowOuter" />
      <feComponentTransfer in="glowA" result="glowNearAlpha">
        <feFuncA type="linear" slope={0.75 * opacity} />
      </feComponentTransfer>
      <feFlood floodColor={hotColor(glow.color, 0.45)} />
      <feComposite in2="glowNearAlpha" operator="in" result="glowInner" />
      <feMerge result="glow">
        <feMergeNode in="glowOuter" />
        <feMergeNode in="glowInner" />
      </feMerge>
      {glow.style === "neon" && <NeonBody glow={glow} />}
    </>
  )
}

// 네온관: 속은 하얗게 달아오르고 안쪽 테두리부터 빛 색이 스며든다. 글자·도형 원래 색 대신 그린다
function NeonBody({ glow }: { glow: ReturnType<typeof glowOf> }) {
  return (
    <>
      <feFlood floodColor={hotColor(glow.color, 0.82)} />
      <feComposite in2="SourceAlpha" operator="in" result="neonCore" />
      <feComponentTransfer in="SourceAlpha" result="neonOutside">
        <feFuncA type="table" tableValues="1 0" />
      </feComponentTransfer>
      <feGaussianBlur
        in="neonOutside"
        stdDeviation={Math.max(0.05, glow.size * 0.28)}
      />
      <feComposite in2="SourceAlpha" operator="in" result="neonRimAlpha" />
      <feFlood floodColor={glow.color} />
      <feComposite in2="neonRimAlpha" operator="in" result="neonRim" />
      <feMerge result="neonBody">
        <feMergeNode in="neonCore" />
        <feMergeNode in="neonRim" />
      </feMerge>
    </>
  )
}

function EffectFilter({
  layer,
  id,
  shadowOnly = false,
}: {
  layer: Layer
  id: string
  shadowOnly?: boolean
}) {
  const size = effectSize(layer)
  const shadow = shadowOf(layer)
  const offset = toLayerSpace(layer, shadow.x, shadow.y)
  const bevel = bevelOf(layer)
  const glow = glowOf(layer)
  const texture = layer.texture && (layer.textureAmount ?? 40) > 0
  // 그림자를 멀리 밀어도 잘리지 않게 필터 영역을 실제 좌표로 넉넉히 잡는다
  const pad =
    (layer.shadow
      ? Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) + shadow.blur * 3
      : 0) +
    (layer.bevel ? bevel.size : 0) +
    (layer.glow ? glow.size * 3.5 + (glow.size * glow.spread) / 100 : 0) +
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
      {layer.glow && <GlowPrimitives glow={glow} />}
      {layer.bevel && <BevelPrimitives layer={layer} />}
      {texture && <TexturePrimitives layer={layer} />}
      <feMerge>
        {layer.shadow && <feMergeNode in="shadow" />}
        {layer.glow && <feMergeNode in="glow" />}
        {!shadowOnly && (
          <feMergeNode
            in={
              layer.glow && glow.style === "neon"
                ? "neonBody"
                : texture
                  ? "textured"
                  : "SourceGraphic"
            }
          />
        )}
        {layer.bevel && <feMergeNode in="bevelSh" />}
        {layer.bevel && <feMergeNode in="bevelHi" />}
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
  if (roundableRect(layer)) {
    const rx = cornerRadiusMm(layer)
    return <rect {...box} rx={rx || undefined} {...paint} />
  }
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
  const shapePhoto =
    layer.imageOffsetMode === "cover" &&
    (layer.type === "frame" || SHAPE_TEXT_TYPES.has(layer.type))
  // shortcut: 원본 크기가 없는 옛 사진은 상자 비율을 쓴다. 전체 이동 범위가 필요하면 원본 크기를 복구한다.
  const aspect =
    shapePhoto && layer.pixelWidth && layer.pixelHeight
      ? layer.pixelWidth / layer.pixelHeight
      : layer.width / layer.height
  const width = Math.max(layer.width, layer.height * aspect) * scale
  const height = Math.max(layer.height, layer.width / aspect) * scale

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

// 사진의 크기에 비례해 번지므로 편집 화면과 출력물의 효과가 같다.
function MotionPhoto({ layer, source }: { layer: Layer; source: string }) {
  const amount = layer.imageMotionBlur ?? 0
  const mix = (layer.imageMotionMix ?? 60) / 100
  const active = amount > 0 && mix > 0
  const id = `motion-${layer.id}`
  const box = photoBox(layer)
  const partial =
    !!layer.imageMotionMask && layer.imageMotionMask.shape !== "full"
  const maskId = `motion-mask-${layer.id}`
  const radius = (layer.width * amount) / 2000

  return (
    <g clipPath={`url(#clip-${layer.id})`}>
      {active && (
        <defs>
          <filter
            id={id}
            filterUnits="userSpaceOnUse"
            x={box.x - radius * 4}
            y={box.y}
            width={box.width + radius * 8}
            height={box.height}
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation={`${radius} 0`}
              edgeMode="duplicate"
              result="blurred"
            />
            <feComposite
              in="blurred"
              in2="SourceGraphic"
              operator="arithmetic"
              k2={mix}
              k3={1 - mix}
            />
          </filter>
        </defs>
      )}
      <MotionMaskGraphic layer={layer} id={maskId} />
      <PhotoEffectsGraphic layer={layer}>
        {active && partial && (
          <image
            href={source}
            {...box}
            filter={layer.imageTint ? `url(#tint-${layer.id})` : undefined}
          />
        )}
        <g mask={active && partial ? `url(#${maskId})` : undefined}>
          <g filter={active ? `url(#${id})` : undefined}>
            <image
              href={source}
              {...box}
              filter={layer.imageTint ? `url(#tint-${layer.id})` : undefined}
            />
          </g>
        </g>
      </PhotoEffectsGraphic>
    </g>
  )
}

function LayerGraphicView({ layer }: { layer: Layer }) {
  const imageSrc = useImageSrc()
  // 올린 글꼴은 늦게 도착하므로, 도착하면 잰 폭을 버리고 이 레이어를 다시 그린다
  const hydrated = useUploadedFont(layer.fontFamily, () => measured.clear())
  if (layer.visible === false) return null
  // 곱하기 그림자는 아래 그림과 섞여야 해서 레이어 묶음 밖에 따로 그린다
  const shadowApart = !!layer.shadow && !!layer.shadowMultiply
  const filterId =
    (layer.shadow && !shadowApart) || layer.glow || layer.texture || layer.bevel
      ? `fx-${layer.id}`
      : undefined
  const edgeBlur = (layer.edgeBlur ?? 0) / 100
  const edgeStd = effectSize(layer) * 0.15 * edgeBlur
  const edgePad =
    edgeStd * 3 + (layer.strokeWidth ?? 0) + Math.max(layer.width, layer.height)
  const cx = layer.x + layer.width / 2,
    cy = layer.y + layer.height / 2
  const transform = `translate(${cx} ${cy}) rotate(${layer.rotation ?? 0}) scale(${layer.flipX ? -1 : 1} ${layer.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
  const fill = layer.gradient ? `url(#${gradientId(layer)})` : layer.fill
  const filtered = (layer.colorFilter?.amount ?? 0) > 0 || (layer.blur ?? 0) > 0
  const paint = {
    fill: layer.fill === "none" ? "none" : fill,
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
  const body = (
    <>
      {layer.type === "effect" && <EffectLayerGraphic layer={layer} />}
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
          <MotionPhoto layer={layer} source={imageSrc(layer.image)} />
        </>
      )}
      {layer.type === "frame" && (
        <>
          <defs>
            <clipPath
              id={`clip-${layer.id}`}
              clipPathUnits={
                layer.imageOffsetMode === "cover"
                  ? "userSpaceOnUse"
                  : "objectBoundingBox"
              }
              transform={
                layer.imageOffsetMode === "cover"
                  ? `translate(${layer.x} ${layer.y}) scale(${layer.width} ${layer.height})`
                  : undefined
              }
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
            <MotionPhoto layer={layer} source={imageSrc(layer.image)} />
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
          transform={
            widthRatio(layer) === 1
              ? undefined
              : `translate(${textAnchorX}) scale(${widthRatio(layer)} 1) translate(${-textAnchorX})`
          }
          stroke={
            layer.stroke && layer.stroke !== "none" && !layer.knockout
              ? layer.stroke
              : undefined
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
          fill={fill}
          // 뚫어내기 글자는 아래 레이어의 구멍으로만 보인다. 투명하게 남겨 두어야 화면에서 잡을 수 있다
          fillOpacity={layer.knockout ? 0 : layer.fillOpacity}
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
    </>
  )
  return (
    <Fragment key={hydrated || !layer.text ? "client" : "server"}>
      {shadowApart && (
        <g
          transform={transform}
          opacity={layer.opacity ?? 1}
          style={{ mixBlendMode: "multiply" }}
          pointerEvents="none"
        >
          <defs>
            <EffectFilter
              layer={{ ...layer, texture: false, bevel: false, glow: false }}
              id={`fx-shadow-${layer.id}`}
              shadowOnly
            />
          </defs>
          <g filter={`url(#fx-shadow-${layer.id})`}>{body}</g>
        </g>
      )}
      <g
        transform={transform}
        opacity={layer.opacity ?? 1}
        style={
          layer.blendMode && layer.blendMode !== "normal"
            ? { mixBlendMode: layer.blendMode }
            : undefined
        }
      >
        <defs>
          {filterId && (
            <EffectFilter
              layer={shadowApart ? { ...layer, shadow: false } : layer}
              id={filterId}
            />
          )}
          <GradientDef layer={layer} />
          <ColorFilterDef
            id={colorFilterId(layer)}
            filter={layer.colorFilter}
            blur={layer.blur}
            preserveAlpha={layer.type === "image" || layer.type === "frame"}
            size={Math.min(layer.width, layer.height)}
          />
          {edgeBlur > 0 && (
            // 높이 0 인 직선도 영역이 생기게 실제 좌표로 넉넉히 잡는다
            <filter
              id={`edge-${layer.id}`}
              filterUnits="userSpaceOnUse"
              x={layer.x - edgePad}
              y={layer.y - edgePad}
              width={layer.width + edgePad * 2}
              height={layer.height + edgePad * 2}
            >
              <feGaussianBlur stdDeviation={edgeStd} />
            </filter>
          )}
        </defs>
        <g filter={edgeBlur > 0 ? `url(#edge-${layer.id})` : undefined}>
          <g filter={filtered ? `url(#${colorFilterId(layer)})` : undefined}>
            <g filter={filterId ? `url(#${filterId})` : undefined}>{body}</g>
          </g>
        </g>
      </g>
    </Fragment>
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
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const filterId = `bg-cf-${uid}`
  const gradientFill = `bg-grad-${uid}`
  const filtered =
    (value.backgroundFilter?.amount ?? 0) > 0 || (value.backgroundBlur ?? 0) > 0

  return (
    <>
      <rect width={width} height={height} fill={value.background} />
      {value.backgroundGradient && (
        <>
          <defs>
            <GradientPaint
              id={gradientFill}
              gradient={value.backgroundGradient}
            />
          </defs>
          <rect width={width} height={height} fill={`url(#${gradientFill})`} />
        </>
      )}
      {value.backgroundImage && (
        <>
          <defs>
            {/* ponytail: 배경 크기를 모르는 곳이 많아 블러 기준을 50mm 로 고정. 큰 현수막에선 약하게 보인다 */}
            <ColorFilterDef
              id={filterId}
              filter={value.backgroundFilter}
              blur={value.backgroundBlur}
              preserveAlpha
              size={50}
            />
          </defs>
          <image
            href={imageSrc(value.backgroundImage)}
            width={width}
            height={height}
            preserveAspectRatio="xMidYMid slice"
            filter={filtered ? `url(#${filterId})` : undefined}
          />
        </>
      )}
    </>
  )
}
