import { Check, Combine, Pencil, Split, Trash2 } from "lucide-react"
import { useRef, useState } from "react"
import { Backdrop, LayerGraphic, photoBox } from "../graphic"
import { currentCrop, unionBounds } from "../../lib/canvas-math"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { CanvasGuides } from "./canvas-guides"
import { useLeaveWarning } from "../../hooks/use-leave-warning"
import { imageSrc } from "../../lib/image-ref"
import {
  DrawToolbar,
  PencilOverlay,
  PenOverlay,
  PointEditOverlay,
} from "./pen-overlay"
import {
  layerImageDpi,
  SHAPE_TEXT_TYPES,
  sideBackground,
  type Layer,
} from "../../lib/document"

function quickActionsAt(layer: Layer, scale: number) {
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  const dx = (44 / scale) * (layer.flipX ? -1 : 1)
  const dy = (-layer.height / 2 - 16 / scale) * (layer.flipY ? -1 : 1)
  const x = layer.x + layer.width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad)
  const y = layer.y + layer.height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad)
  return { left: `${x * scale}px`, top: `${y * scale}px` }
}

// 채우기 없는 도형은 안쪽이 클릭을 받지 않아 뒤에 깔린 요소를 누를 수 있다. 테두리 선은 그대로 잡힌다
function seeThrough(layer: Layer) {
  return (
    SHAPE_TEXT_TYPES.has(layer.type) &&
    layer.fill === "none" &&
    !layer.image &&
    !layer.text
  )
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
    pad,
    guides,
    startGroupResize,
    cropId,
    setCropId,
    startCrop,
    resetCrop,
    mergedGroup,
    mergeGroup,
    splitGroup,
    showOverflow,
    penActive,
    pencilActive,
    pointEditLayer,
    finishPointEdit,
    startPointEdit,
  } = editor
  const cropping = !!selected && cropId === selected.id
  const groupBox = group.length > 1 ? unionBounds(group) : null
  const handles = [
    ["nw", 0, 0],
    ["n", 0.5, 0],
    ["ne", 1, 0],
    ["e", 1, 0.5],
    ["se", 1, 1],
    ["s", 0.5, 1],
    ["sw", 0, 1],
    ["w", 0, 0.5],
  ] as const
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
  const textEditable =
    !!selected &&
    (selected.type === "text" || SHAPE_TEXT_TYPES.has(selected.type))
  const startTextEdit = () => {
    if (selected && textEditable && editable)
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
      className="flex-1 overflow-auto"
      onPointerDown={(event) => {
        if (
          event.target === event.currentTarget ||
          event.target === event.currentTarget.firstChild
        )
          startMarquee(event)
      }}
    >
      <div className="w-max" style={{ padding: `${pad.y}px ${pad.x}px` }}>
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
            onDoubleClick={() =>
              selected?.type === "image"
                ? startCrop()
                : selected?.type === "path"
                  ? startPointEdit()
                  : startTextEdit()
            }
          >
            <defs>
              <clipPath id="almond-print-area">
                <rect width={design.widthMm} height={design.heightMm} />
              </clipPath>
            </defs>
            <Backdrop value={sideBackground(design, side)} />
            {showOverflow && (
              // 작업영역 밖으로 나간 부분을 흐리게 보여준다. 인쇄·저장 파일에서는 빠진다
              <g id="overflow-ghost" opacity={0.3} pointerEvents="none">
                {layers.map((layer) => (
                  <LayerGraphic key={layer.id} layer={layer} />
                ))}
              </g>
            )}
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
                    {!seeThrough(layer) && (
                      <rect
                        x={layer.x}
                        y={layer.y}
                        width={layer.width}
                        height={layer.height}
                        fill="transparent"
                      />
                    )}
                  </g>
                )
              )}
            </g>
            {selected && selected.visible !== false && !pointEditLayer && (
              <g
                id="selection-outline"
                transform={`translate(${selected.x + selected.width / 2} ${selected.y + selected.height / 2}) rotate(${selected.rotation ?? 0}) scale(${selected.flipX ? -1 : 1} ${selected.flipY ? -1 : 1}) translate(${-selected.x - selected.width / 2} ${-selected.y - selected.height / 2})`}
              >
                {cropping && selected.image && (
                  <>
                    <image
                      href={imageSrc(selected.image)}
                      {...photoBox({
                        ...selected,
                        crop: currentCrop(selected),
                      })}
                      opacity={0.35}
                      pointerEvents="none"
                    />
                    <rect
                      {...(({ x, y, width, height }) => ({
                        x,
                        y,
                        width,
                        height,
                      }))(
                        photoBox({ ...selected, crop: currentCrop(selected) })
                      )}
                      fill="none"
                      stroke="#555"
                      strokeWidth={1 / scale}
                      strokeDasharray={`${4 / scale} ${3 / scale}`}
                      pointerEvents="none"
                    />
                  </>
                )}
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
            {groupBox && (
              <g id="group-outline">
                <rect
                  x={groupBox.x0}
                  y={groupBox.y0}
                  width={groupBox.x1 - groupBox.x0}
                  height={groupBox.y1 - groupBox.y0}
                  fill="none"
                  stroke="#10c9c1"
                  strokeWidth={1 / scale}
                  strokeDasharray={`${4 / scale} ${3 / scale}`}
                  pointerEvents="none"
                />
                {handles.map(([handle, rx, ry]) => (
                  <rect
                    key={handle}
                    role="button"
                    aria-label={`묶음 ${handle} 크기 조절`}
                    x={
                      groupBox.x0 +
                      (groupBox.x1 - groupBox.x0) * rx -
                      handleSize / 2
                    }
                    y={
                      groupBox.y0 +
                      (groupBox.y1 - groupBox.y0) * ry -
                      handleSize / 2
                    }
                    width={handleSize}
                    height={handleSize}
                    fill="white"
                    stroke="#10c9c1"
                    strokeWidth={1 / scale}
                    className="cursor-pointer"
                    onPointerDown={(event) => startGroupResize(event, handle)}
                  />
                ))}
              </g>
            )}
            {guides && (
              <g id="snap-guides" pointerEvents="none">
                {guides.x.map((x) => (
                  <line
                    key={`x${x}`}
                    x1={x}
                    x2={x}
                    y1={-design.heightMm}
                    y2={design.heightMm * 2}
                    stroke="#ff2d87"
                    strokeWidth={1 / scale}
                  />
                ))}
                {guides.y.map((y) => (
                  <line
                    key={`y${y}`}
                    y1={y}
                    y2={y}
                    x1={-design.widthMm}
                    x2={design.widthMm * 2}
                    stroke="#ff2d87"
                    strokeWidth={1 / scale}
                  />
                ))}
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
            {penActive && <PenOverlay editor={editor} />}
            {pencilActive && <PencilOverlay editor={editor} />}
            {pointEditLayer && <PointEditOverlay editor={editor} />}
          </svg>
          {selected &&
            selected.visible !== false &&
            editable &&
            !editing &&
            !pointEditLayer && (
              <div
                className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 gap-1"
                style={quickActionsAt(selected, scale)}
              >
                {textEditable && (
                  <button
                    type="button"
                    aria-label="문구 수정"
                    title={
                      selected.type === "text"
                        ? "문구 수정"
                        : "도형에 글자 넣기"
                    }
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
          {groupBox && (
            <div
              className="absolute z-20 flex -translate-x-full -translate-y-1/2 gap-1"
              style={{
                left: `${groupBox.x1 * scale}px`,
                top: `${groupBox.y0 * scale - 16}px`,
              }}
            >
              <button
                type="button"
                aria-label={
                  mergedGroup ? "합친 요소 풀기" : "선택한 요소 합치기"
                }
                title={mergedGroup ? "풀기" : "합치기"}
                onClick={mergedGroup ? splitGroup : mergeGroup}
                className="flex h-6 items-center gap-1 rounded bg-white px-1.5 text-xs whitespace-nowrap text-[#10a8a1] shadow"
              >
                {mergedGroup ? <Split size={14} /> : <Combine size={14} />}
                {mergedGroup ? "풀기" : "합치기"}
              </button>
              <button
                type="button"
                aria-label="선택한 요소 모두 삭제"
                title={`${group.length}개 삭제`}
                onClick={removeGroup}
                className="flex size-6 items-center justify-center rounded bg-white text-[#10a8a1] shadow"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
          {(penActive || pencilActive) && <DrawToolbar editor={editor} />}
          {pointEditLayer && (
            <div className="absolute -top-11 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded bg-[#303030] px-3 py-1.5 text-xs whitespace-nowrap text-white shadow">
              점·핸들을 끌어 모양을 바꾸세요 · 점 두 번 클릭: 곡선↔꺾기 ·
              Alt+끌기: 핸들 따로 · 방향키: 점 옮기기 · Delete: 점 지우기
              <button
                type="button"
                onClick={finishPointEdit}
                className="flex items-center gap-1 rounded bg-white px-2 py-0.5 font-semibold text-[#303030]"
              >
                <Check size={12} /> 완료
              </button>
            </div>
          )}
          {cropping && (
            <div className="absolute -top-11 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded bg-[#303030] px-3 py-1.5 text-xs whitespace-nowrap text-white shadow">
              모서리를 끌어 자르고, 안쪽을 끌어 사진 위치를 옮기세요
              <button
                type="button"
                onClick={resetCrop}
                className="rounded border border-white/40 px-2 py-0.5"
              >
                원래대로
              </button>
              <button
                type="button"
                onClick={() => setCropId(null)}
                className="flex items-center gap-1 rounded bg-white px-2 py-0.5 font-semibold text-[#303030]"
              >
                <Check size={12} /> 완료
              </button>
            </div>
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
              // 사진을 가리지 않게 사진 아래쪽 바깥에 붙인다 (위쪽엔 회전 손잡이·버튼이 있다)
              className="pointer-events-none absolute z-20 -translate-x-1/2 bg-white px-2 py-1 text-xs font-semibold whitespace-nowrap text-red-600 shadow"
              style={{
                left: `${(selected.x + selected.width / 2) * scale}px`,
                // 종이 밖으로 크게 넘친 사진은 사진 끝 대신 종이 아래에 붙여야 화면에 보인다
                top: `${Math.min(layerBounds(selected).y1, design.heightMm) * scale + 10}px`,
              }}
            >
              ⚠ 인쇄 비권장 ·{" "}
              {selectedLowDpi
                ? `${Math.floor(layerImageDpi(design.kind, selected))}dpi (권장 ${spec.minImageDpi}dpi 이상)`
                : "작업선 밖으로 나감"}
            </div>
          )}
          <div
            aria-label="인쇄 안내선 범례"
            className="pointer-events-none absolute top-0 left-full ml-3 w-24 space-y-2 bg-[#f5f5f4] text-sm"
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
    </div>
  )
}
