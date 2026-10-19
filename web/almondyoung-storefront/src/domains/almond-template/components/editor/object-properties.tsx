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
  GripVertical,
} from "lucide-react"
import { PrintColorPicker } from "../color-picker"
import { shapeTextColor } from "../graphic"
import { mm } from "../../lib/layer"
import { SHAPE_TEXT_TYPES, type Layer } from "../../lib/document"
import { OrderIcon } from "./order-icon"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { ObjectPropertiesMore } from "./object-properties-more"
import { shapeOutline } from "../../lib/path-shape"
import {
  EffectControls,
  FlipControls,
  FontSelect,
  StarControls,
  StrokeLineControls,
  type StyleTarget,
} from "./style-controls"

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
  const { patch, editable, setOrder, flipLayers, startPointEdit } = editor
  const selectedImageInputRef = useRef<HTMLInputElement>(null)
  const target: StyleTarget = {
    layers: [selected],
    apply: (value) => patch(selected.id, value),
    disabled: !editable,
    placement: inline ? "left" : "right",
  }
  const flip = (axis: "x" | "y") => flipLayers([selected], axis)
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
          ? "mt-4 w-full border bg-white text-sm"
          : "absolute top-[18%] right-5 z-20 w-[290px] overflow-visible border bg-white text-sm shadow-lg"
      }
    >
      <h2
        title={inline ? undefined : "끌어서 옮기기"}
        onPointerDown={inline ? undefined : panel.startPanelDrag}
        className={`flex items-center border-b px-4 py-2 text-xl font-light uppercase select-none ${inline ? "" : "cursor-move"}`}
      >
        {!inline && <GripVertical size={16} className="text-slate-400" />}
        <span className="ml-auto">
          {selected.type === "text"
            ? "TEXT"
            : selected.type === "clipart"
              ? "IMAGE"
              : selected.type === "frame"
                ? "FRAME"
                : selected.type === "qr"
                  ? "QR"
                  : "FIGURE"}
        </span>
      </h2>
      <div className="space-y-3 px-4 py-3 text-xs">
        {selected.type === "text" ? (
          <>
            <FontSelect target={target} />
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-1">
                크기
                <NumberInput
                  aria-label="글자 크기"
                  min="1"
                  step="0.5"
                  className="w-16 border p-1 text-right"
                  value={selected.fontSize ?? 10}
                  disabled={!editable}
                  onValue={(value) => patch(selected.id, { fontSize: value })}
                />
              </label>
              <PrintColorPicker
                label="글자색"
                value={selected.fill}
                compact
                placement={inline ? "left" : "right"}
                disabled={!editable}
                onApply={(color) => patch(selected.id, { fill: color })}
              />
            </div>
            <div className="flex items-center gap-1 pr-2">
              <span className="w-9 shrink-0">정렬</span>
              {(
                [
                  ["left", AlignLeft],
                  ["center", AlignCenter],
                  ["right", AlignRight],
                ] as const
              ).map(([align, Icon]) => (
                <button
                  key={align}
                  type="button"
                  aria-label={`${align} 정렬`}
                  aria-pressed={selected.align === align}
                  disabled={!editable}
                  onClick={() => patch(selected.id, { align })}
                  className={`p-1 ${selected.align === align ? "text-blue-600" : ""}`}
                >
                  <Icon size={18} />
                </button>
              ))}
              <span className="ml-auto whitespace-nowrap">스타일</span>
              <button
                type="button"
                aria-label="굵게"
                aria-pressed={selected.fontWeight === "bold"}
                disabled={!editable}
                onClick={() =>
                  patch(selected.id, {
                    fontWeight:
                      selected.fontWeight === "bold" ? "normal" : "bold",
                  })
                }
                className={`p-1 ${selected.fontWeight === "bold" ? "text-blue-600" : ""}`}
              >
                <Bold size={18} />
              </button>
              <button
                type="button"
                aria-label="기울임"
                aria-pressed={!!selected.italic}
                disabled={!editable}
                onClick={() => patch(selected.id, { italic: !selected.italic })}
                className={`p-1 ${selected.italic ? "text-blue-600" : ""}`}
              >
                <Italic size={18} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <PrintColorPicker
                label="테두리"
                value={noStroke ? "#ffffff" : (selected.stroke ?? "#ffffff")}
                compact
                placement={inline ? "left" : "right"}
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
              <label className="flex items-center gap-1 whitespace-nowrap">
                두께
                <NumberInput
                  aria-label="글자 테두리 두께"
                  min="0"
                  max="50"
                  step="0.1"
                  className="w-14 border p-1 text-right"
                  value={noStroke ? 0 : (selected.strokeWidth ?? 0)}
                  disabled={!editable || noStroke}
                  onValue={(value) =>
                    patch(selected.id, { strokeWidth: value })
                  }
                />
              </label>
              {!noStroke && (
                <button
                  type="button"
                  title="글자 테두리 빼기"
                  aria-label="글자 테두리 빼기"
                  className="ml-auto border px-2 py-1 whitespace-nowrap"
                  disabled={!editable}
                  onClick={() =>
                    patch(selected.id, { stroke: "none", strokeWidth: 0 })
                  }
                >
                  빼기
                </button>
              )}
            </div>
            {!noStroke && !!selected.strokeWidth && (
              <StrokeLineControls target={target} />
            )}
            <FlipControls onFlip={flip} disabled={!editable} />
            <EffectControls target={target} />
          </>
        ) : (
          <>
            {selected.type !== "clipart" && (
              <div className="flex items-center gap-3">
                {(filled || !shapeText) && (
                  <PrintColorPicker
                    label="채우기"
                    value={selected.fill === "none" ? "#ffffff" : selected.fill}
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
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-1">
                투명도
                <NumberInput
                  aria-label="오브젝트 투명도"
                  min="10"
                  max="100"
                  step="10"
                  value={Math.round((selected.opacity ?? 1) * 100)}
                  disabled={!editable}
                  onValue={(value) =>
                    patch(selected.id, {
                      opacity: Math.max(0.1, Math.min(1, value / 100)),
                    })
                  }
                  className="w-14 border p-1 text-right"
                />
              </label>
              <label className="flex min-w-0 flex-1 items-center gap-1">
                회전
                <NumberInput
                  aria-label="오브젝트 회전"
                  min="-360"
                  max="360"
                  value={selected.rotation ?? 0}
                  disabled={!editable}
                  onValue={(value) =>
                    patch(selected.id, {
                      rotation: Math.max(-360, Math.min(360, value)),
                    })
                  }
                  className="w-14 border p-1 text-right"
                />
              </label>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-9 shrink-0">순서</span>
              {(
                [
                  ["top", "맨 앞으로"],
                  ["up", "앞으로"],
                  ["down", "뒤로"],
                  ["bottom", "맨 뒤로"],
                ] as const
              ).map(([position, label]) => (
                <button
                  key={position}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={() => setOrder(position)}
                  className="p-1 hover:bg-slate-100"
                >
                  <OrderIcon position={position} />
                </button>
              ))}
              <div className="ml-auto">
                <FlipControls onFlip={flip} disabled={!editable} />
              </div>
            </div>
          </>
        )}
      </div>
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
