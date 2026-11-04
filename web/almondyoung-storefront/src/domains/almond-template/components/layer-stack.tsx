import type { ReactNode } from "react"
import { SHAPE_TEXT_TYPES, type Layer } from "../lib/document"
import { LayerGraphic } from "./graphic"
import { ColorFilterDef } from "./style-defs"

// 뚫어내기 글자는 그 아래 레이어 전부에 글자 모양 구멍을 낸다. 위에 있는 레이어는 그대로다
export function knockoutsAbove(layers: Layer[], index: number) {
  return layers
    .slice(index + 1)
    .filter(
      (layer) =>
        layer.type === "text" && layer.knockout && layer.visible !== false
    )
}

const FAR = 100000

function FullMask({ id, children }: { id: string; children: ReactNode }) {
  return (
    <mask
      id={id}
      maskUnits="userSpaceOnUse"
      x={-FAR}
      y={-FAR}
      width={FAR * 2}
      height={FAR * 2}
    >
      {children}
    </mask>
  )
}

function KnockedOut({
  layers,
  index,
  prefix,
  children,
}: {
  layers: Layer[]
  index: number
  prefix: string
  children: ReactNode
}) {
  const holes = knockoutsAbove(layers, index)
  if (!holes.length) return <>{children}</>
  const id = `${prefix}ko-${layers[index].id}`

  return (
    <g mask={`url(#${id})`}>
      <defs>
        <FullMask id={id}>
          <rect
            x={-FAR}
            y={-FAR}
            width={FAR * 2}
            height={FAR * 2}
            fill="#ffffff"
          />
          {holes.map((hole) => (
            <LayerGraphic key={hole.id} layer={silhouette(hole, "#000000")} />
          ))}
        </FullMask>
      </defs>
      {children}
    </g>
  )
}

// 레이어 모양만 한 색으로 칠한 사본. 마스크의 구멍·창으로 쓴다. 가장자리 흐림은 남겨 창 가장자리도 흐려진다
function silhouette(layer: Layer, fill: string): Layer {
  const stroked = !!layer.stroke && layer.stroke !== "none"

  return {
    ...layer,
    knockout: false,
    filterBypass: false,
    fill,
    // 도형 안 글자까지 그리면 창 마스크에 글자 모양 구멍이 난다
    text: SHAPE_TEXT_TYPES.has(layer.type) ? undefined : layer.text,
    image: undefined,
    stroke: stroked ? fill : layer.stroke,
    gradient: undefined,
    colorFilter: undefined,
    blendMode: undefined,
    shadow: false,
    bevel: false,
    texture: false,
  }
}

// 필터를 건 도형은 자기 색을 버리고 그 모양 안의 배경 사진과 아래 레이어에 필터를 건다
export function isFilterWindow(layer: Layer) {
  return (
    SHAPE_TEXT_TYPES.has(layer.type) &&
    !layer.filterBypass &&
    !!layer.colorFilter &&
    layer.colorFilter.amount > 0
  )
}

// backdrop(filtered) 는 배경. filtered 가 false 면 배경 필터를 뺀 원래 사진이다
export type BackdropOf = (filtered: boolean) => ReactNode

// 창 레이어는 자기 모양의 마스크로 아래를 다시 그려 보여 준다.
// 마스크는 클릭 판정을 바꾸지 않으므로 창 내용은 클릭을 받지 않고, 투명한 원래 모양이 클릭을 받는다
function LayerWindow({
  layers,
  index,
  backdrop,
  prefix,
}: {
  layers: Layer[]
  index: number
  backdrop?: BackdropOf
  prefix: string
}) {
  const layer = layers[index]
  const bypass = !!layer.filterBypass
  const id = `${prefix}${bypass ? "bypass" : "window"}-${layer.id}`
  const below = layers.slice(0, index)
  const filterId = `cf-${id}`

  return (
    <>
      <defs>
        <FullMask id={id}>
          <LayerGraphic layer={silhouette(layer, "#ffffff")} />
        </FullMask>
        {!bypass && (
          <ColorFilterDef
            id={filterId}
            filter={layer.colorFilter}
            size={Math.min(layer.width, layer.height)}
          />
        )}
      </defs>
      <g mask={`url(#${id})`} pointerEvents="none">
        {bypass ? (
          <>
            {backdrop?.(false)}
            {below
              .filter((item) => !isFilterWindow(item))
              .map((item) => (
                <LayerGraphic
                  key={item.id}
                  layer={{ ...item, colorFilter: undefined }}
                />
              ))}
          </>
        ) : (
          <g filter={`url(#${filterId})`}>
            {backdrop?.(true)}
            {/* ponytail: 창 안에서 아래 필터 창은 빼고 그린다. 겹친 필터 창끼리 겹쳐 걸리진 않지만, 재귀로 그리면 창 수만큼 지수로 불어난다 */}
            <LayerStack
              layers={below.filter((item) => !isFilterWindow(item))}
              backdrop={backdrop}
              prefix={`${id}-`}
            />
          </g>
        )}
      </g>
      <g opacity={0}>
        <LayerGraphic
          layer={{ ...layer, filterBypass: false, colorFilter: undefined }}
        />
      </g>
    </>
  )
}

// prefix 는 창 안에서 다시 그릴 때 마스크 ID 가 바깥과 겹치지 않게 붙인다
export function StackedLayer({
  layers,
  index,
  backdrop,
  prefix = "",
}: {
  layers: Layer[]
  index: number
  backdrop?: BackdropOf
  prefix?: string
}) {
  const layer = layers[index]
  const windowed =
    layer.visible !== false && (!!layer.filterBypass || isFilterWindow(layer))

  return (
    <KnockedOut layers={layers} index={index} prefix={prefix}>
      {windowed ? (
        <LayerWindow
          layers={layers}
          index={index}
          backdrop={backdrop}
          prefix={prefix}
        />
      ) : (
        <LayerGraphic layer={layer} />
      )}
    </KnockedOut>
  )
}

// 미리보기·썸네일·인쇄 파일처럼 그리기만 하는 곳에서 쓴다
export function LayerStack({
  layers,
  backdrop,
  prefix,
}: {
  layers: Layer[]
  backdrop?: BackdropOf
  prefix?: string
}) {
  return (
    <>
      {layers.map((layer, index) => (
        <StackedLayer
          key={layer.id}
          layers={layers}
          index={index}
          backdrop={backdrop}
          prefix={prefix}
        />
      ))}
    </>
  )
}
