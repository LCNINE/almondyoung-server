import { useState } from "react"
import { PRINT_PRODUCTS, PRINT_SPECS } from "../lib/catalog"
import { newDesign, type Design, type Layer } from "../lib/document"
import {
  isAutoTextName,
  makeLayer,
  mm,
  replaceEverywhere,
  textLayerName,
} from "../lib/layer"
import { unionBounds } from "../lib/canvas-math"
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
  const canEdit = (layer: Layer) =>
    !layer.locked && (mode === "designer" || layer.editable !== false)
  // 하나씩 바꿀 때처럼 글꼴이 바뀐 글상자는 새 글꼴 폭에 맞춰 다시 잰다
  const replaceAll = (patchOf: (layer: Layer) => Partial<Layer>) =>
    change(
      replaceEverywhere(design, canEdit, (layer) => {
        const given = patchOf(layer)
        return layer.type === "text" &&
          Object.keys(given).some((key) => TEXT_SHAPE_KEYS.has(key))
          ? fitText({ ...layer, ...given })
          : given
      })
    )
  const patchLayers = (
    ids: string[],
    value: Partial<Layer> | ((layer: Layer) => Partial<Layer>)
  ) =>
    change({
      ...design,
      [side]: layers.map((layer) => {
        if (!ids.includes(layer.id)) return layer
        const given = typeof value === "function" ? value(layer) : value
        const next =
          "text" in given && !("name" in given) && isAutoTextName(layer)
            ? { ...given, name: textLayerName(given.text) }
            : given
        const reshapes =
          layer.type === "text" &&
          !("width" in next) &&
          Object.keys(next).some((key) => TEXT_SHAPE_KEYS.has(key))
        return reshapes ? fitText({ ...layer, ...next }) : { ...layer, ...next }
      }),
    })
  const patch = (id: string, value: Partial<Layer>) => patchLayers([id], value)
  // 화면 기준으로 뒤집는다. 회전한 요소는 각도도 거울 쪽으로 바꾸고, 여러 개면 묶음 가운데를 축으로 자리도 바꾼다
  const flipLayers = (targets: Layer[], axis: "x" | "y") => {
    const movable = targets.filter(canEdit)
    if (!movable.length) return
    const box = unionBounds(movable)
    patchLayers(
      movable.map((layer) => layer.id),
      (layer) => ({
        ...(axis === "x"
          ? {
              flipX: !layer.flipX,
              x: mm(box.x0 + box.x1 - layer.x - layer.width),
            }
          : {
              flipY: !layer.flipY,
              y: mm(box.y0 + box.y1 - layer.y - layer.height),
            }),
        rotation: layer.rotation ? -layer.rotation : layer.rotation,
      })
    )
  }
  const add = (type: Layer["type"], extra: Partial<Layer> = {}) => {
    const base = { ...makeLayer(type, design), ...extra }
    const layer = fitText(
      type === "text" && !extra.name
        ? { ...base, name: textLayerName(base.text) }
        : base
    )
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
  const pasteLayers = (items: Layer[], followCopy: boolean) => {
    if (!items.length) return
    const groupIds = new Map<string, string>()
    const pasted = items.map((layer) => ({
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
    // 다시 붙이면 또 5mm 옆에 놓이게 복사본을 따라간다. 복제는 복사해 둔 것을 건드리지 않는다
    if (followCopy) setCopied(pasted)
    if (pasted.length === 1) setSelectedId(pasted[0].id)
    else {
      setSelectedId(null)
      setGroupIds(pasted.map((layer) => layer.id))
    }
  }
  const pasteCopied = () => pasteLayers(copied, true)
  const duplicateSelected = () =>
    pasteLayers(group.length > 1 ? group : selected ? [selected] : [], false)
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
  // 여럿이면 서로의 순서는 그대로 둔 채 한 덩어리로 옮긴다
  const setOrder = (position: "top" | "up" | "down" | "bottom") => {
    const targets =
      group.length > 1 ? group.filter(canEdit) : selected ? [selected] : []
    if (!targets.length) return
    const moving = layers.filter((layer) => targets.includes(layer))
    const rest = layers.filter((layer) => !targets.includes(layer))
    const restBelow = (layer: Layer) =>
      rest.filter((item) => layers.indexOf(item) < layers.indexOf(layer)).length
    const from = restBelow(moving[0])
    const target =
      position === "top"
        ? rest.length
        : position === "bottom"
          ? 0
          : position === "up"
            ? Math.min(restBelow(moving[moving.length - 1]) + 1, rest.length)
            : Math.max(0, from - 1)
    const next = [...rest.slice(0, target), ...moving, ...rest.slice(target)]
    change({ ...design, [side]: next })
    setMessage(
      next.every((layer, i) => layer === layers[i])
        ? "이미 해당 위치에 있습니다."
        : moving.length > 1
          ? `${moving.length}개 요소를 옮겼습니다.`
          : `${moving[0].name}: ${target + 1}/${next.length}번째 레이어로 이동했습니다.`
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
    patchLayers,
    replaceAll,
    flipLayers,
    canEdit,
    add,
    editable,
    removeSelected,
    copySelected,
    pasteCopied,
    duplicateSelected,
    cutSelected,
    setOrder,
    applyStarter,
    setGeometry,
  }
}
