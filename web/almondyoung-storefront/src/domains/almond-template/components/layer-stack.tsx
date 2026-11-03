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

export function KnockedOut({
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
        <mask
          id={id}
          maskUnits="userSpaceOnUse"
          x={-FAR}
          y={-FAR}
          width={FAR * 2}
          height={FAR * 2}
        >
          <rect
            x={-FAR}
            y={-FAR}
            width={FAR * 2}
            height={FAR * 2}
            fill="#ffffff"
          />
          {holes.map((hole) => (
            <LayerGraphic key={hole.id} layer={holeShape(hole)} />
          ))}
        </mask>
      </defs>
      {children}
    </g>
  )
}

function holeShape(layer: Layer): Layer {
  const stroked = !!layer.stroke && layer.stroke !== "none"

  return {
    ...layer,
    knockout: false,
    fill: "#000000",
    stroke: stroked ? "#000000" : layer.stroke,
    opacity: 1,
    gradient: undefined,
    colorFilter: undefined,
    blendMode: undefined,
    shadow: false,
    bevel: false,
    texture: false,
  }
}

// 미리보기·썸네일·인쇄 파일처럼 그리기만 하는 곳에서 쓴다
export function LayerStack({ layers }: { layers: Layer[] }) {
  return (
    <>
      {layers.map((layer, index) => (
        <KnockedOut key={layer.id} layers={layers} index={index}>
          <LayerGraphic layer={layer} />
        </KnockedOut>
      ))}
    </>
  )
}
