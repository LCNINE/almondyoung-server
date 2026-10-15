import { Pencil, Trash2 } from "lucide-react"
import { useRef, useState } from "react"
import { Backdrop, LayerGraphic } from "../graphic"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { CanvasGuides } from "./canvas-guides"
import { useLeaveWarning } from "../../hooks/use-leave-warning"
import { sideBackground, type Layer } from "../../lib/document"

function quickActionsAt(layer: Layer, scale: number) {
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  const dx = (44 / scale) * (layer.flipX ? -1 : 1)
  const dy = (-layer.height / 2 - 16 / scale) * (layer.flipY ? -1 : 1)
  const x = layer.x + layer.width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad)
  const y = layer.y + layer.height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad)
  return { left: `${x * scale}px`, top: `${y * scale}px` }
}

export function Canvas({ editor }: { editor: AlmondEditor }) {
  const {
    mode,
    design,
    side,
    showRuler,
    showCutline,
    showSafety,
    layers,
    selected,
    spec,
    selectedLowDpi,
    selectedPrintWarning,
    zoom,
    svgRef,
    canvasAreaRef,
    marquee,
    layerBounds,
    startMarquee,
    group,
    removeGroup,
    startDrag,
    startResize,
    moveDrag,
    endDrag,
    canvasFit,
    handleSize,
    editable,
    patch,
    removeSelected,
  } = editor
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  )
  const cancelEdit = useRef(false)
  const scale = canvasFit * zoom
  const editingLayer = editing
    ? layers.find((layer) => layer.id === editing.id)
    : undefined
  useLeaveWarning(
    !!editing && !!editingLayer && editing.text !== (editingLayer.text ?? "")
  )
  const startTextEdit = () => {
    if (selected?.type === "text" && editable)
      setEditing({ id: selected.id, text: selected.text ?? "" })
  }
  const finishTextEdit = () => {
    const cancelled = cancelEdit.current
    cancelEdit.current = false
    if (
      !cancelled &&
      editingLayer &&
      editing &&
      editing.text !== (editingLayer.text ?? "")
    )
      patch(editingLayer.id, { text: editing.text })
    setEditing(null)
  }
  return (
    <div
      ref={canvasAreaRef}
      className="flex flex-1 items-center justify-center overflow-auto p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) startMarquee(event)
      }}
    >
      <div className="relative shrink-0">
        <svg
          ref={svgRef}
          role="img"
          aria-label={`${spec.label} ${side === "front" ? "앞면" : "뒷면"} 디자인`}
          viewBox={`0 0 ${design.widthMm} ${design.heightMm}`}
          style={{
            width: `${design.widthMm * canvasFit * zoom}px`,
            height: `${design.heightMm * canvasFit * zoom}px`,
            overflow: "visible",
          }}
          className="block shrink-0 touch-none bg-white shadow-xl outline outline-1 outline-offset-2 outline-[#222] select-none"
          onPointerDown={startMarquee}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={startTextEdit}
        >
          <defs>
            <clipPath id="almond-print-area">
              <rect width={design.widthMm} height={design.heightMm} />
            </clipPath>
          </defs>
          <Backdrop value={sideBackground(design, side)} />
          <g clipPath="url(#almond-print-area)">
            {layers.map((layer) =>
              layer.visible === false ? null : (
                <g
                  key={layer.id}
                  onPointerDown={(event) => startDrag(event, layer)}
                  className={
                    layer.locked ||
                    (mode === "customer" && layer.editable === false)
                      ? "cursor-default"
                      : "cursor-move"
                  }
                >
                  <LayerGraphic layer={layer} />
                  <rect
                    x={layer.x}
                    y={layer.y}
                    width={layer.width}
                    height={layer.height}
                    fill="transparent"
                  />
                </g>
              )
            )}
          </g>
          {selected && selected.visible !== false && (
            <g
              id="selection-outline"
              transform={`translate(${selected.x + selected.width / 2} ${selected.y + selected.height / 2}) rotate(${selected.rotation ?? 0}) scale(${selected.flipX ? -1 : 1} ${selected.flipY ? -1 : 1}) translate(${-selected.x - selected.width / 2} ${-selected.y - selected.height / 2})`}
            >
              <rect
                x={selected.x}
                y={selected.y}
                width={selected.width}
                height={selected.height}
                fill="none"
                stroke="#10c9c1"
                strokeWidth={1 / (canvasFit * zoom)}
                pointerEvents="none"
              />
              {(
                [
                  ["nw", 0, 0],
                  ["n", 0.5, 0],
                  ["ne", 1, 0],
                  ["e", 1, 0.5],
                  ["se", 1, 1],
                  ["s", 0.5, 1],
                  ["sw", 0, 1],
                  ["w", 0, 0.5],
                ] as const
              ).map(([handle, rx, ry]) => (
                <rect
                  key={handle}
                  role="button"
                  aria-label={`${handle} 크기 조절`}
                  x={selected.x + selected.width * rx - handleSize / 2}
                  y={selected.y + selected.height * ry - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  fill="white"
                  stroke="#10c9c1"
                  strokeWidth={1 / (canvasFit * zoom)}
                  className="cursor-pointer"
                  onPointerDown={(event) =>
                    startResize(event, selected, handle)
                  }
                />
              ))}
              <line
                x1={selected.x + selected.width / 2}
                y1={selected.y}
                x2={selected.x + selected.width / 2}
                y2={selected.y - handleSize * 2}
                stroke="#10c9c1"
                strokeWidth={1 / (canvasFit * zoom)}
                pointerEvents="none"
              />
              <circle
                role="button"
                aria-label="요소 회전"
                cx={selected.x + selected.width / 2}
                cy={selected.y - handleSize * 2}
                r={handleSize / 2}
                fill="white"
                stroke="#10c9c1"
                strokeWidth={1 / (canvasFit * zoom)}
                className="cursor-grab"
                onPointerDown={(event) =>
                  startResize(event, selected, "rotate")
                }
              />
            </g>
          )}
          {group.length > 1 &&
            group.map((layer) => {
              const b = layerBounds(layer)
              return (
                <rect
                  key={layer.id}
                  x={b.x0}
                  y={b.y0}
                  width={b.x1 - b.x0}
                  height={b.y1 - b.y0}
                  fill="none"
                  stroke="#10c9c1"
                  strokeWidth={1 / scale}
                  pointerEvents="none"
                />
              )
            })}
          {marquee && (
            <rect
              x={marquee.x0}
              y={marquee.y0}
              width={marquee.x1 - marquee.x0}
              height={marquee.y1 - marquee.y0}
              fill="rgba(16, 201, 193, 0.1)"
              stroke="#10c9c1"
              strokeWidth={1 / scale}
              strokeDasharray={`${4 / scale} ${3 / scale}`}
              pointerEvents="none"
            />
          )}
          {(showRuler || showCutline || showSafety) && (
            <CanvasGuides editor={editor} />
          )}
        </svg>
        {selected && selected.visible !== false && editable && !editing && (
          <div
            className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 gap-1"
            style={quickActionsAt(selected, scale)}
          >
            {selected.type === "text" && (
              <button
                type="button"
                aria-label="문구 수정"
                title="문구 수정"
                onClick={startTextEdit}
                className="flex size-6 items-center justify-center rounded bg-white text-[#10a8a1] shadow"
              >
                <Pencil size={14} />
              </button>
            )}
            <button
              type="button"
              aria-label="선택 요소 삭제"
              title="삭제"
              onClick={removeSelected}
              className="flex size-6 items-center justify-center rounded bg-white text-[#10a8a1] shadow"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
        {group.length > 1 && (
          <button
            type="button"
            aria-label="선택한 요소 모두 삭제"
            title={`${group.length}개 삭제`}
            onClick={removeGroup}
            className="absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded bg-white text-[#10a8a1] shadow"
            style={{
              left: `${Math.max(...group.map((layer) => layerBounds(layer).x1)) * scale}px`,
              top: `${Math.min(...group.map((layer) => layerBounds(layer).y0)) * scale - 16}px`,
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
        {editingLayer && editing && (
          <textarea
            autoFocus
            aria-label="문구 수정"
            value={editing.text}
            maxLength={500}
            onChange={(event) =>
              setEditing({ ...editing, text: event.target.value })
            }
            onFocus={(event) => event.currentTarget.select()}
            onBlur={finishTextEdit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                cancelEdit.current = true
                event.currentTarget.blur()
              } else if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey)
              )
                event.currentTarget.blur()
            }}
            className="absolute z-30 min-h-24 resize-none border border-[#10c9c1] bg-white p-2 text-base text-[#1a1c20] shadow-lg outline-none"
            style={{
              left: `${Math.max(0, editingLayer.x * scale)}px`,
              top: `${(editingLayer.y + editingLayer.height) * scale + 4}px`,
              width: `${Math.max(260, editingLayer.width * scale)}px`,
            }}
          />
        )}
        {selected && selectedPrintWarning && (
          <div
            role="status"
            title={
              selectedLowDpi
                ? "사진을 현재 크기로 인쇄하기에는 해상도가 낮습니다."
                : "인쇄 영역 밖의 부분은 출력되지 않습니다."
            }
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 bg-white px-2 py-1 text-xs font-semibold text-red-600 shadow"
            style={{
              left: `${Math.max(0, Math.min(design.widthMm, selected.x + selected.width / 2)) * canvasFit * zoom}px`,
              top: `${Math.max(0, Math.min(design.heightMm, selected.y + selected.height / 2)) * canvasFit * zoom}px`,
            }}
          >
            ⚠ 인쇄 비권장
          </div>
        )}
        <div
          aria-label="인쇄 안내선 범례"
          className="absolute top-0 left-full ml-3 w-24 space-y-2 bg-[#f5f5f4] text-sm"
        >
          <div className="border-b-2 border-[#222] pb-1">작업선</div>
          {showCutline && (
            <div className="border-b-2 border-[#f03838] pb-1 text-[#e32727]">
              재단선
            </div>
          )}
          {showSafety && (
            <div className="border-b-2 border-[#31b991] pb-1 text-[#16a77c]">
              안전선
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
