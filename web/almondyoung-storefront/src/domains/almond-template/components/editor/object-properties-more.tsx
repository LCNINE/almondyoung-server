import { RotateCcw, FlipHorizontal, FlipVertical } from "lucide-react"
import type { Layer } from "../../lib/document"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { RefObject } from "react"
import type { PropertyPanelState } from "../../hooks/use-property-panel"
import { FrameOptions } from "./frame-options"

export function ObjectPropertiesMore({
  editor,
  panel,
  selected,
  selectedImageInputRef,
}: {
  editor: AlmondEditor
  panel: PropertyPanelState
  selected: Layer
  selectedImageInputRef: RefObject<HTMLInputElement>
}) {
  const {
    mode,
    design,
    change,
    side,
    setSelectedId,
    layers,
    spec,
    patch,
    add,
    editable,
    setOrder,
    setGeometry,
  } = editor
  const { objectMoreOpen } = panel
  return (
    <div
      className={
        objectMoreOpen
          ? "max-h-[45vh] space-y-3 overflow-y-auto border-t px-4 py-3 text-sm"
          : "hidden"
      }
    >
      <label className="block">
        이름
        <input
          className="mt-1 w-full rounded border p-2"
          value={selected.name}
          disabled={!editable}
          onChange={(event) => patch(selected.id, { name: event.target.value })}
        />
      </label>
      {selected.type === "text" && (
        <label className="block">
          문구
          <textarea
            className="mt-1 min-h-24 w-full rounded border p-2"
            value={selected.text ?? ""}
            disabled={!editable}
            maxLength={500}
            onChange={(event) =>
              patch(selected.id, { text: event.target.value })
            }
          />
        </label>
      )}
      {selected.type === "text" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["letterSpacing", "자간", "0.1"],
                ["lineHeight", "행간", "5"],
                ["widthScale", "장평", "5"],
              ] as const
            ).map(([field, label, step]) => (
              <label key={field}>
                {label}
                <input
                  type="number"
                  step={step}
                  className="mt-1 w-full border p-2"
                  value={
                    selected[field] ??
                    (field === "letterSpacing"
                      ? 0
                      : field === "lineHeight"
                        ? 120
                        : 100)
                  }
                  disabled={!editable}
                  onChange={(e) =>
                    patch(selected.id, {
                      [field]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y", "width", "height"] as const).map((field) => (
          <label key={field}>
            {
              {
                x: "X 위치",
                y: "Y 위치",
                width: "너비",
                height: "높이",
              }[field]
            }
            <input
              className="mt-1 w-full rounded border p-2"
              type="number"
              min={
                field === "width" || field === "height"
                  ? 1
                  : field === "x"
                    ? -design.widthMm
                    : -design.heightMm
              }
              step="0.1"
              value={selected[field]}
              disabled={!editable}
              onChange={(event) =>
                setGeometry(field, Number(event.target.value))
              }
            />
          </label>
        ))}
      </div>
      <FrameOptions
        editor={editor}
        panel={panel}
        selected={selected}
        selectedImageInputRef={selectedImageInputRef}
      />
      {selected.type === "text" && (
        <div className="grid grid-cols-2 gap-2">
          <label>
            투명도 (%)
            <input
              type="number"
              min="10"
              max="100"
              step="10"
              className="mt-1 w-full border p-2"
              value={Math.round((selected.opacity ?? 1) * 100)}
              disabled={!editable}
              onChange={(e) =>
                patch(selected.id, {
                  opacity: Math.max(
                    0.1,
                    Math.min(1, Number(e.target.value) / 100)
                  ),
                })
              }
            />
          </label>
          <label>
            회전 (°)
            <input
              type="number"
              min="-360"
              max="360"
              step="1"
              className="mt-1 w-full border p-2"
              value={selected.rotation ?? 0}
              disabled={!editable}
              onChange={(e) =>
                patch(selected.id, {
                  rotation: Math.max(
                    -360,
                    Math.min(360, Number(e.target.value))
                  ),
                })
              }
            />
          </label>
        </div>
      )}
      <div className="flex gap-2">
        <button
          title="좌우반전"
          aria-label="좌우반전"
          disabled={!editable}
          className="border p-2"
          onClick={() => patch(selected.id, { flipX: !selected.flipX })}
        >
          <FlipHorizontal size={18} />
        </button>
        <button
          title="상하반전"
          aria-label="상하반전"
          disabled={!editable}
          className="border p-2"
          onClick={() => patch(selected.id, { flipY: !selected.flipY })}
        >
          <FlipVertical size={18} />
        </button>
        <button
          title="회전 초기화"
          aria-label="회전 초기화"
          disabled={!editable}
          className="border p-2"
          onClick={() => patch(selected.id, { rotation: 0 })}
        >
          <RotateCcw size={18} />
        </button>
      </div>
      {(selected.x < spec.safetyMm ||
        selected.y < spec.safetyMm ||
        selected.x + selected.width > design.widthMm - spec.safetyMm ||
        selected.y + selected.height > design.heightMm - spec.safetyMm) && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
          안전영역 밖에 걸친 요소입니다. 재단 시 잘릴 수 있습니다.
        </p>
      )}
      {mode === "designer" && (
        <>
          <label className="block">
            <input
              type="checkbox"
              checked={selected.editable !== false}
              onChange={(event) =>
                patch(selected.id, { editable: event.target.checked })
              }
            />{" "}
            고객 편집 허용
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={!!selected.locked}
              onChange={(event) =>
                patch(selected.id, { locked: event.target.checked })
              }
            />{" "}
            위치 잠금
          </label>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <p className="col-span-2 text-xs text-slate-500">
          레이어 순서{" "}
          {layers.findIndex((layer) => layer.id === selected.id) + 1}/
          {layers.length} · 숫자가 클수록 앞에 보입니다.
        </p>
        {selected.type === "text" && (
          <>
            <button
              className="rounded border p-2"
              onClick={() => setOrder("top")}
            >
              맨 앞으로
            </button>
            <button
              className="rounded border p-2"
              onClick={() => setOrder("bottom")}
            >
              맨 뒤로
            </button>
            <button
              className="rounded border p-2"
              onClick={() => setOrder("up")}
            >
              앞으로
            </button>
            <button
              className="rounded border p-2"
              onClick={() => setOrder("down")}
            >
              뒤로
            </button>
          </>
        )}
        <button
          className="rounded border p-2"
          disabled={!editable}
          onClick={() =>
            add(selected.type, {
              ...selected,
              id: crypto.randomUUID(),
              x: selected.x + 5,
              y: selected.y + 5,
              name: `${selected.name} 복사`,
            })
          }
        >
          복제
        </button>
        <button
          className="rounded border p-2 text-red-600"
          disabled={!editable}
          onClick={() => {
            change({
              ...design,
              [side]: layers.filter((layer) => layer.id !== selected.id),
            })
            setSelectedId(null)
          }}
        >
          삭제
        </button>
      </div>
    </div>
  )
}
