import type { PointerEvent, SVGProps } from "react"
import { Pencil, PenTool, X } from "lucide-react"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import type { Layer } from "../../lib/document"
import { mm } from "../../lib/layer"
import { BRUSHES, type BrushKind } from "../../hooks/use-pen-tool"
import { PrintColorPicker } from "../color-picker"
import { strokeStyle } from "../graphic"
import { pathData, type PathPoint } from "../../lib/path-shape"

const ACCENT = "#10c9c1"

// 펜촉 끝(왼쪽 위 2,2)이 점이 찍히는 자리다. 흰 테두리를 깔아 어두운 배경에서도 보이게 한다
const NIB =
  '<path d="M15.7 21.3a1 1 0 0 1-1.4 0l-1.6-1.6a1 1 0 0 1 0-1.4l5.6-5.6a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4z"/><path d="m18 13-1.4-6.9a1 1 0 0 0-.7-.8L3.2 2a1 1 0 0 0-1.2 1.2l3.4 12.7a1 1 0 0 0 .7.7L13 18"/><path d="m2.3 2.3 7.3 7.3"/><circle cx="11" cy="11" r="2"/>'
const penCursor = (closing: boolean) => {
  const mark = closing ? '<circle cx="19" cy="5" r="3"/>' : ""
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#fff" stroke-width="4">${NIB}${mark}</g><g stroke="#111" stroke-width="1.6">${NIB}${mark}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, crosshair`
}

export const layerTransform = (layer: Layer) => {
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  return `translate(${cx} ${cy}) rotate(${layer.rotation ?? 0}) scale(${layer.flipX ? -1 : 1} ${layer.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
}

function Handles({
  point,
  size,
  stroke,
  onGrab,
  dragProps,
}: {
  point: PathPoint
  size: number
  stroke: number
  onGrab?: (kind: "in" | "out") => (event: PointerEvent<SVGElement>) => void
  dragProps?: SVGProps<SVGCircleElement>
}) {
  return (
    <>
      {(
        [
          ["in", point.ix, point.iy],
          ["out", point.ox, point.oy],
        ] as const
      ).map(([kind, hx, hy]) =>
        hx === undefined || hy === undefined ? null : (
          <g key={kind}>
            <line
              x1={point.x}
              y1={point.y}
              x2={hx}
              y2={hy}
              stroke={ACCENT}
              strokeWidth={stroke}
              pointerEvents="none"
            />
            <circle
              role={onGrab ? "button" : undefined}
              aria-label={onGrab ? "곡선 핸들" : undefined}
              cx={hx}
              cy={hy}
              r={size * 0.35}
              fill="white"
              stroke={ACCENT}
              strokeWidth={stroke}
              className={onGrab ? "cursor-pointer" : undefined}
              pointerEvents={onGrab ? undefined : "none"}
              onPointerDown={onGrab?.(kind)}
              {...dragProps}
            />
          </g>
        )
      )}
    </>
  )
}

// 연필 끝(왼쪽 아래 2,22)이 선이 그어지는 자리다
const PENCIL =
  '<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/><path d="m15 5 4 4"/>'
const PENCIL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#fff" stroke-width="4">${PENCIL}</g><g stroke="#111" stroke-width="1.6">${PENCIL}</g></svg>`
)}") 2 22, crosshair`

export function PencilOverlay({ editor }: { editor: AlmondEditor }) {
  const { design, stroke, pencilStyle, pencilDown, pencilMove, pencilUp } =
    editor
  return (
    <g id="pencil-draft">
      <rect
        x={-design.widthMm * 2}
        y={-design.heightMm * 2}
        width={design.widthMm * 5}
        height={design.heightMm * 5}
        fill="transparent"
        style={{ cursor: PENCIL_CURSOR }}
        onPointerDown={pencilDown}
        onPointerMove={pencilMove}
        onPointerUp={pencilUp}
        onPointerCancel={pencilUp}
      />
      {stroke && stroke.length > 1 && (
        <polyline
          points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={pencilStyle.stroke}
          strokeWidth={pencilStyle.strokeWidth}
          opacity={pencilStyle.opacity}
          {...strokeStyle(
            { type: "path", ...pencilStyle },
            pencilStyle.strokeWidth ?? 0
          )}
          pointerEvents="none"
        />
      )}
    </g>
  )
}

// 그리는 동안 캔버스 위에 뜨는 도구 막대. 펜·연필을 바꾸고, 연필은 떨림 보정 세기를 고른다
export function DrawToolbar({ editor }: { editor: AlmondEditor }) {
  const {
    penActive,
    pencilActive,
    togglePen,
    togglePencil,
    exitDrawing,
    smoothing,
    changeSmoothing,
    drawStyle,
    penWidth,
    brushKind,
    chooseBrush,
    setInk,
  } = editor
  const width = drawStyle.strokeWidth ?? penWidth
  const tool = (
    on: boolean,
    Icon: typeof PenTool,
    label: string,
    key: string,
    pick: () => void
  ) => (
    <button
      type="button"
      aria-pressed={on}
      title={
        label === "펜"
          ? "펜 (P) — 클릭: 꺾인 점 · 끌기: 곡선 · 첫 점: 닫기 · Enter: 끝내기"
          : `${label} (${key})`
      }
      onClick={() => !on && pick()}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${on ? "bg-[#3972d5] text-white" : "hover:bg-white/10"}`}
    >
      <Icon size={16} />
      {label}
      <kbd
        className={`font-sans text-[10px] ${on ? "text-white/70" : "text-white/40"}`}
      >
        {key}
      </kbd>
    </button>
  )
  return (
    <div className="absolute -top-12 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-[#2c2c2c] p-1 text-xs whitespace-nowrap text-white shadow-lg">
      {tool(penActive, PenTool, "펜", "P", togglePen)}
      {tool(pencilActive, Pencil, "연필", "⇧P", togglePencil)}
      <span className="mx-1 h-5 border-l border-white/20" />
      {pencilActive && (
        <>
          {(Object.keys(BRUSHES) as BrushKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={brushKind === kind}
              onClick={() => chooseBrush(kind)}
              className={`rounded-md px-2 py-1 ${brushKind === kind ? "bg-white/20" : "hover:bg-white/10"}`}
            >
              {BRUSHES[kind].label}
            </button>
          ))}
          <span className="mx-1 h-5 border-l border-white/20" />
        </>
      )}
      <div className="px-1">
        <PrintColorPicker
          label="색"
          compact
          instant
          value={drawStyle.stroke ?? "#202020"}
          onApply={(color) => setInk({ color })}
        />
      </div>
      <label className="flex items-center gap-2 px-1" title="선 두께">
        두께
        <input
          type="range"
          aria-label="선 두께"
          min={mm(penWidth * 0.25)}
          max={mm(penWidth * 12)}
          step={mm(penWidth * 0.25)}
          value={width}
          onChange={(event) => setInk({ width: Number(event.target.value) })}
          className="w-24"
        />
        <span className="w-12 text-right text-white/70">{width}mm</span>
      </label>
      {pencilActive && (
        <label
          title="손떨림을 얼마나 다듬을지 정합니다. 0 이면 그은 그대로입니다."
          className="flex items-center gap-2 px-1"
        >
          보정
          <input
            type="range"
            aria-label="떨림 보정"
            min={0}
            max={100}
            step={5}
            value={smoothing}
            onChange={(event) => changeSmoothing(Number(event.target.value))}
            className="w-20"
          />
        </label>
      )}
      <button
        type="button"
        aria-label="그리기 끝내기"
        title="끝내기 (Esc)"
        onClick={exitDrawing}
        className="rounded-md p-1 hover:bg-white/10"
      >
        <X size={16} />
      </button>
    </div>
  )
}

export function PenOverlay({ editor }: { editor: AlmondEditor }) {
  const {
    design,
    draftPoints,
    cursor,
    penDown,
    penMove,
    penUp,
    finishDraft,
    handleSize,
    canvasFit,
    zoom,
  } = editor
  const stroke = 1 / (canvasFit * zoom)
  const last = draftPoints.at(-1)
  const closing =
    !!cursor &&
    draftPoints.length > 1 &&
    Math.hypot(cursor.x - draftPoints[0].x, cursor.y - draftPoints[0].y) <=
      handleSize
  return (
    <g id="pen-draft">
      <rect
        x={-design.widthMm * 2}
        y={-design.heightMm * 2}
        width={design.widthMm * 5}
        height={design.heightMm * 5}
        fill="transparent"
        style={{ cursor: penCursor(closing) }}
        onPointerDown={penDown}
        onPointerMove={penMove}
        onPointerUp={penUp}
        onDoubleClick={(event) => {
          event.stopPropagation()
          finishDraft(false)
        }}
      />
      <g pointerEvents="none">
        {draftPoints.length > 1 && (
          <path
            d={pathData(draftPoints, false)}
            fill="none"
            stroke={ACCENT}
            strokeWidth={stroke * 1.5}
          />
        )}
        {last && cursor && (
          <path
            d={`M${last.x} ${last.y} Q${last.ox ?? last.x} ${last.oy ?? last.y} ${cursor.x} ${cursor.y}`}
            fill="none"
            stroke={ACCENT}
            strokeWidth={stroke}
            strokeDasharray={`${4 * stroke} ${3 * stroke}`}
          />
        )}
        {last && <Handles point={last} size={handleSize} stroke={stroke} />}
        {draftPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={handleSize / 2}
            fill={i === 0 && closing ? ACCENT : "white"}
            stroke={ACCENT}
            strokeWidth={stroke}
          />
        ))}
      </g>
    </g>
  )
}

export function PointEditOverlay({ editor }: { editor: AlmondEditor }) {
  const {
    design,
    pointEditLayer: layer,
    editPoints,
    activePoint,
    editDown,
    editMove,
    editUp,
    toggleActiveSmooth,
    finishPointEdit,
    handleSize,
    canvasFit,
    zoom,
  } = editor
  if (!layer) return null
  const stroke = 1 / (canvasFit * zoom)
  const dragProps = {
    onPointerMove: editMove,
    onPointerUp: editUp,
    onPointerCancel: editUp,
  }
  return (
    <g id="point-edit" transform={layerTransform(layer)}>
      <rect
        x={-design.widthMm * 3}
        y={-design.heightMm * 3}
        width={design.widthMm * 7}
        height={design.heightMm * 7}
        fill="transparent"
        onPointerDown={(event) => {
          event.stopPropagation()
          finishPointEdit()
        }}
      />
      <path
        d={pathData(editPoints, !!layer.pathClosed)}
        fill="none"
        stroke={ACCENT}
        strokeWidth={stroke}
        pointerEvents="none"
      />
      {editPoints.map((p, i) => (
        <g key={i}>
          <Handles
            point={p}
            size={handleSize}
            stroke={stroke}
            onGrab={(kind) => (event) => editDown(event, i, kind)}
            dragProps={dragProps}
          />
          <circle
            role="button"
            aria-label={`${i + 1}번 점`}
            cx={p.x}
            cy={p.y}
            r={handleSize / 2}
            fill={activePoint === i ? ACCENT : "white"}
            stroke={ACCENT}
            strokeWidth={stroke}
            className="cursor-move"
            onPointerDown={(event) => editDown(event, i, "anchor")}
            onDoubleClick={(event) => {
              event.stopPropagation()
              toggleActiveSmooth(i)
            }}
            {...dragProps}
          />
        </g>
      ))}
    </g>
  )
}
