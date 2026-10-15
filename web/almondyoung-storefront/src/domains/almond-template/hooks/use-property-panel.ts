import { useState, type CSSProperties, type PointerEvent } from "react"
import { mm } from "../lib/layer"
import type { AlmondEditor } from "./use-almond-editor"

export function usePropertyPanel({
  design,
  selected,
  selectedId,
  patch,
  setGeometry,
}: AlmondEditor) {
  const [brightnessOpen, setBrightnessOpen] = useState(false)
  const [imageMoreOpen, setImageMoreOpen] = useState(false)
  const [objectMoreId, setObjectMoreId] = useState<string | null>(null)
  const [imageSizeLinked, setImageSizeLinked] = useState(true)
  const [brightness, setBrightness] = useState(50)
  const objectMoreOpen = !!selectedId && objectMoreId === selectedId
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(
    null
  )
  const startPanelDrag = (event: PointerEvent<HTMLElement>) => {
    const aside = event.currentTarget.closest("aside")
    const parent = aside?.offsetParent
    if (!aside || !(parent instanceof HTMLElement) || event.button !== 0) return
    event.preventDefault()
    const box = aside.getBoundingClientRect()
    const area = parent.getBoundingClientRect()
    const grabX = event.clientX - box.left
    const grabY = event.clientY - box.top
    const clamp = (value: number, max: number) =>
      Math.max(0, Math.min(Math.max(0, max), value))
    const move = (e: globalThis.PointerEvent) =>
      setPanelPos({
        x: clamp(e.clientX - area.left - grabX, area.width - box.width),
        y: clamp(e.clientY - area.top - grabY, area.height - 40),
      })
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }
  const panelStyle: CSSProperties | undefined = panelPos
    ? { left: panelPos.x, top: panelPos.y, right: "auto" }
    : undefined
  const setImageSize = (field: "width" | "height", raw: number) => {
    if (!selected || !Number.isFinite(raw) || raw <= 0) return
    if (!imageSizeLinked) return setGeometry(field, raw)
    const current = selected[field]
    const scale = Math.min(
      raw / current,
      (design.widthMm * 2) / selected.width,
      (design.heightMm * 2) / selected.height
    )
    patch(selected.id, {
      width: mm(Math.max(1, selected.width * scale)),
      height: mm(Math.max(1, selected.height * scale)),
    })
  }

  return {
    brightnessOpen,
    setBrightnessOpen,
    imageMoreOpen,
    setImageMoreOpen,
    setObjectMoreId,
    imageSizeLinked,
    setImageSizeLinked,
    brightness,
    setBrightness,
    objectMoreOpen,
    setImageSize,
    startPanelDrag,
    panelStyle,
  }
}

export type PropertyPanelState = ReturnType<typeof usePropertyPanel>
