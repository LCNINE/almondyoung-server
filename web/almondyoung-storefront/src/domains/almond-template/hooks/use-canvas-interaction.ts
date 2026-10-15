import {
  useEffect,
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
}

type Box = { x0: number; y0: number; x1: number; y1: number }

function layerBounds(layer: Layer) {
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const halfW = (layer.width * cos + layer.height * sin) / 2
  const halfH = (layer.width * sin + layer.height * cos) / 2
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH }
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
}: Params) {
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
  } | null>(null)
  const marqueeStart = useRef<{ x: number; y: number } | null>(null)
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [panReady, setPanReady] = useState(false)
  const panning = moveMode || panReady

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
      setZoom((value) =>
        Math.max(0.4, Math.min(2, value * Math.exp(-delta * 0.0003)))
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
    if (!area || !panning) return
    let start: { x: number; y: number; left: number; top: number } | null = null
    const press = (event: PointerEvent) => {
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
    area.style.cursor = "grab"
    return () => {
      area.removeEventListener("pointerdown", press, { capture: true })
      area.removeEventListener("pointermove", move)
      area.removeEventListener("pointerup", release)
      area.style.cursor = ""
    }
  }, [panning])

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
    const group = design[side].filter((item) => groupIds.includes(item.id))
    if (group.length > 1 && groupIds.includes(layer.id)) {
      if (moveMode) return
      dragRef.current = { ...point(event), layer, group }
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
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
    const { layer, x, y, handle, rotationStart, group } = dragRef.current
    if (!dragRef.current.moved && p.x === x && p.y === y) return
    dragRef.current.moved = true
    if (group) {
      setDesign((old) => {
        const dx = Math.max(
          ...group.map((item) => -old.widthMm - item.x),
          Math.min(...group.map((item) => old.widthMm * 2 - item.x), p.x - x)
        )
        const dy = Math.max(
          ...group.map((item) => -old.heightMm - item.y),
          Math.min(...group.map((item) => old.heightMm * 2 - item.y), p.y - y)
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
            ? resizeLayerFromHandle(
                layer,
                handle,
                localDx,
                localDy,
                old.widthMm,
                old.heightMm
              )
            : {
                x: mm(
                  Math.max(
                    -old.widthMm,
                    Math.min(old.widthMm * 2, layer.x + p.x - x)
                  )
                ),
                y: mm(
                  Math.max(
                    -old.heightMm,
                    Math.min(old.heightMm * 2, layer.y + p.y - y)
                  )
                ),
              }),
      })
    )
  }
  const endDrag = () => {
    if (marqueeStart.current) {
      marqueeStart.current = null
      setMarquee(null)
      if (!marquee) return
      const hits = design[side].filter((layer) => {
        if (layer.visible === false || !movable(layer)) return false
        const b = layerBounds(layer)
        return (
          b.x0 < marquee.x1 &&
          b.x1 > marquee.x0 &&
          b.y0 < marquee.y1 &&
          b.y1 > marquee.y0
        )
      })
      if (hits.length === 1) setSelectedId(hits[0].id)
      else if (hits.length > 1) setGroupIds(hits.map((layer) => layer.id))
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
  }
}
