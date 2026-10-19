import { NumberInput } from "./number-input"
import { useRef } from "react"
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { PrintColorPicker } from "../color-picker"
import { shapeTextColor } from "../graphic"
import { mm, swapColor } from "../../lib/layer"
import { SHAPE_TEXT_TYPES, type Layer } from "../../lib/document"
import {
  AlignOrderSection,
  NumberBox,
  PropHeader,
  PropSection,
  PropSlider,
  SizeSection,
} from "./prop-sections"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { ObjectPropertiesMore } from "./object-properties-more"
import { shapeOutline } from "../../lib/path-shape"
import {
  EffectControls,
  FontSelect,
  StarControls,
  StrokeLineControls,
  type StyleTarget,
} from "./style-controls"

function FormatButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string
  pressed: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-[28px] items-center justify-center rounded-[6px] text-[#3F4250] hover:bg-[#F3F5F8] disabled:opacity-40 ${pressed ? "bg-[#e2e7ed]" : ""}`}
    >
      {children}
    </button>
  )
}

// 도형 윤곽을 그대로 사진 틀로 쓴다 (예전 모양틀 기능)
function ShapePhoto({
  editor,
  selected,
}: {
  editor: AlmondEditor
  selected: Layer
}) {
  const { patch, editable, imageFile } = editor
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <span className="w-9 shrink-0">사진</span>
        <button
          type="button"
          disabled={!editable}
          onClick={() => fileRef.current?.click()}
          className="border px-2 py-1"
        >
          {selected.image ? "사진 바꾸기" : "도형에 사진 넣기"}
        </button>
        {selected.image && (
          <button
            type="button"
            disabled={!editable}
            onClick={() =>
              patch(selected.id, {
                image: undefined,
                pixelWidth: undefined,
                pixelHeight: undefined,
                originalImage: undefined,
                imageScale: undefined,
                imageOffsetX: undefined,
                imageOffsetY: undefined,
              })
            }
            className="border px-2 py-1"
          >
            빼기
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) void imageFile(file, "frame")
          }}
        />
      </div>
      {selected.image &&
        (
          [
            ["imageScale", "사진 확대", 1, 3, 0.05],
            ["imageOffsetX", "가로 위치", 0, 1, 0.02],
            ["imageOffsetY", "세로 위치", 0, 1, 0.02],
          ] as const
        ).map(([field, label, min, max, step]) => (
          <label key={field} className="flex items-center gap-2">
            <span className="w-14 shrink-0">{label}</span>
            <input
              type="range"
              aria-label={label}
              min={min}
              max={max}
              step={step}
              value={selected[field] ?? (field === "imageScale" ? 1 : 0.5)}
              disabled={!editable}
              onChange={(event) =>
                patch(selected.id, { [field]: Number(event.target.value) })
              }
              className="min-w-0 flex-1"
            />
          </label>
        ))}
    </div>
  )
}

export function ObjectProperties({
  editor,
  panel,
  selected,
  inline = false,
}: {
  editor: AlmondEditor
  panel: PropertyPanelState
  selected: Layer
  inline?: boolean
}) {
  const { patch, editable, startPointEdit, replaceAll } = editor
  const everywhere = (from: string | undefined) =>
    from && from !== "none"
      ? (to: string) => replaceAll((layer) => swapColor(layer, from, to))
      : undefined
  const selectedImageInputRef = useRef<HTMLInputElement>(null)
  const target: StyleTarget = {
    layers: [selected],
    apply: (value) => patch(selected.id, value),
    everywhere: replaceAll,
    disabled: !editable,
    placement: inline ? "left" : "right",
  }
  const pointEditable =
    selected.type === "path" || shapeOutline(selected) !== null
  const { setObjectMoreId, objectMoreOpen } = panel
  const shapeText = SHAPE_TEXT_TYPES.has(selected.type)
  // 열린 펜·연필 선은 속이 없어서 채우기·도형 안 글자·사진 칸을 보이지 않는다
  const filled =
    shapeText && !(selected.type === "path" && !selected.pathClosed)
  const noStroke = !selected.stroke || selected.stroke === "none"
  return (
    <aside
      aria-label="오브젝트 속성"
      style={inline ? undefined : panel.panelStyle}
      className={
        inline
          ? "w-full bg-white text-sm"
          : "absolute top-[18%] right-5 z-20 w-[290px] overflow-visible border bg-white text-sm shadow-lg"
      }
    >
      <PropHeader
        title={
          selected.type === "text"
            ? "텍스트"
            : selected.type === "clipart"
              ? "클립아트"
              : selected.type === "frame"
                ? "프레임"
                : selected.type === "qr"
                  ? "QR코드"
                  : selected.type === "line"
                    ? "기본 선"
                    : selected.brush
                      ? "그리기"
                      : "도형"
        }
      />
      <AlignOrderSection
        editor={editor}
        layer={selected}
        canFlip={selected.type !== "text"}
      />
      <SizeSection
        editor={editor}
        layer={selected}
        heightLocked={selected.type === "text"}
      />
      {selected.type === "text" ? (
        <>
          <PropSection className="py-[25px]">
            <h3 className="mb-[5px] text-[16px] font-medium text-[#20232A]">
              폰트
            </h3>
            <div className="flex items-center gap-[11px]">
              <div className="min-w-0 flex-1">
                <FontSelect target={target} bare />
              </div>
              <NumberBox
                value={selected.fontSize ?? 10}
                min={1}
                step={0.5}
                width={75}
                disabled={!editable}
                onValue={(value) => patch(selected.id, { fontSize: value })}
              />
            </div>
            <div className="mt-[15px] flex items-center gap-[2px]">
              {(
                [
                  ["left", AlignLeft, "왼쪽 맞춤"],
                  ["center", AlignCenter, "가운데 맞춤"],
                  ["right", AlignRight, "오른쪽 맞춤"],
                ] as const
              ).map(([align, Icon, label]) => (
                <FormatButton
                  key={align}
                  label={label}
                  pressed={(selected.align ?? "left") === align}
                  disabled={!editable}
                  onClick={() => patch(selected.id, { align })}
                >
                  <Icon size={18} />
                </FormatButton>
              ))}
              <FormatButton
                label="굵게"
                pressed={selected.fontWeight === "bold"}
                disabled={!editable}
                onClick={() =>
                  patch(selected.id, {
                    fontWeight:
                      selected.fontWeight === "bold" ? "normal" : "bold",
                  })
                }
              >
                <Bold size={18} />
              </FormatButton>
              <FormatButton
                label="기울임"
                pressed={!!selected.italic}
                disabled={!editable}
                onClick={() => patch(selected.id, { italic: !selected.italic })}
              >
                <Italic size={18} />
              </FormatButton>
            </div>
            <div className="mt-[15px] grid grid-cols-3 gap-[18px]">
              <PropSlider
                label="자간"
                min={-100}
                max={700}
                value={Math.round(
                  ((selected.letterSpacing ?? 0) / (selected.fontSize ?? 10)) *
                    1000
                )}
                disabled={!editable}
                onValue={(value) =>
                  patch(selected.id, {
                    letterSpacing:
                      Math.round(
                        ((value * (selected.fontSize ?? 10)) / 1000) * 1000
                      ) / 1000,
                  })
                }
              />
              <PropSlider
                label="행간"
                min={0.5}
                max={3}
                step={0.1}
                value={(selected.lineHeight ?? 120) / 100}
                disabled={!editable}
                onValue={(value) =>
                  patch(selected.id, { lineHeight: Math.round(value * 100) })
                }
              />
              <PropSlider
                label="장평"
                min={30}
                max={200}
                value={selected.widthScale ?? 100}
                disabled={!editable}
                onValue={(value) => patch(selected.id, { widthScale: value })}
              />
            </div>
          </PropSection>
          <PropSection className="space-y-[15px] py-5">
            <PrintColorPicker
              label="텍스트 색상"
              value={selected.fill}
              onApplyEverywhere={everywhere(selected.fill)}
              disabled={!editable}
              onApply={(color) => patch(selected.id, { fill: color })}
            />
            <PrintColorPicker
              label="윤곽선"
              value={noStroke ? "#ffffff" : (selected.stroke ?? "#ffffff")}
              onApplyEverywhere={
                noStroke ? undefined : everywhere(selected.stroke)
              }
              disabled={!editable}
              onApply={(color) =>
                patch(selected.id, {
                  stroke: color,
                  strokeWidth:
                    selected.strokeWidth ||
                    Math.max(0.2, mm((selected.fontSize ?? 10) * 0.08)),
                })
              }
            />
            {!noStroke && !!selected.strokeWidth && (
              <div className="space-y-3 rounded-[7px] bg-[#f6f7f9] px-[15px] py-5">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] text-[#20232A]">
                    윤곽선 설정
                  </span>
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() =>
                      patch(selected.id, { stroke: "none", strokeWidth: 0 })
                    }
                    className="text-[15px] text-[#3F4250] underline"
                  >
                    해제
                  </button>
                </div>
                <PropSlider
                  label="윤곽선 두께"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={selected.strokeWidth ?? 0}
                  disabled={!editable}
                  onValue={(value) =>
                    patch(selected.id, { strokeWidth: value })
                  }
                />
                <StrokeLineControls target={target} />
              </div>
            )}
            <EffectControls target={target} />
          </PropSection>
          <PropSection className="py-5">
            <PropSlider
              label="불투명도"
              min={10}
              max={100}
              value={Math.round((selected.opacity ?? 1) * 100)}
              disabled={!editable}
              onValue={(value) =>
                patch(selected.id, {
                  opacity: Math.max(0.1, Math.min(1, value / 100)),
                })
              }
            />
          </PropSection>
        </>
      ) : (
        <div className="space-y-3 px-4 py-5 text-[13px] text-[#3F4250]">
          <>
            {selected.type !== "clipart" && (
              <div className="flex items-center gap-3">
                {(filled || !shapeText) && (
                  <PrintColorPicker
                    label="채우기"
                    value={selected.fill === "none" ? "#ffffff" : selected.fill}
                    onApplyEverywhere={everywhere(selected.fill)}
                    compact
                    placement={inline ? "left" : "right"}
                    disabled={!editable}
                    onApply={(color) => patch(selected.id, { fill: color })}
                  />
                )}
                {!["frame", "qr"].includes(selected.type) && (
                  <PrintColorPicker
                    label="테두리"
                    value={
                      noStroke ? "#333333" : (selected.stroke ?? "#333333")
                    }
                    onApplyEverywhere={
                      noStroke ? undefined : everywhere(selected.stroke)
                    }
                    compact
                    placement={inline ? "left" : "right"}
                    disabled={!editable}
                    onApply={(color) =>
                      patch(selected.id, {
                        stroke: color,
                        strokeWidth: selected.strokeWidth || 1,
                      })
                    }
                  />
                )}
              </div>
            )}
            {filled && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selected.fill === "none"}
                    disabled={!editable}
                    onChange={(event) =>
                      patch(selected.id, {
                        fill: event.target.checked ? "none" : "#ffffff",
                      })
                    }
                  />
                  채우기 없음
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={noStroke || !selected.strokeWidth}
                    disabled={!editable}
                    onChange={(event) =>
                      patch(
                        selected.id,
                        event.target.checked
                          ? { stroke: "none", strokeWidth: 0 }
                          : { stroke: "#333333", strokeWidth: 1 }
                      )
                    }
                  />
                  테두리 없음
                </label>
              </div>
            )}
            {!["clipart", "qr", "frame"].includes(selected.type) && (
              <label className="flex items-center gap-2">
                선두께
                <NumberInput
                  aria-label="선두께"
                  min="0"
                  max="50"
                  step="0.2"
                  value={selected.strokeWidth ?? 0}
                  disabled={!editable}
                  onValue={(value) =>
                    patch(selected.id, {
                      strokeWidth: value,
                    })
                  }
                  className="w-16 border p-1 text-right"
                />
              </label>
            )}
            {(selected.type === "line" ||
              (shapeText && !noStroke && !!selected.strokeWidth)) && (
              <StrokeLineControls target={target} />
            )}
            {selected.type === "star" && (
              <StarControls
                layer={selected}
                apply={target.apply}
                disabled={!editable}
              />
            )}
            {pointEditable && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!editable}
                  onClick={startPointEdit}
                  className="border px-2 py-1"
                >
                  점 편집
                </button>
                <span className="text-[11px] text-slate-500">
                  꼭짓점을 끌어 모양을 바꿉니다
                </span>
              </div>
            )}
            {filled && (
              <div className="space-y-2 border-t pt-3">
                <label className="block">
                  도형 안 글자
                  <textarea
                    aria-label="도형 안 글자"
                    className="mt-1 h-14 w-full resize-none border p-1"
                    placeholder="도형을 두 번 눌러도 입력할 수 있어요"
                    maxLength={500}
                    value={selected.text ?? ""}
                    disabled={!editable}
                    onChange={(event) =>
                      patch(selected.id, { text: event.target.value })
                    }
                  />
                </label>
                {selected.text && (
                  <>
                    <FontSelect target={target} />
                    <div className="flex items-center gap-2">
                      <PrintColorPicker
                        label="글자색"
                        value={shapeTextColor(selected)}
                        onApplyEverywhere={everywhere(shapeTextColor(selected))}
                        compact
                        placement={inline ? "left" : "right"}
                        disabled={!editable}
                        onApply={(color) =>
                          patch(selected.id, { textColor: color })
                        }
                      />
                      <button
                        type="button"
                        aria-label="굵게"
                        aria-pressed={selected.fontWeight === "bold"}
                        disabled={!editable}
                        onClick={() =>
                          patch(selected.id, {
                            fontWeight:
                              selected.fontWeight === "bold"
                                ? "normal"
                                : "bold",
                          })
                        }
                        className={`p-1 ${selected.fontWeight === "bold" ? "text-blue-600" : ""}`}
                      >
                        <Bold size={18} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {filled && <ShapePhoto editor={editor} selected={selected} />}
            {(shapeText || selected.type === "line") && (
              <EffectControls target={target} />
            )}
            {selected.type === "frame" && (
              <button
                type="button"
                className="w-full border p-2 text-left"
                onClick={() => selectedImageInputRef.current?.click()}
              >
                프레임에 사진 넣기
              </button>
            )}
            <div className="-mx-4 border-t border-[#e6e7ea] px-[13px] pt-5">
              <PropSlider
                label="불투명도"
                min={10}
                max={100}
                value={Math.round((selected.opacity ?? 1) * 100)}
                disabled={!editable}
                onValue={(value) =>
                  patch(selected.id, {
                    opacity: Math.max(0.1, Math.min(1, value / 100)),
                  })
                }
              />
            </div>
          </>
        </div>
      )}
      <ObjectPropertiesMore
        editor={editor}
        panel={panel}
        selected={selected}
        selectedImageInputRef={selectedImageInputRef}
      />
      <button
        type="button"
        aria-label={objectMoreOpen ? "SIMPLE" : "MORE"}
        aria-expanded={objectMoreOpen}
        onClick={() => setObjectMoreId(objectMoreOpen ? null : selected.id)}
        className="flex w-full items-center justify-center gap-1 border-t py-1 text-xs"
      >
        {objectMoreOpen ? (
          <>
            <ChevronUp size={14} /> SIMPLE
          </>
        ) : (
          <>
            <ChevronDown size={14} /> MORE
          </>
        )}
      </button>
    </aside>
  )
}
