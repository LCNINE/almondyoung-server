import { useState } from "react"
import { PRINT_PRODUCTS, PRINT_SPECS } from "../lib/catalog"
import {
  newDesign,
  updateLayer,
  type Design,
  type Layer,
} from "../lib/document"
import { makeLayer } from "../lib/layer"
import { textBoxFor } from "../components/graphic"

// 바뀌면 글자 덩치가 달라지는 속성. 이때 상자를 글자에 다시 맞춘다
const TEXT_SHAPE_KEYS = new Set([
  "text",
  "fontFamily",
  "fontWeight",
  "italic",
  "fontSize",
  "lineHeight",
  "widthScale",
])
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
  group: Layer[]
  setGroupIds: (ids: string[]) => void
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
  group,
  setGroupIds,
}: Params) {
  const [copied, setCopied] = useState<Layer[]>([])

  const fitText = (layer: Layer): Layer =>
    layer.type === "text"
      ? { ...layer, ...textBoxFor(layer, layer.fontSize ?? 10, design) }
      : layer
  const patch = (id: string, value: Partial<Layer>) => {
    const layer = layers.find((item) => item.id === id)
    const reshapes =
      layer?.type === "text" &&
      !("width" in value) &&
      Object.keys(value).some((key) => TEXT_SHAPE_KEYS.has(key))
    change(
      updateLayer(
        design,
        side,
        id,
        reshapes ? fitText({ ...layer, ...value }) : value
      )
    )
  }
  const add = (type: Layer["type"], extra: Partial<Layer> = {}) => {
    const layer = fitText({ ...makeLayer(type, design), ...extra })
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
  // 여러 개를 골랐으면 그 묶음을 통째로 복사한다. 합친 묶음은 붙여넣은 쪽도 새 묶음으로 합쳐 둔다
  const copySelected = () => {
    if (group.length > 1) setCopied(group)
    else if (selected) setCopied([selected])
  }
  const pasteCopied = () => {
    if (!copied.length) return
    const groupIds = new Map<string, string>()
    const pasted = copied.map((layer) => ({
      ...layer,
      id: crypto.randomUUID(),
      x: layer.x + 5,
      y: layer.y + 5,
      name: `${layer.name} 복사`,
      locked: false,
      groupId:
        layer.groupId &&
        (groupIds.get(layer.groupId) ??
          groupIds.set(layer.groupId, crypto.randomUUID()).get(layer.groupId)),
    }))
    change({ ...design, [side]: [...layers, ...pasted] })
    // 다시 붙이면 또 5mm 옆에 놓이게 복사본을 따라간다
    setCopied(pasted)
    if (pasted.length === 1) setSelectedId(pasted[0].id)
    else {
      setSelectedId(null)
      setGroupIds(pasted.map((layer) => layer.id))
    }
  }
  const cutSelected = () => {
    copySelected()
    if (group.length > 1) {
      change({
        ...design,
        [side]: layers.filter((layer) => !group.includes(layer)),
      })
      setSelectedId(null)
    } else removeSelected()
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
