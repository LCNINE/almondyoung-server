import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import {
  resizeLayerFromHandle,
  updateLayer,
  type Design,
  type Layer,
} from "../lib/document"
import { mm } from "../lib/layer"
import { lineFromPoints, lineWidth, lineWorldPoints } from "../lib/line-shape"
import { textExtent } from "../components/graphic"
import {
  cropToBox,
  layerBounds,
  panCrop,
  scaleIntoBox,
  snapBox,
  unionBounds,
  type Box,
  type Guides,
} from "../lib/canvas-math"
import type { EditorMode } from "./use-template-storage"

type Params = {
  design: Design
  setDesign: Dispatch<SetStateAction<Design>>
  commit: (before: Design) => void
  side: "front" | "back"
  mode: EditorMode
  moveMode: boolean
  setSelectedId: (id: string | null) => void
  groupIds: string[]
  setGroupIds: (ids: string[]) => void
  cropId: string | null
  selectedId: string | null
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

// 텍스트는 상자를 꽉 채운다. 높이가 글자 크기를, 남는 가로 비율이 장평을 정한다
function stretchText(layer: Layer, box: Partial<Layer>): Partial<Layer> {
  if (layer.type !== "text" || !box.width || !box.height) return box
  const plain = textExtent(layer, false)
  const fontSize = Math.max(1, box.height / plain.height)
  return {
    ...box,
    fontSize: Math.round(fontSize * 100) / 100,
    widthScale:
      Math.round(
        Math.max(
          10,
          Math.min(1000, (box.width / (plain.width * fontSize)) * 100)
        ) * 10
      ) / 10,
  }
}

export function useCanvasInteraction({
  design,
  setDesign,
  commit,
  side,
  mode,
  moveMode,
  setSelectedId,
  groupIds,
  setGroupIds,
  cropId,
  selectedId,
}: Params) {
  const [guides, setGuides] = useState<Guides | null>(null)
  const [zoom, setZoom] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    x: number
    y: number
    layer: Layer
    handle?: string
    rotationStart?: number
    moved?: boolean
    added?: boolean
    group?: Layer[]
    groupBox?: Box
  } | null>(null)
  const marqueeStart = useRef<{ x: number; y: number } | null>(null)
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [panReady, setPanReady] = useState(false)
  const panning = moveMode || panReady
  const panningRef = useRef(panning)
  panningRef.current = panning
  const zoomAnchor = useRef<{
    x: number
    y: number
    u: number
    v: number
  } | null>(null)

  useEffect(() => {
    if (!canvasAreaRef.current) return
    // 스크롤바가 생기면 content-box 가 줄어 캔버스가 작아지고, 그러면 스크롤바가 사라져 다시 커지는 루프가 돈다
    const observer = new ResizeObserver(([entry]) =>
      setCanvasSize({
        width: entry.borderBoxSize[0].inlineSize - 64,
        height: entry.borderBoxSize[0].blockSize - 64,
      })
    )
    observer.observe(canvasAreaRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const area = canvasAreaRef.current
    if (!area) return
    const zoomWheel = (event: WheelEvent) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      // 트랙패드는 작은 delta 를 잔뜩 쏘므로 이벤트당 고정 10% 대신 delta 에 비례시킨다
      const delta = Math.max(-100, Math.min(100, event.deltaY))
      const rect = area.getBoundingClientRect()
      zoomAt(
        event.clientX - rect.left,
        event.clientY - rect.top,
        (value) => value * Math.exp(-delta * 0.002)
      )
    }
    area.addEventListener("wheel", zoomWheel, { passive: false })
    return () => area.removeEventListener("wheel", zoomWheel)
  }, [])

  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || typing(event.target)) return
      event.preventDefault()
      setPanReady(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setPanReady(false)
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])
  useEffect(() => {
    const area = canvasAreaRef.current
    if (!area) return
    area.style.cursor = panning ? "grab" : ""
  }, [panning])
  useEffect(() => {
    const area = canvasAreaRef.current
    if (!area) return
    let start: { x: number; y: number; left: number; top: number } | null = null
    const press = (event: PointerEvent) => {
      if (!panningRef.current && event.button !== 1) return
      event.preventDefault()
      event.stopPropagation()
      start = {
        x: event.clientX,
        y: event.clientY,
        left: area.scrollLeft,
        top: area.scrollTop,
      }
      area.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (!start) return
      area.scrollLeft = start.left - (event.clientX - start.x)
      area.scrollTop = start.top - (event.clientY - start.y)
    }
    const release = () => {
      start = null
    }
    area.addEventListener("pointerdown", press, { capture: true })
    area.addEventListener("pointermove", move)
    area.addEventListener("pointerup", release)
    return () => {
      area.removeEventListener("pointerdown", press, { capture: true })
      area.removeEventListener("pointermove", move)
      area.removeEventListener("pointerup", release)
    }
  }, [])

  const point = (event: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * design.widthMm) / rect.width,
      y: ((event.clientY - rect.top) * design.heightMm) / rect.height,
    }
  }
  const movable = (layer: Layer) =>
    !layer.locked && !(mode === "customer" && layer.editable === false)
  const startMarquee = (event: React.PointerEvent) => {
    setSelectedId(null)
    if (moveMode) return
    marqueeStart.current = point(event)
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const startDrag = (event: React.PointerEvent<SVGGElement>, layer: Layer) => {
    event.stopPropagation()
    if (event.shiftKey) {
      // Shift+클릭으로 하나씩 더하거나 뺀다
      const base = groupIds.length ? groupIds : selectedId ? [selectedId] : []
      const next = base.includes(layer.id)
        ? base.filter((id) => id !== layer.id)
        : [...base, layer.id]
      setSelectedId(next.length === 1 ? next[0] : null)
      if (next.length > 1) setGroupIds(next)
      return
    }
    const merged = layer.groupId
      ? design[side].filter(
          (item) => item.groupId === layer.groupId && item.visible !== false
        )
      : []
    const group =
      merged.length > 1 && !groupIds.includes(layer.id)
        ? merged
        : design[side].filter((item) => groupIds.includes(item.id))
    if (group.length > 1 && group.some((item) => item.id === layer.id)) {
      if (!groupIds.includes(layer.id)) {
        setSelectedId(null)
        setGroupIds(group.map((item) => item.id))
      }
      if (moveMode) return
      dragRef.current = { ...point(event), layer, group }
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
    // 잠긴 요소(대개 종이를 덮는 배경) 위에서 끌면 여러 개 고르기를 시작한다. 안 그러면 배경 때문에 끌어서 고를 자리가 없다
    if (layer.locked && !moveMode) return startMarquee(event)
    setSelectedId(layer.id)
    if (
      moveMode ||
      layer.locked ||
      (mode === "customer" && layer.editable === false)
    )
      return
    const p = point(event)
    if (event.ctrlKey || event.metaKey) {
      const copy = {
        ...layer,
        id: crypto.randomUUID(),
        name: `${layer.name} 복사`,
        locked: false,
      }
      setDesign((old) => {
        const index = old[side].findIndex((item) => item.id === layer.id)
        const next = [...old[side]]
        next.splice(index + 1, 0, copy)
        return { ...old, [side]: next }
      })
      setSelectedId(copy.id)
      dragRef.current = { ...p, layer: copy, added: true }
    } else dragRef.current = { ...p, layer }
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const startResize = (
    event: React.PointerEvent<SVGElement>,
    layer: Layer,
    handle: string
  ) => {
    event.stopPropagation()
    if (layer.locked || (mode === "customer" && layer.editable === false))
      return
    const p = point(event)
    dragRef.current = {
      ...p,
      layer,
      handle,
      rotationStart:
        handle === "rotate"
          ? Math.atan2(
              p.y - layer.y - layer.height / 2,
              p.x - layer.x - layer.width / 2
            )
          : undefined,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  const startGroupResize = (
    event: React.PointerEvent<SVGElement>,
    handle: string
  ) => {
    event.stopPropagation()
    const group = design[side].filter((item) => groupIds.includes(item.id))
    if (group.length < 2 || group.some((item) => !movable(item))) return
    const box = unionBounds(group)
    dragRef.current = {
      ...point(event),
      layer: group[0],
      handle,
      group,
      groupBox: box,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }
  // 끌고 있는 것 말고 다른 요소들 — 붙일 기준선이 된다
  const snapTargets = (except: string[]) =>
    design[side]
      .filter((item) => item.visible !== false && !except.includes(item.id))
      .map(layerBounds)
  const snapThreshold = () => 6 / (canvasFit * zoom)
  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const start = marqueeStart.current
    if (start) {
      const p = point(event)
      setMarquee({
        x0: Math.min(start.x, p.x),
        y0: Math.min(start.y, p.y),
        x1: Math.max(start.x, p.x),
        y1: Math.max(start.y, p.y),
      })
      return
    }
    if (!dragRef.current) return
    const p = point(event)
    const { layer, x, y, handle, rotationStart, group, groupBox } =
      dragRef.current
    if (!dragRef.current.moved && p.x === x && p.y === y) return
    dragRef.current.moved = true
    if (group && handle && groupBox) {
      const fake = {
        ...layer,
        rotation: 0,
        x: groupBox.x0,
        y: groupBox.y0,
        width: groupBox.x1 - groupBox.x0,
        height: groupBox.y1 - groupBox.y0,
      }
      const next = resizeLayerFromHandle(
        fake,
        handle,
        p.x - x,
        p.y - y,
        design.widthMm * 2,
        design.heightMm * 2,
        event.shiftKey
      )
      const to = {
        x0: next.x ?? fake.x,
        y0: next.y ?? fake.y,
        x1: (next.x ?? fake.x) + (next.width ?? fake.width),
        y1: (next.y ?? fake.y) + (next.height ?? fake.height),
      }
      setDesign((old) => ({
        ...old,
        [side]: old[side].map((item) => {
          const from = group.find((member) => member.id === item.id)
          return from
            ? {
                ...item,
                ...stretchText(from, scaleIntoBox(from, groupBox, to)),
              }
            : item
        }),
      }))
      return
    }
    if (group) {
      const box = unionBounds(group)
      const snap = event.altKey
        ? { dx: 0, dy: 0, guides: null }
        : snapBox(
            {
              x0: box.x0 + p.x - x,
              x1: box.x1 + p.x - x,
              y0: box.y0 + p.y - y,
              y1: box.y1 + p.y - y,
            },
            snapTargets(group.map((item) => item.id)),
            design,
            snapThreshold()
          )
      setGuides(snap.guides)
      setDesign((old) => {
        const dx = Math.max(
          ...group.map((item) => -old.widthMm - item.x),
          Math.min(
            ...group.map((item) => old.widthMm * 2 - item.x),
            p.x - x + snap.dx
          )
        )
        const dy = Math.max(
          ...group.map((item) => -old.heightMm - item.y),
          Math.min(
            ...group.map((item) => old.heightMm * 2 - item.y),
            p.y - y + snap.dy
          )
        )
        return {
          ...old,
          [side]: old[side].map((item) => {
            const from = group.find((member) => member.id === item.id)
            return from
              ? { ...item, x: mm(from.x + dx), y: mm(from.y + dy) }
              : item
          }),
        }
      })
      return
    }
    const rad = ((layer.rotation ?? 0) * Math.PI) / 180
    const dx = p.x - x,
      dy = p.y - y
    const localDx =
      (dx * Math.cos(rad) + dy * Math.sin(rad)) * (layer.flipX ? -1 : 1)
    const localDy =
      (-dx * Math.sin(rad) + dy * Math.cos(rad)) * (layer.flipY ? -1 : 1)
    // 선 끝점·꺾임점: 끈 점만 옮기고 상자·회전은 점들에서 다시 만든다
    if (handle?.startsWith("line-")) {
      const points = lineWorldPoints(layer)
      const index = Number(handle.slice(5))
      if (points.length === 2)
        points.splice(1, 0, {
          x: (points[0].x + points[1].x) / 2,
          y: (points[0].y + points[1].y) / 2,
        })
      points[index] = { x: points[index].x + dx, y: points[index].y + dy }
      const bent = index === 1 || !!layer.linePath
      setDesign((old) =>
        updateLayer(
          old,
          side,
          layer.id,
          lineFromPoints(
            bent ? points : [points[0], points[2]],
            lineWidth(layer) * 5
          )
        )
      )
      return
    }
    if (cropId === layer.id && handle !== "rotate") {
      setDesign((old) =>
        updateLayer(
          old,
          side,
          layer.id,
          handle
            ? cropToBox(
                layer,
                resizeLayerFromHandle(
                  layer,
                  handle,
                  localDx,
                  localDy,
                  old.widthMm,
                  old.heightMm,
                  event.shiftKey
                ) as { x: number; y: number; width: number; height: number }
              )
            : panCrop(layer, localDx, localDy)
        )
      )
      return
    }
    const snap =
      handle || event.altKey
        ? { dx: 0, dy: 0, guides: null }
        : snapBox(
            layerBounds({ ...layer, x: layer.x + dx, y: layer.y + dy }),
            snapTargets([layer.id]),
            design,
            snapThreshold()
          )
    setGuides(snap.guides)
    setDesign((old) =>
      updateLayer(old, side, layer.id, {
        ...(handle === "rotate" && rotationStart !== undefined
          ? {
              rotation: mm(
                Math.max(
                  -360,
                  Math.min(
                    360,
                    (layer.rotation ?? 0) +
                      ((Math.atan2(
                        p.y - layer.y - layer.height / 2,
                        p.x - layer.x - layer.width / 2
                      ) -
                        rotationStart) *
                        180) /
                        Math.PI
                  )
                )
              ),
            }
          : handle
            ? stretchText(
                layer,
                resizeLayerFromHandle(
                  layer,
                  handle,
                  localDx,
                  localDy,
                  old.widthMm,
                  old.heightMm,
                  event.shiftKey
                )
              )
            : {
                x: mm(
                  Math.max(
                    -old.widthMm,
                    Math.min(old.widthMm * 2, layer.x + p.x - x + snap.dx)
                  )
                ),
                y: mm(
                  Math.max(
                    -old.heightMm,
                    Math.min(old.heightMm * 2, layer.y + p.y - y + snap.dy)
                  )
                ),
              }),
      })
    )
  }
  const endDrag = () => {
    setGuides(null)
    if (marqueeStart.current) {
      marqueeStart.current = null
      setMarquee(null)
      if (!marquee) return
      // 걸치기만 해도 고르면 종이를 덮는 큰 요소가 늘 딸려 온다. 네모 안에 다 들어온 것만 고른다
      const hits = design[side].filter((layer) => {
        if (layer.visible === false || !movable(layer)) return false
        const b = layerBounds(layer)
        return (
          b.x0 >= marquee.x0 &&
          b.x1 <= marquee.x1 &&
          b.y0 >= marquee.y0 &&
          b.y1 <= marquee.y1
        )
      })
      const groups = new Set(hits.map((layer) => layer.groupId).filter(Boolean))
      const picked = design[side].filter(
        (layer) =>
          hits.includes(layer) || (!!layer.groupId && groups.has(layer.groupId))
      )
      if (picked.length === 1) setSelectedId(picked[0].id)
      else if (picked.length > 1) setGroupIds(picked.map((layer) => layer.id))
      return
    }
    const drag = dragRef.current
    dragRef.current = null
    const group = drag?.group
    if (group) {
      if (!drag.moved) return
      commit({
        ...design,
        [side]: design[side].map(
          (layer) => group.find((item) => item.id === layer.id) ?? layer
        ),
      })
      return
    }
    if (drag?.added) {
      const withoutCopy = {
        ...design,
        [side]: design[side].filter((layer) => layer.id !== drag.layer.id),
      }
      if (drag.moved) commit(withoutCopy)
      else setDesign(withoutCopy)
      return
    }
    if (!drag?.moved) return
    commit({
      ...design,
      [side]: design[side].map((layer) =>
        layer.id === drag.layer.id ? drag.layer : layer
      ),
    })
  }
  const canvasFit = Math.max(
    0.01,
    Math.min(
      (canvasSize.width - 180) / design.widthMm,
      (canvasSize.height - 64) / design.heightMm
    )
  )
  const handleSize = 9 / (canvasFit * zoom)
  // 캔버스 둘레에 화면 한 장만큼 여백을 둬서 어느 방향으로든 끌어 옮길 수 있게 한다
  const pad = {
    x: Math.max(canvasSize.width, 0),
    y: Math.max(canvasSize.height, 0),
  }

  // (x, y) 화면 지점 아래의 디자인 좌표가 확대 후에도 그 자리에 남게 스크롤을 맞춘다
  function zoomAt(x: number, y: number, next: (value: number) => number) {
    const area = canvasAreaRef.current
    const svg = svgRef.current
    if (!area || !svg) return
    const rect = svg.getBoundingClientRect()
    const areaRect = area.getBoundingClientRect()
    zoomAnchor.current = {
      x,
      y,
      u: (areaRect.left + x - rect.left) / rect.width,
      v: (areaRect.top + y - rect.top) / rect.height,
    }
    setZoom((value) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next(value))))
  }
  const zoomBy = (factor: number) => {
    const area = canvasAreaRef.current
    if (!area) return
    zoomAt(
      area.clientWidth / 2,
      area.clientHeight / 2,
      (value) => value * factor
    )
  }
  const zoomReset = () => {
    zoomAnchor.current = null
    setZoom(1)
    centerRef.current = true
  }
  const centerRef = useRef(true)
  useLayoutEffect(() => {
    centerRef.current = true
  }, [canvasSize.width, canvasSize.height, design.widthMm, design.heightMm])
  useLayoutEffect(() => {
    const area = canvasAreaRef.current
    const svg = svgRef.current
    if (!area || !svg) return
    const anchor = zoomAnchor.current
    zoomAnchor.current = null
    const width = design.widthMm * canvasFit * zoom
    const height = design.heightMm * canvasFit * zoom
    if (anchor && !centerRef.current) {
      area.scrollLeft = pad.x + anchor.u * width - anchor.x
      area.scrollTop = pad.y + anchor.v * height - anchor.y
      return
    }
    if (!centerRef.current) return
    centerRef.current = false
    area.scrollLeft = pad.x + width / 2 - area.clientWidth / 2
    area.scrollTop = pad.y + height / 2 - area.clientHeight / 2
  })

  return {
    zoom,
    setZoom,
    svgRef,
    canvasAreaRef,
    marquee,
    layerBounds,
    startMarquee,
    startDrag,
    startResize,
    moveDrag,
    endDrag,
    canvasFit,
    handleSize,
    panning,
    guides,
    startGroupResize,
    pad,
    zoomBy,
    zoomReset,
  }
}
