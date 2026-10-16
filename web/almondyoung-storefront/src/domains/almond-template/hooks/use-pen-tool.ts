import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react"
import { updateLayer, type Design, type Layer } from "../lib/document"
import { makeLayer } from "../lib/layer"
import {
  fitPath,
  refitPathLayer,
  shapeOutline,
  smoothStroke,
  toAbsolute,
  toLocal,
  type PathPoint,
} from "../lib/path-shape"

type Params = {
  design: Design
  setDesign: Dispatch<SetStateAction<Design>>
  change: (design: Design) => void
  commit: (before: Design) => void
  side: "front" | "back"
  selected: Layer | undefined
  editable: boolean | undefined
  setSelectedId: (id: string | null) => void
  svgRef: RefObject<SVGSVGElement>
  handleSize: number
}

type Point = { x: number; y: number }
export type HandleKind = "anchor" | "in" | "out"

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const handleOf = (p: PathPoint, kind: "in" | "out") =>
  kind === "in"
    ? p.ix === undefined || p.iy === undefined
      ? null
      : { x: p.ix, y: p.iy }
    : p.ox === undefined || p.oy === undefined
      ? null
      : { x: p.ox, y: p.oy }

// 한쪽 핸들을 옮기면 반대쪽은 각도만 맞추고 길이는 그대로 둔다 (Alt 를 누르면 따로 움직인다)
export function moveHandle(
  point: PathPoint,
  kind: "in" | "out",
  to: Point,
  independent: boolean
): PathPoint {
  const next: PathPoint =
    kind === "in"
      ? { ...point, ix: to.x, iy: to.y }
      : { ...point, ox: to.x, oy: to.y }
  const other = handleOf(point, kind === "in" ? "out" : "in")
  if (independent || !other) return next
  const length = dist(other, point)
  const angle = Math.atan2(point.y - to.y, point.x - to.x)
  const mirrored = {
    x: point.x + Math.cos(angle) * length,
    y: point.y + Math.sin(angle) * length,
  }
  return kind === "in"
    ? { ...next, ox: mirrored.x, oy: mirrored.y }
    : { ...next, ix: mirrored.x, iy: mirrored.y }
}

// 꺾인 점은 이웃을 잇는 방향으로 핸들을 달아 부드럽게, 부드러운 점은 핸들을 떼어 꺾는다
export function toggleSmooth(
  points: PathPoint[],
  index: number,
  closed: boolean
) {
  const p = points[index]
  if (handleOf(p, "in") || handleOf(p, "out"))
    return points.map((item, i) =>
      i === index ? { x: item.x, y: item.y } : item
    )
  const at = (i: number) =>
    closed ? points[(i + points.length) % points.length] : points[i]
  const prev = at(index - 1) ?? p
  const next = at(index + 1) ?? p
  const length = Math.hypot(next.x - prev.x, next.y - prev.y)
  if (!length) return points
  const ux = (next.x - prev.x) / length
  const uy = (next.y - prev.y) / length
  const back = dist(prev, p) / 3
  const ahead = dist(next, p) / 3
  return points.map((item, i) =>
    i === index
      ? {
          ...item,
          ix: item.x - ux * back,
          iy: item.y - uy * back,
          ox: item.x + ux * ahead,
          oy: item.y + uy * ahead,
        }
      : item
  )
}

export function usePenTool({
  design,
  setDesign,
  change,
  commit,
  side,
  selected,
  editable,
  setSelectedId,
  svgRef,
  handleSize,
}: Params) {
  const [drawMode, setDrawMode] = useState<"pen" | "pencil" | null>(null)
  const penActive = drawMode === "pen"
  const pencilActive = drawMode === "pencil"
  const [smoothing, setSmoothing] = useState(50)
  // 방금 그은 연필 선의 원래 궤적. 보정을 바꾸면 이걸로 다시 다듬는다
  const lastStroke = useRef<{ id: string; raw: Point[] } | null>(null)
  const lastDrawnId = useRef<string | null>(null)
  const [stroke, setStroke] = useState<Point[] | null>(null)
  const [draft, setDraft] = useState<PathPoint[]>([])
  const [cursor, setCursor] = useState<Point | null>(null)
  const dragging = useRef<number | null>(null)
  const [pointEditId, setPointEditId] = useState<string | null>(null)
  const [activePoint, setActivePoint] = useState<number | null>(null)
  const editDrag = useRef<{
    index: number
    kind: HandleKind
    before: Design
    moved: boolean
  } | null>(null)
  const editing =
    pointEditId && selected?.id === pointEditId ? selected : undefined
  useEffect(() => {
    if (!pointEditId || selected?.id === pointEditId) return
    // 다른 요소를 골랐으면 점 편집도 끝낸다. 상자는 곡선에 다시 맞춘다
    setPointEditId(null)
    setActivePoint(null)
    setDesign((old) => {
      const layer = old[side].find((item) => item.id === pointEditId)
      return layer?.pathPoints
        ? updateLayer(old, side, layer.id, refitPathLayer(layer))
        : old
    })
  }, [pointEditId, selected?.id])

  const point = (event: PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * design.widthMm) / rect.width,
      y: ((event.clientY - rect.top) * design.heightMm) / rect.height,
    }
  }

  // 화면 1px 이 몇 mm 인지. 확대율에 따라 보정·닫힘 판정 거리를 맞춘다
  const px = handleSize / 9
  const clearDraft = () => {
    setDraft([])
    setStroke(null)
    dragging.current = null
  }
  const stopDrawing = () => {
    clearDraft()
    setDrawMode(null)
    setCursor(null)
  }
  const addPath = (
    points: PathPoint[],
    closed: boolean,
    extra: Partial<Layer>
  ) => {
    // 펜·연필로 마지막에 그은 선의 선 스타일을 다음 선이 물려받는다 (그 선을 지웠으면 기본값)
    const last = design[side].find((item) => item.id === lastDrawnId.current)
    const inherited: Partial<Layer> = last
      ? {
          stroke: last.stroke,
          strokeWidth: last.strokeWidth,
          strokeDash: last.strokeDash,
          strokeRound: last.strokeRound,
          opacity: last.opacity,
        }
      : extra
    const layer: Layer = {
      ...makeLayer("path", design),
      ...fitPath(points, closed),
      fill: "none",
      stroke: "#202020",
      strokeWidth: 0.4,
      pathClosed: closed,
      text: undefined,
      ...extra,
      ...inherited,
    }
    change({ ...design, [side]: [...design[side], layer] })
    setSelectedId(layer.id)
    lastDrawnId.current = layer.id
    return layer.id
  }
  // 하나를 완성해도 펜은 켜 둔다. 끄는 것은 Esc(그리던 선이 없을 때)나 도구 막대의 닫기다
  const finishDraft = (closed: boolean) => {
    // 더블클릭은 같은 자리에 점을 두 번 찍으므로 붙은 점을 하나로 합친다
    const points = draft.filter(
      (p, i) => i === 0 || dist(p, draft[i - 1]) > handleSize / 4
    )
    clearDraft()
    if (points.length >= 2) addPath(points, closed, {})
  }
  const chooseTool = (mode: "pen" | "pencil") => {
    if (draft.length >= 2) finishDraft(false)
    else clearDraft()
    if (drawMode === mode) return stopDrawing()
    setPointEditId(null)
    setSelectedId(null)
    setDrawMode(mode)
  }
  const exitDrawing = () => {
    if (drawMode) chooseTool(drawMode)
  }
  const togglePen = () => chooseTool("pen")
  const togglePencil = () => chooseTool("pencil")

  const pencilDown = (event: PointerEvent<SVGElement>) => {
    event.stopPropagation()
    if (event.button !== 0) return
    setStroke([point(event)])
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pencilMove = (event: PointerEvent<SVGElement>) => {
    const p = point(event)
    setCursor(p)
    setStroke((points) =>
      points && dist(points[points.length - 1], p) >= px * 1.5
        ? [...points, p]
        : points
    )
  }
  const pencilUp = () => {
    const raw = stroke
    setStroke(null)
    if (!raw || raw.length < 2) return
    const { points, closed } = smoothStroke(raw, px, smoothing)
    if (points.length < 2) return
    const id = addPath(points, closed, {
      name: "연필 선",
      strokeWidth: 0.6,
      strokeRound: true,
    })
    lastStroke.current = { id, raw }
  }
  // 방금 그은 선이 골라져 있으면 새 보정 세기로 바로 다시 다듬어 보여 준다
  const changeSmoothing = (level: number) => {
    setSmoothing(level)
    const last = lastStroke.current
    if (!last || selected?.id !== last.id) return
    if (selected.rotation || selected.flipX || selected.flipY) return
    const { points, closed } = smoothStroke(last.raw, px, level)
    if (points.length < 2) return
    setDesign((old) =>
      updateLayer(old, side, last.id, {
        ...fitPath(points, closed),
        pathClosed: closed,
      })
    )
  }

  const penDown = (event: PointerEvent<SVGElement>) => {
    event.stopPropagation()
    if (event.button !== 0) return
    const p = point(event)
    if (draft.length > 1 && dist(p, draft[0]) <= handleSize) {
      finishDraft(true)
      return
    }
    setDraft([...draft, p])
    dragging.current = draft.length
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const penMove = (event: PointerEvent<SVGElement>) => {
    const p = point(event)
    setCursor(p)
    const index = dragging.current
    if (index === null) return
    setDraft((points) =>
      points.map((item, i) => {
        if (i !== index) return item
        // 거의 안 끌었으면 꺾인 점으로 둔다
        if (dist(p, item) < handleSize / 2) return { x: item.x, y: item.y }
        return event.altKey
          ? { ...item, ox: p.x, oy: p.y }
          : {
              x: item.x,
              y: item.y,
              ox: p.x,
              oy: p.y,
              ix: item.x * 2 - p.x,
              iy: item.y * 2 - p.y,
            }
      })
    )
  }
  const penUp = () => {
    dragging.current = null
  }

  const startPointEdit = () => {
    if (!selected || !editable) return
    if (selected.type !== "path") {
      const outline = shapeOutline(selected)
      if (!outline) return
      change(
        updateLayer(design, side, selected.id, {
          type: "path",
          pathPoints: outline,
          pathClosed: true,
          shapeVariant: undefined,
          starPoints: undefined,
          starRatio: undefined,
          name: `${selected.name} (점 편집)`,
        })
      )
    }
    stopDrawing()
    setActivePoint(null)
    setPointEditId(selected.id)
  }
  const finishPointEdit = () => {
    const layer = editing
    setPointEditId(null)
    setActivePoint(null)
    if (!layer) return
    // 점을 상자 밖으로 끌었을 수 있으니 상자를 곡선에 다시 맞춘다
    setDesign((old) => updateLayer(old, side, layer.id, refitPathLayer(layer)))
  }

  const localPoint = (event: PointerEvent, layer: Layer) =>
    toLocal(layer, point(event))
  const normalize = (layer: Layer, p: Point) => ({
    x: Math.max(-10, Math.min(11, (p.x - layer.x) / layer.width)),
    y: Math.max(-10, Math.min(11, (p.y - layer.y) / layer.height)),
  })
  const editDown = (
    event: PointerEvent<SVGElement>,
    index: number,
    kind: HandleKind
  ) => {
    event.stopPropagation()
    setActivePoint(index)
    editDrag.current = { index, kind, before: design, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const editMove = (event: PointerEvent<SVGElement>) => {
    const drag = editDrag.current
    const layer = editing
    if (!drag || !layer?.pathPoints) return
    drag.moved = true
    const to = normalize(layer, localPoint(event, layer))
    const points = layer.pathPoints.map((p, i) => {
      if (i !== drag.index) return p
      if (drag.kind !== "anchor")
        return moveHandle(p, drag.kind, to, event.altKey)
      const dx = to.x - p.x
      const dy = to.y - p.y
      const shift = (value: number | undefined, by: number) =>
        value === undefined ? undefined : value + by
      return {
        ...p,
        x: to.x,
        y: to.y,
        ix: shift(p.ix, dx),
        iy: shift(p.iy, dy),
        ox: shift(p.ox, dx),
        oy: shift(p.oy, dy),
      }
    })
    setDesign((old) => updateLayer(old, side, layer.id, { pathPoints: points }))
  }
  const editUp = () => {
    const drag = editDrag.current
    editDrag.current = null
    if (drag?.moved) commit(drag.before)
  }
  const toggleActiveSmooth = (index: number) => {
    const layer = editing
    if (!layer?.pathPoints) return
    change(
      updateLayer(design, side, layer.id, {
        pathPoints: toggleSmooth(layer.pathPoints, index, !!layer.pathClosed),
      })
    )
  }
  const nudgeActivePoint = (dx: number, dy: number) => {
    const layer = editing
    if (!layer?.pathPoints || activePoint === null) return
    const mx = (dx * px) / layer.width
    const my = (dy * px) / layer.height
    const shift = (value: number | undefined, by: number) =>
      value === undefined ? undefined : value + by
    change(
      updateLayer(design, side, layer.id, {
        pathPoints: layer.pathPoints.map((p, i) =>
          i === activePoint
            ? {
                x: p.x + mx,
                y: p.y + my,
                ix: shift(p.ix, mx),
                iy: shift(p.iy, my),
                ox: shift(p.ox, mx),
                oy: shift(p.oy, my),
              }
            : p
        ),
      })
    )
  }
  const removeActivePoint = () => {
    const layer = editing
    if (!layer?.pathPoints || activePoint === null) return
    if (layer.pathPoints.length <= (layer.pathClosed ? 3 : 2)) return
    change(
      updateLayer(design, side, layer.id, {
        pathPoints: layer.pathPoints.filter((_, i) => i !== activePoint),
      })
    )
    setActivePoint(null)
  }

  const current = {
    drawMode,
    pointEditId,
    finishDraft,
    stopDrawing,
    draft,
    finishPointEdit,
    removeActivePoint,
    nudgeActivePoint,
  }
  const keys = useRef(current)
  keys.current = current
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const k = keys.current
      if (!k.drawMode && !k.pointEditId) return
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (k.pointEditId) return k.finishPointEdit()
        if (k.draft.length < 2) return k.stopDrawing()
        return k.finishDraft(false)
      }
      if (k.pointEditId && event.key.startsWith("Arrow")) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const step = event.shiftKey ? 10 : 1
        return k.nudgeActivePoint(
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0,
          event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
        )
      }
      // 그리던 점이 없으면 지우기는 편집기 몫(방금 그린 선 삭제)으로 넘긴다
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        (k.pointEditId || k.draft.length)
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (k.pointEditId) return k.removeActivePoint()
        setDraft((points) => points.slice(0, -1))
      }
    }
    // 편집기 단축키(삭제·Esc 선택 해제)보다 먼저 받아야 해서 capture 로 단다
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [])

  const draftPoints = draft
  const editPoints = editing?.pathPoints
    ? toAbsolute(editing.pathPoints, editing)
    : []

  return {
    drawMode,
    penActive,
    pencilActive,
    togglePen,
    togglePencil,
    stopDrawing,
    exitDrawing,
    smoothing,
    changeSmoothing,
    stroke,
    pencilDown,
    pencilMove,
    pencilUp,
    draftPoints,
    cursor,
    penDown,
    penMove,
    penUp,
    finishDraft,
    pointEditId,
    pointEditLayer: editing,
    editPoints,
    activePoint,
    startPointEdit,
    finishPointEdit,
    editDown,
    editMove,
    editUp,
    toggleActiveSmooth,
  }
}
