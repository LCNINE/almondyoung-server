import { FlipHorizontal, FlipVertical } from "lucide-react"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { SHAPE_TEXT_TYPES, type Layer } from "../../lib/document"
import { pxUnit } from "../../lib/layer"
import { PrintColorPicker } from "../color-picker"
import { GrayButton } from "./object-properties"
import { OrderIcon } from "./order-icon"
import {
  IconButton33,
  NumberBox,
  OpacitySection,
  PrintEffectRows,
  PropHeader,
  PropSection,
  PropSlider,
  SettingBox,
  ShadowRow,
} from "./prop-sections"
import {
  common,
  FontSelect,
  StrokeLineControls,
  type StyleTarget,
} from "./style-controls"

const STROKED = (layer: Layer) =>
  SHAPE_TEXT_TYPES.has(layer.type) || layer.type === "line"
const EFFECTED = (layer: Layer) => STROKED(layer) || layer.type === "text"
const round2 = (value: number) => Math.round(value * 100) / 100

// 망고보드 「여러개 선택」/「그룹」: 공통 속성만 모아 한 번에 바꾼다. 값이 섞인 색은 ? 로 보인다
export function GroupProperties({
  editor,
  panel,
  inline = false,
}: {
  editor: AlmondEditor
  panel: PropertyPanelState
  inline?: boolean
}) {
  const {
    group,
    patchLayers,
    flipLayers,
    canEdit,
    setOrder,
    mergedGroup,
    mergeGroup,
    splitGroup,
    design,
  } = editor
  const layers = group.filter(canEdit)
  const locked = group.length - layers.length
  const unit = pxUnit(design)
  const targetOf = (items: Layer[]): StyleTarget => ({
    layers: items,
    apply: (value) =>
      patchLayers(
        items.map((layer) => layer.id),
        value
      ),
    disabled: !items.length,
    placement: "left",
  })
  const painted = layers.filter(
    (layer) =>
      layer.type !== "image" &&
      layer.type !== "clipart" &&
      layer.type !== "line"
  )
  const stroked = layers.filter(STROKED)
  const texts = layers.filter((layer) => layer.type === "text")
  const fill = common(painted, (layer) => layer.fill)
  const stroke = common(stroked, (layer) =>
    !layer.strokeWidth ? "none" : (layer.stroke ?? "none")
  )
  const strokeWidth = common(stroked, (layer) => layer.strokeWidth ?? 0)
  const opacity = common(layers, (layer) => layer.opacity ?? 1)
  const fontSize = common(texts, (layer) => layer.fontSize ?? 10)
  const disabled = !layers.length
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
      <PropHeader title={mergedGroup ? "그룹" : "여러개 선택"} />
      <PropSection className="py-[17px]">
        <div className="flex flex-wrap gap-x-[5px]">
          {(
            [
              ["top", "맨 앞으로"],
              ["up", "앞으로"],
              ["down", "뒤로"],
              ["bottom", "맨 뒤로"],
            ] as const
          ).map(([position, label]) => (
            <IconButton33
              key={position}
              label={label}
              disabled={disabled}
              onClick={() => setOrder(position)}
            >
              <OrderIcon position={position} />
            </IconButton33>
          ))}
          <IconButton33
            label="좌우 반전"
            disabled={disabled}
            onClick={() => flipLayers(layers, "x")}
          >
            <FlipHorizontal size={20} strokeWidth={1.6} />
          </IconButton33>
          <IconButton33
            label="상하 반전"
            disabled={disabled}
            onClick={() => flipLayers(layers, "y")}
          >
            <FlipVertical size={20} strokeWidth={1.6} />
          </IconButton33>
        </div>
      </PropSection>
      {(painted.length > 0 || stroked.length > 0) && (
        <PropSection className="space-y-[15px] py-5">
          {painted.length > 0 && (
            <PrintColorPicker
              label="색상"
              value={fill ?? ""}
              disabled={disabled}
              onApply={(color) => targetOf(painted).apply({ fill: color })}
            />
          )}
          {stroked.length > 0 && (
            <div>
              <PrintColorPicker
                label="테두리"
                value={stroke ?? ""}
                disabled={disabled}
                onClear={() =>
                  targetOf(stroked).apply({ stroke: "none", strokeWidth: 0 })
                }
                onApply={(color) =>
                  patchLayers(
                    stroked.map((layer) => layer.id),
                    (layer) => ({
                      stroke: color,
                      strokeWidth: layer.strokeWidth || round2(3 * unit) || 0.1,
                    })
                  )
                }
              />
              {stroke !== "none" && (
                <SettingBox
                  title="테두리 설정"
                  disabled={disabled}
                  onClear={() =>
                    targetOf(stroked).apply({ stroke: "none", strokeWidth: 0 })
                  }
                >
                  <PropSlider
                    label="테두리 두께"
                    min={1}
                    max={100}
                    value={
                      strokeWidth === null
                        ? 1
                        : Math.max(1, Math.round(strokeWidth / unit))
                    }
                    disabled={disabled}
                    onValue={(value) =>
                      targetOf(stroked).apply({
                        strokeWidth: Math.min(50, round2(value * unit)),
                      })
                    }
                  />
                  <StrokeLineControls target={targetOf(stroked)} />
                </SettingBox>
              )}
            </div>
          )}
        </PropSection>
      )}
      {texts.length > 0 && (
        <PropSection className="py-[25px]">
          <h3 className="mb-[5px] text-[16px] font-medium text-[#20232A]">
            폰트
          </h3>
          <div className="flex items-center gap-[11px]">
            <div className="min-w-0 flex-1">
              <FontSelect target={targetOf(texts)} bare />
            </div>
            <NumberBox
              value={fontSize ?? 0}
              min={1}
              step={0.5}
              width={75}
              disabled={disabled}
              onValue={(value) => targetOf(texts).apply({ fontSize: value })}
            />
          </div>
        </PropSection>
      )}
      {layers.some(EFFECTED) && (
        <PropSection className="space-y-[15px] py-5">
          <ShadowRow target={targetOf(layers.filter(EFFECTED))} unit={unit} />
          <PrintEffectRows target={targetOf(layers.filter(EFFECTED))} />
        </PropSection>
      )}
      <OpacitySection
        value={opacity ?? 1}
        disabled={disabled}
        onValue={(value) => targetOf(layers).apply({ opacity: value })}
      />
      <div className="px-[13px] py-5">
        <GrayButton onClick={mergedGroup ? splitGroup : mergeGroup}>
          {mergedGroup ? "그룹 해제" : "그룹으로 묶기"}
        </GrayButton>
        {locked > 0 && (
          <p className="mt-3 text-[13px] text-[#70777F]">
            잠겼거나 편집할 수 없는 {locked}개는 바뀌지 않습니다.
          </p>
        )}
      </div>
    </aside>
  )
}
