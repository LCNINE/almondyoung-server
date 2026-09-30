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
import type { Layer } from "../../lib/document"
import { OrderIcon } from "./order-icon"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { ObjectPropertiesMore } from "./object-properties-more"

export function ObjectProperties({
  editor,
  panel,
  selected,
}: {
  editor: AlmondEditor
  panel: PropertyPanelState
  selected: Layer
}) {
  const { patch, editable, setOrder } = editor
  const selectedImageInputRef = useRef<HTMLInputElement>(null)
  const { setObjectMoreId, objectMoreOpen } = panel
  return (
    <aside
      aria-label="오브젝트 속성"
      className="absolute top-[18%] right-5 z-20 w-[290px] overflow-visible border bg-white text-sm shadow-lg"
    >
      <h2 className="border-b px-4 py-2 text-right text-xl font-light uppercase">
        {selected.type === "text"
          ? "TEXT"
          : selected.type === "clipart"
            ? "IMAGE"
            : selected.type === "frame"
              ? "FRAME"
              : selected.type === "qr"
                ? "QR"
                : "FIGURE"}
      </h2>
      <div className="space-y-3 px-4 py-3 text-xs">
        {selected.type === "text" ? (
          <>
            <label className="flex items-center gap-2">
              <span className="w-9 shrink-0">폰트</span>
              <select
                aria-label="폰트"
                className="min-w-0 flex-1 border px-2 py-1"
                value={selected.fontFamily ?? "Arial, sans-serif"}
                disabled={!editable}
                onChange={(event) =>
                  patch(selected.id, { fontFamily: event.target.value })
                }
              >
                {[
                  "Arial, sans-serif",
                  "Noto Sans CJK KR, sans-serif",
                  "Apple SD Gothic Neo, sans-serif",
                  "Nanum Gothic, sans-serif",
                  "serif",
                ].map((font) => (
                  <option key={font} value={font}>
                    {font.split(",")[0]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-1">
                크기
                <input
                  aria-label="글자 크기"
                  type="number"
                  min="2"
                  step="0.5"
                  className="w-16 border p-1 text-right"
                  value={selected.fontSize ?? 10}
                  disabled={!editable}
                  onChange={(event) =>
                    patch(selected.id, {
                      fontSize: Number(event.target.value),
                    })
                  }
                />
              </label>
              <PrintColorPicker
                label="글자색"
                value={selected.fill}
                compact
                placement="right"
                disabled={!editable}
                onApply={(color) => patch(selected.id, { fill: color })}
              />
            </div>
            <div className="flex items-center gap-2">
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
              <span className="ml-auto">스타일</span>
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
          </>
        ) : (
          <>
            {selected.type !== "clipart" && (
              <div className="flex items-center gap-3">
                <PrintColorPicker
                  label="채우기"
                  value={selected.fill}
                  compact
                  placement="right"
                  disabled={!editable}
                  onApply={(color) => patch(selected.id, { fill: color })}
                />
                {!["frame", "qr"].includes(selected.type) && (
                  <PrintColorPicker
                    label="테두리"
                    value={selected.stroke ?? "#333333"}
                    compact
                    placement="right"
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
            {!["clipart", "qr", "frame"].includes(selected.type) && (
              <label className="flex items-center gap-2">
                선두께
                <input
                  aria-label="선두께"
                  type="number"
                  min="0"
                  max="50"
                  step="0.2"
                  value={selected.strokeWidth ?? 0}
                  disabled={!editable}
                  onChange={(event) =>
                    patch(selected.id, {
                      strokeWidth: Number(event.target.value),
                    })
                  }
                  className="w-16 border p-1 text-right"
                />
              </label>
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
                <input
                  aria-label="오브젝트 투명도"
                  type="number"
                  min="10"
                  max="100"
                  step="10"
                  value={Math.round((selected.opacity ?? 1) * 100)}
                  disabled={!editable}
                  onChange={(event) =>
                    patch(selected.id, {
                      opacity: Math.max(
                        0.1,
                        Math.min(1, Number(event.target.value) / 100)
                      ),
                    })
                  }
                  className="w-14 border p-1 text-right"
                />
              </label>
              <label className="flex min-w-0 flex-1 items-center gap-1">
                회전
                <input
                  aria-label="오브젝트 회전"
                  type="number"
                  min="-360"
                  max="360"
                  value={selected.rotation ?? 0}
                  disabled={!editable}
                  onChange={(event) =>
                    patch(selected.id, {
                      rotation: Math.max(
                        -360,
                        Math.min(360, Number(event.target.value))
                      ),
                    })
                  }
                  className="w-14 border p-1 text-right"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
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
