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
  setHistory: Dispatch<SetStateAction<Design[]>>
  side: "front" | "back"
  mode: EditorMode
  moveMode: boolean
  setSelectedId: (id: string | null) => void
}

export function useCanvasInteraction({
  design,
  setDesign,
  setHistory,
  side,
  mode,
  moveMode,
  setSelectedId,
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
  } | null>(null)

  useEffect(() => {
    if (!canvasAreaRef.current) return
    const observer = new ResizeObserver(([entry]) =>
      setCanvasSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    )
    observer.observe(canvasAreaRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const area = canvasAreaRef.current
    if (!area) return
    const zoomWheel = (event: WheelEvent) => {
      if (!event.altKey) return
      event.preventDefault()
      setZoom((value) =>
        Math.max(
          0.4,
          Math.min(
            2,
            Math.round((value + (event.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10
          )
        )
      )
    }
    area.addEventListener("wheel", zoomWheel, { passive: false })
    return () => area.removeEventListener("wheel", zoomWheel)
  }, [])

  const point = (event: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * design.widthMm) / rect.width,
      y: ((event.clientY - rect.top) * design.heightMm) / rect.height,
    }
  }
  const startDrag = (event: React.PointerEvent<SVGGElement>, layer: Layer) => {
    event.stopPropagation()
    setSelectedId(layer.id)
    if (
      moveMode ||
      layer.locked ||
      (mode === "customer" && layer.editable === false)
    )
      return
    const p = point(event)
    dragRef.current = { ...p, layer }
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
    if (!dragRef.current) return
    const p = point(event)
    const { layer, x, y, handle, rotationStart } = dragRef.current
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
    if (dragRef.current) {
      setHistory((items) => [
        ...items.slice(-29),
        {
          ...design,
          [side]: design[side].map((layer) =>
            layer.id === dragRef.current?.layer.id
              ? dragRef.current.layer
              : layer
          ),
        },
      ])
      dragRef.current = null
    }
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
    startDrag,
    startResize,
    moveDrag,
    endDrag,
    canvasFit,
    handleSize,
  }
}
