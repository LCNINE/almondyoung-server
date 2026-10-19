import {
  Check,
  Combine,
  Copy,
  Crop,
  ImageUp,
  Lock,
  LockOpen,
  Pencil,
  Split,
  Trash2,
  X,
} from "lucide-react"
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { Backdrop, LayerGraphic, photoBox } from "../graphic"
import {
  currentCrop,
  gaps,
  layerBounds as boxOf,
  unionBounds,
} from "../../lib/canvas-math"
import { layerPathData } from "../../lib/path-shape"
import { lineLocalPoints } from "../../lib/line-shape"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { CanvasGuides } from "./canvas-guides"
import { useLeaveWarning } from "../../hooks/use-leave-warning"
import { useImageSrc } from "../../lib/image-previews"
import {
  DrawToolbar,
  ERASER_CURSOR,
  PencilOverlay,
  PenOverlay,
  ShapeOverlay,
  PointEditOverlay,
  layerTransform,
} from "./pen-overlay"
import {
  layerImageDpi,
  SHAPE_TEXT_TYPES,
  sideBackground,
  type Layer,
} from "../../lib/document"

// 돌리거나 뒤집어도 화면에 보이는 상자의 오른쪽 바깥에 붙어 핸들을 가리지 않는다
function quickActionsAt(layer: Layer, scale: number) {
  const box = boxOf(layer)
  return { left: `${box.x1 * scale + 16}px`, top: `${box.y0 * scale}px` }
}

// 망고보드 선택 핸들: 모서리는 흰 테두리 시안 원, 변은 작은 회색 알약
function SelectionHandle({
  handle,
  x,
  y,
  scale,
  label,
  onPointerDown,
  hidden = false,
}: {
  handle: string
  x: number
  y: number
  scale: number
  label: string
  onPointerDown: (event: React.PointerEvent<SVGElement>) => void
  hidden?: boolean
}) {
  const corner = handle.length === 2
  const vertical = handle === "e" || handle === "w"
  return (
    <g
      role="button"
      aria-label={label}
      style={{ cursor: `${handle}-resize` }}
      onPointerDown={onPointerDown}
    >
      <circle cx={x} cy={y} r={12 / scale} fill="transparent" />
      {hidden ? null : corner ? (
        <circle
          cx={x}
          cy={y}
          r={5.5 / scale}
          fill="#42dfe5"
          stroke="#fff"
          strokeWidth={3 / scale}
          style={{
            filter: `drop-shadow(${1 / scale}px ${1 / scale}px 0 rgba(0,0,0,0.15))`,
          }}
        />
      ) : (
        <rect
          x={x - (vertical ? 3 : 8) / scale}
          y={y - (vertical ? 8 : 3) / scale}
          width={(vertical ? 6 : 16) / scale}
          height={(vertical ? 16 : 6) / scale}
          rx={3 / scale}
          fill="#fff"
          stroke="#b9bcc3"
          strokeWidth={1 / scale}
        />
      )}
    </g>
  )
}

// 망고보드 선 핸들: 양끝 흰 사각(끝점 이동), 가운데 흰 원(꺾임점). 곡선이면 제어선을 점선으로 보인다
function LineHandles({
  layer,
  scale,
  onPointerDown,
}: {
  layer: Layer
  scale: number
  onPointerDown: (event: React.PointerEvent<SVGElement>, index: number) => void
}) {
  const points = lineLocalPoints(layer)
  const [start, end] = [points[0], points[points.length - 1]]
  const bend = points.length === 3 ? points[1] : null
  const middle = bend ?? {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
  const size = 7 / scale
  return (
    <>
      {bend && layer.lineCurved && (
        <path
          d={`M${start.x},${start.y} L${bend.x},${bend.y} L${end.x},${end.y}`}
          fill="none"
          stroke="#70777F"
          strokeWidth={1 / scale}
          strokeDasharray={`${4 / scale} ${4 / scale}`}
          pointerEvents="none"
        />
      )}
      {[start, end].map((p, i) => (
        <g
          key={i}
          role="button"
          aria-label={i ? "선 끝점 이동" : "선 시작점 이동"}
          className="cursor-move"
          onPointerDown={(event) => onPointerDown(event, i ? 2 : 0)}
        >
          <circle cx={p.x} cy={p.y} r={12 / scale} fill="transparent" />
          <rect
            x={p.x - size / 2}
            y={p.y - size / 2}
            width={size}
            height={size}
            rx={1.5 / scale}
            fill="#fff"
            stroke="#3F4250"
            strokeWidth={1 / scale}
          />
        </g>
      ))}
      <g
        role="button"
        aria-label="선 꺾기"
        className="cursor-move"
        onPointerDown={(event) => onPointerDown(event, 1)}
      >
        <circle cx={middle.x} cy={middle.y} r={12 / scale} fill="transparent" />
        <circle
          cx={middle.x}
          cy={middle.y}
          r={6 / scale}
          fill="#fff"
          stroke="#b9bcc3"
          strokeWidth={1 / scale}
        />
      </g>
    </>
  )
}

function RotateHandle({
  x,
  y,
  scale,
  onPointerDown,
}: {
  x: number
  y: number
  scale: number
  onPointerDown: (event: React.PointerEvent<SVGElement>) => void
}) {
  const cy = y - 27.5 / scale
  const r = 10 / scale
  return (
    <>
      <line
        x1={x}
        y1={y}
        x2={x}
        y2={y - 17.5 / scale}
        stroke="#c2d7db"
        strokeWidth={1 / scale}
        strokeDasharray={`${3 / scale} ${2 / scale}`}
        pointerEvents="none"
      />
      <g
        role="button"
        aria-label="요소 회전"
        className="cursor-grab"
        onPointerDown={onPointerDown}
      >
        <circle
          cx={x}
          cy={cy}
          r={r}
          fill="#fff"
          stroke="#e0e1e5"
          strokeWidth={1 / scale}
        />
        <path
          d={`M${x + r * 0.45},${cy - r * 0.35} A${r * 0.5},${r * 0.5} 0 1 0 ${x + r * 0.5},${cy + r * 0.15}`}
          fill="none"
          stroke="#3F4250"
          strokeWidth={1.4 / scale}
          strokeLinecap="round"
        />
        <path
          d={`M${x + r * 0.15},${cy - r * 0.45} L${x + r * 0.5},${cy - r * 0.4} L${x + r * 0.45},${cy - r * 0.05}`}
          fill="none"
          stroke="#3F4250"
          strokeWidth={1.4 / scale}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </>
  )
}

// 망고보드 이미지 조절: 편집기 화면 전체를 어둡게 덮고 자르는 틀만 밝게 뚫는다. 버튼은 틀 바로 아래
function CropShade({
  frameRef,
  layer,
  onApply,
  onCancel,
  onReset,
}: {
  frameRef: React.RefObject<SVGRectElement>
  layer: Layer
  onApply: () => void
  onCancel: () => void
  onReset: () => void
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const next = frameRef.current?.getBoundingClientRect() ?? null
      setRect((prev) =>
        prev &&
        next &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next
      )
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [frameRef, layer])
  if (!rect) return null
  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-[10001]"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 100vmax rgba(0,0,0,0.45)",
        }}
      />
      <div
        role="toolbar"
        aria-label="이미지 조절"
        className="fixed z-[10002] flex -translate-x-1/2 items-center gap-2"
        style={{ left: rect.left + rect.width / 2, top: rect.bottom + 14 }}
      >
        <button
          type="button"
          aria-label="자르기 적용"
          title="적용 (Enter)"
          onClick={onApply}
          className="flex size-9 items-center justify-center rounded-full bg-white text-[#2e86c1] shadow-[0_0_5px_#d3d4d8]"
        >
          <Check size={20} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          aria-label="자르기 취소"
          title="취소"
          onClick={onCancel}
          className="flex size-9 items-center justify-center rounded-full bg-white text-[#ef4d4d] shadow-[0_0_5px_#d3d4d8]"
        >
          <X size={20} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={onReset}
          className="h-9 rounded-full bg-white px-4 text-[14px] whitespace-nowrap text-[#20232A] shadow-[0_0_5px_#d3d4d8]"
        >
          원본이미지
        </button>
      </div>
    </>,
    document.body
  )
}

// 망고보드 툴팁: 지연·페이드 없이 바로 뜨고, 단축키는 회색 둘째 줄
function QuickAction({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="group/qa relative m-1 flex size-[30px] items-center justify-center rounded-[6px] p-1 text-[#3F4250] first:mt-[5px] hover:bg-[#F3F5F8]"
    >
      {children}
      <span className="pointer-events-none absolute top-1/2 left-full z-30 ml-2 hidden -translate-y-1/2 rounded-[6px] bg-[rgba(42,41,47,0.95)] px-[10px] py-[7px] text-left text-[13px] leading-[18px] font-medium whitespace-nowrap text-[#F4F5F7] group-hover/qa:block">
        {label}
        {shortcut && <span className="block text-[#9a9ca3]">{shortcut}</span>}
      </span>
    </button>
  )
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
  const imageSrc = useImageSrc()
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
    cancelCrop,
    mergedGroup,
    mergeGroup,
    splitGroup,
    showOverflow,
    penActive,
    pencilActive,
    eraserActive,
    shapeActive,
    change,
    pointEditLayer,
    finishPointEdit,
    startPointEdit,
    duplicateSelected,
    imageFile,
  } = editor
  const replaceImageRef = useRef<HTMLInputElement>(null)
  const cropping = !!selected && cropId === selected.id
  const cropFrameRef = useRef<SVGRectElement>(null)
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
  const [alt, setAlt] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  useEffect(() => {
    const key = (event: KeyboardEvent) => setAlt(event.altKey)
    const reset = () => setAlt(false)
    window.addEventListener("keydown", key)
    window.addEventListener("keyup", key)
    window.addEventListener("blur", reset)
    return () => {
      window.removeEventListener("keydown", key)
      window.removeEventListener("keyup", key)
      window.removeEventListener("blur", reset)
    }
  }, [])
  const measured = groupBox ?? (selected ? layerBounds(selected) : null)
  const hovered = layers.find(
    (layer) =>
      layer.id === hoveredId &&
      layer.id !== selected?.id &&
      !group.some((item) => item.id === layer.id)
  )
  const measurements =
    alt && measured
      ? gaps(
          measured,
          hovered
            ? layerBounds(hovered)
            : { x0: 0, y0: 0, x1: design.widthMm, y1: design.heightMm }
        )
      : []
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
      {(pencilActive || eraserActive || shapeActive) && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-30 min-w-[405px] -translate-x-1/2 rounded-[6px] bg-[rgba(28,29,31,0.95)] p-2 px-4 text-center text-[14px] leading-[28px] whitespace-nowrap text-white">
          <p>
            <span className="rounded-[5px] bg-[#FEE869] pt-[2px] pr-[5px] pb-[3px] pl-[7px] text-[#20232A]">
              ESC
            </span>{" "}
            를 누르면 {eraserActive ? "지우개" : "그리기"} 모드가 종료됩니다.
          </p>
          <p>
            {eraserActive ? (
              <span className="text-[#FEE869]">
                펜이나 형광펜으로 그린 단일 요소만 지울 수 있습니다.
              </span>
            ) : (
              <>
                그리기 요소를{" "}
                <span className="text-[#FEE869]">
                  그룹화(Ctrl + G)한 뒤 즐겨찾기에 저장할 수 있습니다.
                </span>
              </>
            )}
          </p>
        </div>
      )}
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
              cursor: eraserActive ? ERASER_CURSOR : undefined,
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
                    onPointerDown={(event) => {
                      if (!eraserActive) return startDrag(event, layer)
                      // 지우개는 펜·형광펜으로 그린 획만 통째로 지운다
                      event.stopPropagation()
                      if (layer.brush && !layer.locked)
                        change({
                          ...design,
                          [side]: layers.filter((item) => item.id !== layer.id),
                        })
                    }}
                    onPointerEnter={() => setHoveredId(layer.id)}
                    onPointerLeave={() => setHoveredId(null)}
                    style={eraserActive ? { cursor: ERASER_CURSOR } : undefined}
                    className={
                      layer.locked ||
                      (mode === "customer" && layer.editable === false)
                        ? "cursor-default"
                        : "cursor-move"
                    }
                  >
                    <LayerGraphic layer={layer} />
                    {seeThrough(layer) && layer.type === "path" && (
                      // 속이 빈 펜·연필 선은 화면 1~2px 선만 잡혀 끌 수가 없어서, 둘레에 안 보이는 잡기 영역을 둔다
                      <path
                        d={layerPathData(layer)}
                        transform={layerTransform(layer)}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={Math.max(
                          layer.strokeWidth ?? 0,
                          10 / (canvasFit * zoom)
                        )}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
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
            {/* 그리는 중에도 방금 그린 선의 핸들은 잡혀야 하므로 오버레이를 선택 핸들 아래에 둔다 */}
            {shapeActive && <ShapeOverlay editor={editor} />}
            {selected && selected.visible !== false && !pointEditLayer && (
              <g
                id="selection-outline"
                transform={`translate(${selected.x + selected.width / 2} ${selected.y + selected.height / 2}) rotate(${selected.rotation ?? 0}) scale(${selected.flipX ? -1 : 1} ${selected.flipY ? -1 : 1}) translate(${-selected.x - selected.width / 2} ${-selected.y - selected.height / 2})`}
              >
                {cropping &&
                  selected.image &&
                  (() => {
                    // 망고보드 이미지 조절: 사진 전체를 보이고, 틀 밖(화면 전체)은 CropShade 가 어둡게 덮는다
                    const full = photoBox({
                      ...selected,
                      crop: currentCrop(selected),
                    })
                    const { x, y, width: w, height: h } = selected
                    const arm = 14 / scale
                    return (
                      <g pointerEvents="none">
                        <image href={imageSrc(selected.image)} {...full} />
                        <rect
                          ref={cropFrameRef}
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill="none"
                          stroke="#fff"
                          strokeWidth={1 / scale}
                          strokeDasharray={`${4 / scale} ${3 / scale}`}
                        />
                        <path
                          d={`M${x},${y + arm}V${y}H${x + arm} M${x + w - arm},${y}H${x + w}V${y + arm} M${x + w},${y + h - arm}V${y + h}H${x + w - arm} M${x + arm},${y + h}H${x}V${y + h - arm}`}
                          fill="none"
                          stroke="#fff"
                          strokeWidth={3 / scale}
                          strokeLinecap="square"
                        />
                      </g>
                    )
                  })()}
                {cropping ? null : selected.type === "line" ? (
                  <LineHandles
                    layer={selected}
                    scale={scale}
                    onPointerDown={(event, index) =>
                      startResize(event, selected, `line-${index}`)
                    }
                  />
                ) : (
                  <rect
                    x={selected.x}
                    y={selected.y}
                    width={selected.width}
                    height={selected.height}
                    fill="none"
                    stroke="#42dfe5"
                    strokeWidth={1 / scale}
                    pointerEvents="none"
                  />
                )}
                {(selected.type === "line" ? [] : handles).map(
                  ([handle, rx, ry]) => (
                    <SelectionHandle
                      key={handle}
                      handle={handle}
                      x={selected.x + selected.width * rx}
                      y={selected.y + selected.height * ry}
                      scale={scale}
                      label={`${handle} 크기 조절`}
                      hidden={cropping}
                      onPointerDown={(event) =>
                        startResize(event, selected, handle)
                      }
                    />
                  )
                )}
                {!cropping && (
                  <RotateHandle
                    x={selected.x + selected.width / 2}
                    y={selected.y}
                    scale={scale}
                    onPointerDown={(event) =>
                      startResize(event, selected, "rotate")
                    }
                  />
                )}
              </g>
            )}
            {editor.backgroundSelected && (
              <rect
                id="background-outline"
                x={0}
                y={0}
                width={design.widthMm}
                height={design.heightMm}
                fill="none"
                stroke="#42dfe5"
                strokeWidth={2 / scale}
                pointerEvents="none"
              />
            )}
            {groupBox && (
              <g id="group-outline">
                <rect
                  x={groupBox.x0}
                  y={groupBox.y0}
                  width={groupBox.x1 - groupBox.x0}
                  height={groupBox.y1 - groupBox.y0}
                  fill="none"
                  stroke={mergedGroup ? "#f03fb8" : "#42dfe5"}
                  strokeWidth={1 / scale}
                  strokeDasharray={`${4 / scale} ${3 / scale}`}
                  pointerEvents="none"
                />
                {handles.map(([handle, rx, ry]) => (
                  <SelectionHandle
                    key={handle}
                    handle={handle}
                    x={groupBox.x0 + (groupBox.x1 - groupBox.x0) * rx}
                    y={groupBox.y0 + (groupBox.y1 - groupBox.y0) * ry}
                    scale={scale}
                    label={`묶음 ${handle} 크기 조절`}
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
            {eraserActive &&
              hovered?.brush &&
              (() => {
                const box = boxOf(hovered)
                return (
                  <rect
                    x={box.x0}
                    y={box.y0}
                    width={box.x1 - box.x0}
                    height={box.y1 - box.y0}
                    fill="none"
                    stroke="#5ED6E6"
                    strokeWidth={1 / scale}
                    pointerEvents="none"
                  />
                )
              })()}
            {measurements.length > 0 && (
              <g id="gap-measurements" pointerEvents="none">
                {measurements.map((gap) => {
                  const cx = (gap.x1 + gap.x2) / 2
                  const cy = (gap.y1 + gap.y2) / 2
                  const label = `${gap.mm}mm`
                  return (
                    <g key={`${gap.x1},${gap.y1},${gap.x2},${gap.y2}`}>
                      <line
                        {...gap}
                        stroke="#ff2d87"
                        strokeWidth={1 / scale}
                        strokeDasharray={`${4 / scale} ${2 / scale}`}
                      />
                      <rect
                        x={cx - (label.length * 3.6 + 4) / scale}
                        y={cy - 8 / scale}
                        width={(label.length * 7.2 + 8) / scale}
                        height={16 / scale}
                        rx={3 / scale}
                        fill="#ff2d87"
                      />
                      <text
                        x={cx}
                        y={cy}
                        fill="#ffffff"
                        fontSize={11 / scale}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {label}
                      </text>
                    </g>
                  )
                })}
              </g>
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
            (editable ||
              (selected.locked &&
                (mode === "designer" || selected.editable !== false))) &&
            !editing &&
            !pointEditLayer &&
            !cropping && (
              <div
                role="toolbar"
                aria-label="선택 요소 빠른 작업"
                className="absolute z-20 flex w-[38px] flex-col rounded-[7px] bg-white shadow-[0_0_5px_#d3d4d8]"
                style={quickActionsAt(selected, scale)}
              >
                {selected.locked ? (
                  <QuickAction
                    label="잠금 풀기"
                    onClick={() => patch(selected.id, { locked: false })}
                  >
                    <LockOpen size={16} />
                  </QuickAction>
                ) : (
                  <>
                    {textEditable && (
                      <QuickAction
                        label={
                          selected.type === "text"
                            ? "문구 수정"
                            : "도형에 글자 넣기"
                        }
                        onClick={startTextEdit}
                      >
                        <Pencil size={16} />
                      </QuickAction>
                    )}
                    {selected.type === "image" && (
                      <QuickAction label="사진 자르기" onClick={startCrop}>
                        <Crop size={16} />
                      </QuickAction>
                    )}
                    {(selected.type === "frame" ||
                      (SHAPE_TEXT_TYPES.has(selected.type) &&
                        !!selected.image)) && (
                      <QuickAction
                        label="사진 바꾸기"
                        onClick={() => replaceImageRef.current?.click()}
                      >
                        <ImageUp size={16} />
                      </QuickAction>
                    )}
                    <QuickAction
                      label="잠금"
                      shortcut="Cmd + 2"
                      onClick={() => patch(selected.id, { locked: true })}
                    >
                      <Lock size={16} />
                    </QuickAction>
                    <span className="mx-1 border-t border-[#E6E7EA]" />
                    <QuickAction
                      label="복제"
                      shortcut="Cmd + D"
                      onClick={duplicateSelected}
                    >
                      <Copy size={16} />
                    </QuickAction>
                    <QuickAction
                      label="삭제"
                      shortcut="Delete / Backspace"
                      onClick={removeSelected}
                    >
                      <Trash2 size={16} />
                    </QuickAction>
                  </>
                )}
                <input
                  ref={replaceImageRef}
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
                  mergedGroup ? "그룹 풀기" : "선택한 요소 그룹으로 묶기"
                }
                title={mergedGroup ? "그룹 풀기" : "그룹으로 묶기"}
                onClick={mergedGroup ? splitGroup : mergeGroup}
                className="flex h-6 items-center gap-1 rounded bg-white px-1.5 text-xs whitespace-nowrap text-[#10a8a1] shadow"
              >
                {mergedGroup ? <Split size={14} /> : <Combine size={14} />}
                {mergedGroup ? "그룹 풀기" : "그룹"}
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
          {penActive && <DrawToolbar editor={editor} />}
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
            <CropShade
              frameRef={cropFrameRef}
              layer={selected}
              onApply={() => setCropId(null)}
              onCancel={cancelCrop}
              onReset={resetCrop}
            />
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
