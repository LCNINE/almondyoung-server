import { useState } from "react"
import { PRINT_PRODUCTS, PRINT_SPECS } from "../lib/catalog"
import {
  newDesign,
  updateLayer,
  type Design,
  type Layer,
} from "../lib/document"
import { makeLayer } from "../lib/layer"
import type { EditorMode } from "./use-template-storage"

type Params = {
  design: Design
  change: (design: Design) => void
  side: "front" | "back"
  layers: Layer[]
  selected: Layer | undefined
  mode: EditorMode
  productId: string
  size: string
  setSelectedId: (id: string | null) => void
  setMessage: (message: string) => void
}

export function useLayerActions({
  design,
  change,
  side,
  layers,
  selected,
  mode,
  productId,
  size,
  setSelectedId,
  setMessage,
}: Params) {
  const [copied, setCopied] = useState<Layer | null>(null)

  const patch = (id: string, value: Partial<Layer>) =>
    change(updateLayer(design, side, id, value))
  const add = (type: Layer["type"], extra: Partial<Layer> = {}) => {
    const layer = { ...makeLayer(type, design), ...extra }
    change({ ...design, [side]: [...layers, layer] })
    setSelectedId(layer.id)
  }
  const editable =
    selected &&
    !selected.locked &&
    (mode === "designer" || selected.editable !== false)
  const removeSelected = () => {
    if (!selected || !editable) return
    change({
      ...design,
      [side]: layers.filter((layer) => layer.id !== selected.id),
    })
    setSelectedId(null)
  }
  const copySelected = () => {
    if (selected) setCopied(selected)
  }
  const pasteCopied = () => {
    if (copied)
      add(copied.type, {
        ...copied,
        id: crypto.randomUUID(),
        x: copied.x + 5,
        y: copied.y + 5,
        name: `${copied.name} 복사`,
        locked: false,
      })
  }
  const cutSelected = () => {
    copySelected()
    removeSelected()
  }
  const setOrder = (position: "top" | "up" | "down" | "bottom") => {
    if (!selected) return
    const next = [...layers]
    const index = next.findIndex((item) => item.id === selected.id)
    next.splice(index, 1)
    const target =
      position === "top"
        ? next.length
        : position === "bottom"
          ? 0
          : position === "up"
            ? Math.min(index + 1, next.length)
            : Math.max(0, index - 1)
    next.splice(target, 0, selected)
    change({ ...design, [side]: next })
    setMessage(
      index === target
        ? "이미 해당 위치에 있습니다."
        : `${selected.name}: ${target + 1}/${next.length}번째 레이어로 이동했습니다.`
    )
  }
  const applyStarter = (id: string) => {
    if (productId && id !== productId) return
    const item = PRINT_PRODUCTS[id]
    if (!item) return
    const next = newDesign(item.kind, id)
    next.title = item.title
    const requestedSize = PRINT_SPECS[item.kind].sizes.find(
      ([w, h]) => `${w}x${h}` === size
    )
    if (requestedSize) [next.widthMm, next.heightMm] = requestedSize
    const title = makeLayer("text", next)
    title.name = "제목"
    title.text = item.title.replace(/\s*\d+\s*$/, "")
    title.x = next.widthMm * 0.1
    title.y = next.heightMm * 0.22
    title.width = next.widthMm * 0.8
    title.height = next.heightMm * 0.18
    title.fontSize = Math.min(next.widthMm / 8, next.heightMm / 8)
    title.align = "center"
    title.fontWeight = "bold"
    const detail = makeLayer("text", next)
    detail.name = "고객 편집 문구"
    detail.text = "이벤트 내용과 연락처를 입력하세요"
    detail.x = next.widthMm * 0.12
    detail.y = next.heightMm * 0.53
    detail.width = next.widthMm * 0.76
    detail.height = next.heightMm * 0.1
    detail.fontSize = Math.min(next.widthMm / 18, next.heightMm / 18)
    detail.align = "center"
    change({ ...next, front: [title, detail] })
    setSelectedId(null)
    setMessage("시작 시안을 불러왔습니다. 인쇄 전 내용과 규격을 확인하세요.")
  }
  const setGeometry = (field: "x" | "y" | "width" | "height", raw: number) => {
    if (!selected || !Number.isFinite(raw)) return
    const limit =
      field === "x" || field === "width" ? design.widthMm : design.heightMm
    const value = Math.max(
      field === "width" || field === "height" ? 1 : -limit,
      Math.min(raw, limit * 2)
    )
    patch(selected.id, { [field]: value })
  }

  return {
    copied,
    patch,
    add,
    editable,
    removeSelected,
    copySelected,
    pasteCopied,
    cutSelected,
    setOrder,
    applyStarter,
    setGeometry,
  }
}
