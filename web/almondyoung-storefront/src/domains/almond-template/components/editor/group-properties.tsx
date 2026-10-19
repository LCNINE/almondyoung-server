import { GripVertical } from "lucide-react"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { SHAPE_TEXT_TYPES, type Layer } from "../../lib/document"
import { PrintColorPicker } from "../color-picker"
import { NumberInput } from "./number-input"
import {
  common,
  EffectControls,
  FlipControls,
  FontSelect,
  StrokeLineControls,
  type StyleTarget,
} from "./style-controls"

const STROKED = (layer: Layer) =>
  SHAPE_TEXT_TYPES.has(layer.type) || layer.type === "line"
const EFFECTED = (layer: Layer) => STROKED(layer) || layer.type === "text"

// 여러 개를 골랐을 때 공통 속성만 모아 한 번에 바꾼다. 값이 서로 다른 칸은 "혼합"으로 비운다
export function GroupProperties({
  editor,
  panel,
  inline = false,
}: {
  editor: AlmondEditor
  panel: PropertyPanelState
  inline?: boolean
}) {
  const { group, patchLayers, flipLayers, canEdit } = editor
  const layers = group.filter(canEdit)
  const locked = group.length - layers.length
  const targetOf = (items: Layer[]): StyleTarget => ({
    layers: items,
    apply: (value) =>
      patchLayers(
        items.map((layer) => layer.id),
        value
      ),
    disabled: !items.length,
    placement: "right",
  })
  const painted = layers.filter(
    (layer) => layer.type !== "image" && layer.type !== "clipart"
  )
  const stroked = layers.filter(STROKED)
  const texts = layers.filter((layer) => layer.type === "text")
  const fill = common(painted, (layer) => layer.fill)
  const stroke = common(stroked, (layer) => layer.stroke ?? "none")
  const opacity = common(layers, (layer) => layer.opacity ?? 1)
  return (
    <aside
      aria-label="여러 요소 속성"
      style={inline ? undefined : panel.panelStyle}
      className={
        inline
          ? "w-full overflow-visible bg-white text-sm"
          : "absolute top-[18%] right-5 z-20 w-[290px] overflow-visible border bg-white text-sm shadow-lg"
      }
    >
      <h2
        title={inline ? undefined : "끌어서 옮기기"}
        onPointerDown={inline ? undefined : panel.startPanelDrag}
        className={`flex items-center border-b px-4 py-2 text-xl font-light select-none ${inline ? "" : "cursor-move"}`}
      >
        {!inline && <GripVertical size={16} className="text-slate-400" />}
        <span className="ml-auto text-base">{group.length}개 선택</span>
      </h2>
      <div className="space-y-3 px-4 py-3 text-xs">
        {painted.length > 0 && (
          <div className="flex items-center gap-3">
            <PrintColorPicker
              label="채우기"
              value={fill && fill !== "none" ? fill : "#ffffff"}
              compact
              placement="right"
              onApply={(color) => targetOf(painted).apply({ fill: color })}
            />
            {stroked.length > 0 && (
              <PrintColorPicker
                label="테두리"
                value={stroke && stroke !== "none" ? stroke : "#333333"}
                compact
                placement="right"
                onApply={(color) =>
                  patchLayers(
                    stroked.map((layer) => layer.id),
                    (layer) => ({
                      stroke: color,
                      strokeWidth: layer.strokeWidth || 1,
                    })
                  )
                }
              />
            )}
            {(fill === null || stroke === null) && (
              <span className="text-[11px] text-slate-400">색 혼합</span>
            )}
          </div>
        )}
        {stroked.length > 0 && (
          <>
            <label className="flex items-center gap-2">
              선두께
              <NumberInput
                aria-label="선두께"
                min="0"
                max="50"
                step="0.2"
                placeholder="혼합"
                value={common(stroked, (layer) => layer.strokeWidth ?? 0)}
                onValue={(value) =>
                  targetOf(stroked).apply({ strokeWidth: value })
                }
                className="w-16 border p-1 text-right"
              />
            </label>
            <StrokeLineControls target={targetOf(stroked)} />
          </>
        )}
        {texts.length > 0 && (
          <>
            <FontSelect target={targetOf(texts)} />
            <label className="flex items-center gap-2">
              글자 크기
              <NumberInput
                aria-label="글자 크기"
                min="1"
                step="0.5"
                placeholder="혼합"
                value={common(texts, (layer) => layer.fontSize ?? 10)}
                onValue={(value) => targetOf(texts).apply({ fontSize: value })}
                className="w-16 border p-1 text-right"
              />
            </label>
          </>
        )}
        <label className="flex items-center gap-2">
          투명도
          <NumberInput
            aria-label="투명도"
            min="10"
            max="100"
            step="10"
            placeholder="혼합"
            value={opacity === null ? null : Math.round(opacity * 100)}
            disabled={!layers.length}
            onValue={(value) =>
              targetOf(layers).apply({
                opacity: Math.max(0.1, Math.min(1, value / 100)),
              })
            }
            className="w-14 border p-1 text-right"
          />
        </label>
        {layers.some(EFFECTED) && (
          <EffectControls target={targetOf(layers.filter(EFFECTED))} />
        )}
        <FlipControls
          onFlip={(axis) => flipLayers(layers, axis)}
          disabled={!layers.length}
        />
        {locked > 0 && (
          <p className="text-[11px] text-slate-500">
            잠겼거나 편집할 수 없는 {locked}개는 바뀌지 않습니다.
          </p>
        )}
      </div>
    </aside>
  )
}
