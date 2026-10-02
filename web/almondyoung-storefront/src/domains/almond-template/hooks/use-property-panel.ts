import { useState } from "react"
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
  const [imageCropOpen, setImageCropOpen] = useState(false)
  const [imageSizeLinked, setImageSizeLinked] = useState(true)
  const [brightness, setBrightness] = useState(50)
  const objectMoreOpen = !!selectedId && objectMoreId === selectedId
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
    imageCropOpen,
    setImageCropOpen,
    imageSizeLinked,
    setImageSizeLinked,
    brightness,
    setBrightness,
    objectMoreOpen,
    setImageSize,
  }
}

export type PropertyPanelState = ReturnType<typeof usePropertyPanel>
