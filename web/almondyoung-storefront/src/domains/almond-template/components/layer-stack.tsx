import type { ReactNode } from "react"
import type { Layer } from "../lib/document"
import { LayerGraphic } from "./graphic"

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
  children,
}: {
  layers: Layer[]
  index: number
  children: ReactNode
}) {
  const holes = knockoutsAbove(layers, index)
  if (!holes.length) return <>{children}</>
  const id = `ko-${layers[index].id}`

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

// 레이어 모양만 한 색으로 칠한 사본. 마스크의 구멍·창으로 쓴다
function silhouette(layer: Layer, fill: string): Layer {
  const stroked = !!layer.stroke && layer.stroke !== "none"

  return {
    ...layer,
    knockout: false,
    filterBypass: false,
    fill,
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

// 필터 무효화 레이어는 자기 모양의 창으로 필터를 뺀 배경과 아래 레이어를 보여 준다.
// 마스크는 클릭 판정을 바꾸지 않으므로 창 내용은 클릭을 받지 않고, 투명한 원래 모양이 클릭을 받는다
function BypassWindow({
  layers,
  index,
  backdrop,
}: {
  layers: Layer[]
  index: number
  backdrop?: ReactNode
}) {
  const layer = layers[index]
  const id = `bypass-${layer.id}`

  return (
    <>
      <defs>
        <FullMask id={id}>
          <LayerGraphic layer={silhouette(layer, "#ffffff")} />
        </FullMask>
      </defs>
      <g mask={`url(#${id})`} pointerEvents="none">
        {backdrop}
        {layers.slice(0, index).map((below) => (
          <LayerGraphic
            key={below.id}
            layer={{ ...below, colorFilter: undefined }}
          />
        ))}
      </g>
      <g opacity={0}>
        <LayerGraphic layer={{ ...layer, filterBypass: false }} />
      </g>
    </>
  )
}

// backdrop 은 필터를 뺀 배경. 필터 무효화 레이어의 창 안에 깔린다
export function StackedLayer({
  layers,
  index,
  backdrop,
}: {
  layers: Layer[]
  index: number
  backdrop?: ReactNode
}) {
  const layer = layers[index]

  return (
    <KnockedOut layers={layers} index={index}>
      {layer.filterBypass && layer.visible !== false ? (
        <BypassWindow layers={layers} index={index} backdrop={backdrop} />
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
}: {
  layers: Layer[]
  backdrop?: ReactNode
}) {
  return (
    <>
      {layers.map((layer, index) => (
        <StackedLayer
          key={layer.id}
          layers={layers}
          index={index}
          backdrop={backdrop}
        />
      ))}
    </>
  )
}
