import type { Layer } from "../lib/document"
import {
  DEFAULT_FILTER_COLOR,
  toneTileSize,
  type ColorFilter,
  type Gradient,
} from "../lib/layer-style"

export const gradientId = (layer: Layer) => `grad-${layer.id}`
export const colorFilterId = (layer: Layer) => `cf-${layer.id}`

// 글자·도형 자기 상자 기준이라 크기를 바꿔도 색이 같은 비율로 걸친다
export function GradientDef({ layer }: { layer: Layer }) {
  return <GradientPaint id={gradientId(layer)} gradient={layer.gradient} />
}

export function GradientPaint({
  id,
  gradient,
}: {
  id: string
  gradient: Gradient | undefined
}) {
  if (!gradient) return null
  const stops = (
    <>
      <stop stopColor={gradient.from} stopOpacity={gradient.fromOpacity} />
      <stop
        offset="1"
        stopColor={gradient.to}
        stopOpacity={gradient.toOpacity}
      />
    </>
  )

  if (gradient.type === "radial")
    return <radialGradient id={id}>{stops}</radialGradient>

  return (
    <linearGradient
      id={id}
      gradientTransform={`rotate(${gradient.angle} .5 .5)`}
    >
      {stops}
    </linearGradient>
  )
}

const RETRO_MATRIX =
  "0.334 0.654 0.161 0 0.06  0.297 0.583 0.143 0 0.05  0.231 0.454 0.111 0 0.08  0 0 0 1 0"

// 중심이 검정이고 모서리가 흰색인 64×64 그레이스케일 방사형 PNG 타일이다.
const TONE_TILE =
  "data:image/png;base64,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"

// 톤은 밝기에 따라 검정 망점 크기를 바꾼다.
// 고른 색을 레이어 자기 픽셀 위에 그 방식으로 섞고, 세기만큼 원본과 섞는다. 레이어 모양 밖으로는 번지지 않는다
export function ColorFilterDef({
  id,
  filter,
  blur = 0,
  preserveAlpha = false,
  size,
}: {
  id: string
  filter: ColorFilter | undefined
  blur?: number
  preserveAlpha?: boolean
  size: number
}) {
  const a = (filter?.amount ?? 0) / 100

  if (a <= 0 && blur <= 0) return null

  const kind = a > 0 ? filter?.kind : undefined
  const color = kind ? (filter?.color ?? DEFAULT_FILTER_COLOR[kind]) : undefined
  const source = blur > 0 ? "blurred" : "SourceGraphic"
  const tileSize = toneTileSize(size, filter?.dotSize)
  const mixed = (
    <feComposite
      in="styled"
      in2={source}
      operator="arithmetic"
      k2={a}
      k3={1 - a}
    />
  )
  const inShape = (
    <feComposite
      in2={blur > 0 ? source : "SourceAlpha"}
      operator="in"
      result="styled"
    />
  )

  return (
    <filter
      id={id}
      x="-50%"
      y="-50%"
      width="200%"
      height="200%"
      primitiveUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      {blur > 0 && (
        <>
          <feGaussianBlur
            stdDeviation={size * 0.15 * (blur / 100)}
            result="blurred"
            edgeMode={preserveAlpha ? "duplicate" : "none"}
          />
          {preserveAlpha && (
            <>
              {/* in 연산만으로는 가장자리에서 줄어든 알파가 복원되지 않는다. */}
              <feComponentTransfer>
                <feFuncA type="linear" slope="0" intercept="1" />
              </feComponentTransfer>
              <feComposite in2="SourceGraphic" operator="in" result="blurred" />
            </>
          )}
        </>
      )}
      {kind === "grayscale" && (
        <feColorMatrix in={source} type="saturate" values={String(1 - a)} />
      )}
      {kind === "tone" && (
        <>
          {/* 좌표를 생략하면 타일 시작점과 반복 영역이 확장된 filter 영역을 따른다. */}
          <feImage
            href={TONE_TILE}
            preserveAspectRatio="none"
            width={tileSize}
            height={tileSize}
            result="toneTile"
          />
          <feTile in="toneTile" result="toneGrid" />
          <feColorMatrix
            in={source}
            type="matrix"
            values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 0 1"
            result="toneLuminance"
          />
          <feComposite
            in="toneLuminance"
            in2="toneGrid"
            operator="arithmetic"
            k2={0.5}
            k3={0.5}
          />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0 1" />
            <feFuncG type="discrete" tableValues="0 1" />
            <feFuncB type="discrete" tableValues="0 1" />
            <feFuncA type="linear" slope="0" intercept="1" />
          </feComponentTransfer>
          {inShape}
          {mixed}
        </>
      )}
      {kind === "retro" && (
        <>
          <feColorMatrix in={source} type="matrix" values={RETRO_MATRIX} />
          {inShape}
          {mixed}
        </>
      )}
      {kind && kind !== "grayscale" && kind !== "tone" && kind !== "retro" && (
        <>
          <feFlood floodColor={color} result="paint" />
          <feBlend in="paint" in2={source} mode={kind} />
          {inShape}
          {mixed}
        </>
      )}
    </filter>
  )
}
