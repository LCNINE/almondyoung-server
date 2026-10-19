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
import { makeLayer, mm, pxUnit } from "../lib/layer"
import { lineFromPoints } from "../lib/line-shape"
import { DRAW_ART } from "../lib/draw-art"
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

type Ink = { color: string; width?: number }

export type BrushKind = "pen" | "highlighter"

export type BrushSetting = { color: string; size: number; opacity: number }

export type DrawShape =
  | "arrow"
  | "dash"
  | "circle"
  | "square"
  | "triangle"
  | `${"hand" | "graphic"}-${string}`

// 망고보드 그리기 도구 기본값. size 는 1080px 캔버스 기준 두께(1~100)라 규격 짧은 변에 비례해 mm 로 바꾼다
export const BRUSHES: Record<
  BrushKind,
  { label: string; round: boolean; presets: number[]; initial: BrushSetting }
> = {
  pen: {
    label: "펜",
    round: true,
    presets: [5, 8, 11],
    initial: { color: "#068FFF", size: 8, opacity: 100 },
  },
  highlighter: {
    label: "형광펜",
    round: false,
    presets: [25, 35, 45],
    initial: { color: "#FFDD65", size: 35, opacity: 70 },
  },
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
  const [drawMode, setDrawMode] = useState<
    "pen" | "pencil" | "eraser" | "shape" | null
  >(null)
  const penActive = drawMode === "pen"
  const pencilActive = drawMode === "pencil"
  const eraserActive = drawMode === "eraser"
  const shapeActive = drawMode === "shape"
  const [shapeKind, setShapeKind] = useState<DrawShape | null>(null)
  const [shapeSetting, setShapeSetting] = useState({
    color: "#CCCCCC",
    opacity: 100,
  })
  const [shapeDrag, setShapeDrag] = useState<{ from: Point; to: Point } | null>(
    null
  )
  // 빨리 끌면 마지막 이동과 손 떼기 사이에 다시 그려지지 않아 state 가 옛 위치다
  const shapeDragRef = useRef<{ from: Point; to: Point } | null>(null)
  const [smoothing, setSmoothing] = useState(0)
  // 방금 그은 연필 선의 원래 궤적. 보정을 바꾸면 이걸로 다시 다듬는다
  const lastStroke = useRef<{ id: string; raw: Point[] } | null>(null)
  const [brushKind, setBrushKind] = useState<BrushKind>("pen")
  // 도구마다 색·두께·불투명도를 따로 기억한다
  const [brushes, setBrushes] = useState<Record<BrushKind, BrushSetting>>({
    pen: BRUSHES.pen.initial,
    highlighter: BRUSHES.highlighter.initial,
  })
  const [inks, setInks] = useState<Record<"pen", Ink>>({
    pen: { color: "#202020" },
  })
  // 연필을 켜고 끌 때까지 그은 획. 두 번째 획부터 하나의 그룹으로 묶어 레이어 목록이 획마다 쌓이지 않게 한다
  const sketch = useRef<{ ids: string[]; group?: Partial<Layer> }>({ ids: [] })
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
  // mm 고정 두께는 입간판(600mm)에서 머리카락처럼 흐려서 규격 짧은 변에 비례시킨다(명함 0.75mm, 입간판 5mm)
  const penWidth = mm(
    Math.max(0.4, Math.min(design.widthMm, design.heightMm) / 120)
  )
  // 다음에 그을 선의 색·두께는 그리기 도구 막대에서 고른다. 두께를 안 고르면 규격에 맞춘 기본값이다
  const brush = BRUSHES[brushKind]
  const setting = brushes[brushKind]
  const pencilStyle: Partial<Layer> = {
    name: `${brush.label} 선`,
    brush: brushKind,
    stroke: setting.color,
    strokeWidth: mm(
      Math.max(
        0.1,
        (setting.size * Math.min(design.widthMm, design.heightMm)) / 1080
      )
    ),
    strokeRound: brush.round,
    opacity: setting.opacity / 100,
  }
  const penStyle: Partial<Layer> = {
    stroke: inks.pen.color,
    strokeWidth: inks.pen.width ?? penWidth,
  }
  const drawStyle = drawMode === "pen" ? penStyle : pencilStyle
  const setInk = (change: Partial<Ink>) =>
    setInks((current) => ({ pen: { ...current.pen, ...change } }))
  const setBrush = (change: Partial<BrushSetting>) =>
    setBrushes((current) => ({
      ...current,
      [brushKind]: { ...current[brushKind], ...change },
    }))
  // 그리기 패널의 펜·형광펜 타일. 이미 그리는 중이면 도구만 바꾸고 계속 그린다
  const chooseBrush = (kind: BrushKind) => {
    setBrushKind(kind)
    if (drawMode === "pencil") return
    chooseTool("pencil")
  }
  const chooseEraser = () => {
    if (drawMode !== "eraser") chooseTool("eraser")
  }
  // 선과 도형: 타일을 고르면 캔버스를 끌어 그 자리·크기로 그린다
  const chooseShape = (kind: DrawShape | null) => {
    setShapeKind(kind)
    if (drawMode !== "shape") chooseTool("shape")
  }
  const shapeDown = (event: PointerEvent<SVGElement>) => {
    event.stopPropagation()
    if (event.button !== 0) return
    const p = point(event)
    shapeDragRef.current = { from: p, to: p }
    setShapeDrag(shapeDragRef.current)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const shapeMove = (event: PointerEvent<SVGElement>) => {
    if (!shapeDragRef.current) return
    shapeDragRef.current = { ...shapeDragRef.current, to: point(event) }
    setShapeDrag(shapeDragRef.current)
  }
  const shapeUp = (event: PointerEvent<SVGElement>) => {
    const drag = shapeDragRef.current && {
      ...shapeDragRef.current,
      to: point(event),
    }
    shapeDragRef.current = null
    setShapeDrag(null)
    if (!drag) return
    const { from, to } = drag
    const art = shapeKind ? DRAW_ART[shapeKind] : undefined
    if (shapeKind && art) {
      // 누르기만 하면 짧은 변의 1/4 크기로 그 자리에 놓는다. 손그림은 가로세로 비율을 고정한다
      const dragged = dist(from, to) >= handleSize
      const fallback = Math.min(design.widthMm, design.heightMm) / 4
      const square = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
      const hand = shapeKind.startsWith("hand")
      const width = dragged
        ? hand
          ? square
          : Math.abs(to.x - from.x)
        : fallback
      const height = dragged
        ? hand
          ? square
          : Math.max(1, Math.abs(to.y - from.y))
        : fallback
      const layer: Layer = {
        ...makeLayer("rect", design),
        name: art.label,
        shapeVariant: shapeKind,
        fill: brushes.pen.color,
        stroke: "none",
        strokeWidth: 0,
        text: undefined,
        opacity: shapeSetting.opacity / 100,
        x: mm(dragged ? Math.min(from.x, to.x) : from.x - width / 2),
        y: mm(dragged ? Math.min(from.y, to.y) : from.y - height / 2),
        width: mm(Math.max(1, width)),
        height: mm(height),
      }
      change({ ...design, [side]: [...design[side], layer] })
      return setSelectedId(layer.id)
    }
    // 거의 안 끌었으면 그리지 않고 고른 것만 푼다
    if (!shapeKind || dist(from, to) < handleSize) return setSelectedId(null)
    const width = Math.max(0.1, Math.round(10 * pxUnit(design) * 100) / 100)
    const style = {
      stroke: shapeSetting.color,
      strokeWidth: width,
      opacity: shapeSetting.opacity / 100,
    }
    const layer: Layer =
      shapeKind === "arrow" || shapeKind === "dash"
        ? {
            ...makeLayer("line", design),
            ...style,
            name: shapeKind === "arrow" ? "화살표" : "점선",
            ...lineFromPoints([from, to], width * 5),
            lineEnd: shapeKind === "arrow" ? "arrow" : undefined,
            lineDash: shapeKind === "dash" ? [4, 2] : undefined,
          }
        : {
            ...makeLayer(
              shapeKind === "circle"
                ? "ellipse"
                : shapeKind === "square"
                  ? "rect"
                  : "triangle",
              design
            ),
            ...style,
            name:
              shapeKind === "circle"
                ? "원"
                : shapeKind === "square"
                  ? "사각형"
                  : "삼각형",
            fill: "none",
            text: undefined,
            x: mm(Math.min(from.x, to.x)),
            y: mm(Math.min(from.y, to.y)),
            width: mm(Math.abs(to.x - from.x)),
            height: mm(Math.abs(to.y - from.y)),
          }
    change({ ...design, [side]: [...design[side], layer] })
    setSelectedId(layer.id)
  }
  const addPath = (
    points: PathPoint[],
    closed: boolean,
    extra: Partial<Layer>,
    join: string[] = []
  ) => {
    const layer: Layer = {
      ...makeLayer("path", design),
      ...fitPath(points, closed),
      fill: "none",
      pathClosed: closed,
      text: undefined,
      ...extra,
    }
    change({
      ...design,
      [side]: [
        ...design[side].map((item) =>
          join.includes(item.id)
            ? { ...item, groupId: extra.groupId, groupName: extra.groupName }
            : item
        ),
        layer,
      ],
    })
    // 그은 선을 고르면 핸들이 다음 획을 가린다. 다듬으려면 도구를 끄고 고른다
    setSelectedId(null)
    return layer.id
  }
  // 하나를 완성해도 펜은 켜 둔다. 끄는 것은 Esc(그리던 선이 없을 때)나 도구 막대의 닫기다
  const finishDraft = (closed: boolean) => {
    // 더블클릭은 같은 자리에 점을 두 번 찍으므로 붙은 점을 하나로 합친다
    const points = draft.filter(
      (p, i) => i === 0 || dist(p, draft[i - 1]) > handleSize / 4
    )
    clearDraft()
    if (points.length >= 2) addPath(points, closed, penStyle)
  }
  const chooseTool = (mode: "pen" | "pencil" | "eraser" | "shape") => {
    sketch.current = { ids: [] }
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
    const session = sketch.current
    if (session.ids.length && !session.group) {
      const drawn = new Set(
        design[side]
          .filter((item) => item.groupName?.startsWith("연필 그림"))
          .map((item) => item.groupId)
      ).size
      session.group = {
        groupId: crypto.randomUUID(),
        groupName: `연필 그림 ${drawn + 1}`,
      }
    }
    const id = addPath(
      points,
      closed,
      { ...pencilStyle, ...session.group },
      session.ids
    )
    session.ids.push(id)
    lastStroke.current = { id, raw }
  }
  // 방금 그은 선이 골라져 있으면 새 보정 세기로 바로 다시 다듬어 보여 준다
  const changeSmoothing = (level: number) => {
    setSmoothing(level)
    const last = lastStroke.current
    const drawn = design[side].find((item) => item.id === last?.id)
    if (!last || !drawn || drawn.rotation || drawn.flipX || drawn.flipY) return
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
    eraserActive,
    chooseEraser,
    shapeActive,
    shapeKind,
    chooseShape,
    shapeSetting,
    setShapeSetting,
    shapeDrag,
    shapeDown,
    shapeMove,
    shapeUp,
    brushes,
    setBrush,
    togglePen,
    togglePencil,
    stopDrawing,
    exitDrawing,
    smoothing,
    changeSmoothing,
    stroke,
    pencilStyle,
    drawStyle,
    penWidth,
    brushKind,
    chooseBrush,
    setInk,
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
