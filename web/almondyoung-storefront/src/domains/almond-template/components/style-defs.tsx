import type { Layer } from "../lib/document"
import { DEFAULT_FILTER_COLOR, type ColorFilter } from "../lib/layer-style"

export const gradientId = (layer: Layer) => `grad-${layer.id}`
export const colorFilterId = (layer: Layer) => `cf-${layer.id}`

// 글자·도형 자기 상자 기준이라 크기를 바꿔도 색이 같은 비율로 걸친다
export function GradientDef({ layer }: { layer: Layer }) {
  const gradient = layer.gradient
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
    return <radialGradient id={gradientId(layer)}>{stops}</radialGradient>

  return (
    <linearGradient
      id={gradientId(layer)}
      gradientTransform={`rotate(${gradient.angle} .5 .5)`}
    >
      {stops}
    </linearGradient>
  )
}

const RETRO_MATRIX =
  "0.334 0.654 0.161 0 0.06  0.297 0.583 0.143 0 0.05  0.231 0.454 0.111 0 0.08  0 0 0 1 0"

// 톤은 만화처럼 밝기를 검정·흰색 둘로 가른다.
// 고른 색을 레이어 자기 픽셀 위에 그 방식으로 섞고, 세기만큼 원본과 섞는다. 레이어 모양 밖으로는 번지지 않는다
export function ColorFilterDef({
  id,
  filter,
  size,
}: {
  id: string
  filter: ColorFilter | undefined
  size: number
}) {
  if (!filter || filter.amount <= 0) return null
  const a = filter.amount / 100
  const color = filter.color ?? DEFAULT_FILTER_COLOR[filter.kind]
  const mixed = (
    <feComposite
      in="styled"
      in2="SourceGraphic"
      operator="arithmetic"
      k2={a}
      k3={1 - a}
    />
  )
  const inShape = (
    <feComposite in2="SourceAlpha" operator="in" result="styled" />
  )

  return (
    <filter
      id={id}
      x="-50%"
      y="-50%"
      width="200%"
      height="200%"
      colorInterpolationFilters="sRGB"
    >
      {filter.kind === "grayscale" && (
        <feColorMatrix type="saturate" values={String(1 - a)} />
      )}
      {filter.kind === "blur" && (
        <feGaussianBlur stdDeviation={size * 0.15 * a} />
      )}
      {filter.kind === "tone" && (
        <>
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0 1" />
            <feFuncG type="discrete" tableValues="0 1" />
            <feFuncB type="discrete" tableValues="0 1" />
          </feComponentTransfer>
          {inShape}
          {mixed}
        </>
      )}
      {filter.kind === "retro" && (
        <>
          <feColorMatrix type="matrix" values={RETRO_MATRIX} />
          {inShape}
          {mixed}
        </>
      )}
      {filter.kind !== "grayscale" &&
        filter.kind !== "blur" &&
        filter.kind !== "tone" &&
        filter.kind !== "retro" && (
          <>
            <feFlood floodColor={color} result="paint" />
            <feBlend in="paint" in2="SourceGraphic" mode={filter.kind} />
            {inShape}
            {mixed}
          </>
        )}
    </filter>
  )
}
