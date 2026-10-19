import { useCallback, useEffect, useState } from "react"
import { PRINT_PRODUCTS, PRINT_SPECS } from "../lib/catalog"
import {
  layerImageDpi,
  updateLayer,
  newDesign,
  printIssues,
  printWarnings,
  printsBack,
  type Design,
} from "../lib/document"
import { mm } from "../lib/layer"
import { useCanvasInteraction } from "./use-canvas-interaction"
import { useDesignHistory } from "./use-design-history"
import { useEditorShortcuts } from "./use-editor-shortcuts"
import { useImageTools } from "./use-image-tools"
import { useLayerActions } from "./use-layer-actions"
import { usePenTool } from "./use-pen-tool"
import { useAuthRetry } from "./use-auth-retry"
import { useDesignOrder } from "./use-design-order"
import { useTemplateExport } from "./use-template-export"
import { useTemplateStorage, type EditorMode } from "./use-template-storage"

export type Side = "front" | "back"
export type EditorTool =
  | "spec"
  | "text"
  | "image"
  | "background"
  | "template"
  | "layers"
  | "shape"
  | "clipart"
  | "qr"
export type AlmondEditorProps = {
  productId?: string
  mode?: EditorMode
  variantId?: string
  size?: string
  templateId?: string
  savedId?: string
  initialDesign?: Design
}

export function useAlmondEditor({
  productId = "",
  mode = "customer",
  variantId = "",
  size = "",
  templateId = "",
  savedId = "",
  initialDesign,
}: AlmondEditorProps) {
  const product = PRINT_PRODUCTS[productId]
  const { design, setDesign, history, future, change, commit, undo, redo } =
    useDesignHistory(() => {
      if (initialDesign) return initialDesign
      const initial = newDesign(product?.kind ?? "pet", productId)
      const matched = PRINT_SPECS[initial.kind].sizes.find(
        ([w, h]) => `${w}x${h}` === size
      )
      if (matched) [initial.widthMm, initial.heightMm] = matched
      return initial
    })
  const [side, setSide] = useState<Side>("front")
  const [removedBack, setRemovedBack] = useState<Pick<
    Design,
    "back" | "backBackground"
  > | null>(null)
  const [selectedId, selectOne] = useState<string | null>(null)
  const [groupIds, setGroupIds] = useState<string[]>([])
  const setSelectedId = useCallback((id: string | null) => {
    selectOne(id)
    setGroupIds([])
  }, [])
  const [guideMenuOpen, setGuideMenuOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [showRuler, setShowRuler] = useState(false)
  const [showCutline, setShowCutline] = useState(true)
  const [showSafety, setShowSafety] = useState(true)
  const [toast, setToast] = useState({ text: "", id: 0 })
  const message = toast.text
  const setMessage = useCallback(
    (text: string) => setToast((current) => ({ text, id: current.id + 1 })),
    []
  )
  useEffect(() => {
    if (!toast.text) return
    const timer = setTimeout(() => setToast((t) => ({ ...t, text: "" })), 3000)
    return () => clearTimeout(timer)
  }, [toast.id])
  const [tool, setTool] = useState<EditorTool>(
    mode === "customer" ? "image" : "template"
  )
  const [panelOpen, setPanelOpen] = useState(true)
  const [textDialog, setTextDialog] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpTab, setHelpTab] = useState<
    "editing" | "shortcuts" | "image" | "print"
  >("editing")
  const [moveMode, setMoveMode] = useState(false)
  const [previewSide, setPreviewSide] = useState<Side>("front")
  const [preview, setPreview] = useState(false)
  const backPrinted = printsBack(design)
  const hasBack =
    PRINT_SPECS[design.kind].duplex || backPrinted || !!removedBack
  useEffect(() => {
    if (backPrinted) setRemovedBack(null)
  }, [backPrinted])
  useEffect(() => {
    setRemovedBack(null)
  }, [design.productId, design.kind])
  useEffect(() => {
    if (hasBack) return
    setSide("front")
    setPreviewSide("front")
  }, [hasBack])
  const removeBack = () => {
    setRemovedBack({ back: design.back, backBackground: design.backBackground })
    change({ ...design, back: [], backBackground: { background: "#ffffff" } })
    setSide("front")
    setSelectedId(null)
  }
  const restoreBack = () => {
    if (!removedBack) return
    change({ ...design, ...removedBack })
    setRemovedBack(null)
  }
  const layers = design[side]
  const selected = layers.find((layer) => layer.id === selectedId)
  const group = layers.filter((layer) => groupIds.includes(layer.id))
  const moveGroup = (dx: number, dy: number) =>
    change({
      ...design,
      [side]: layers.map((layer) =>
        groupIds.includes(layer.id)
          ? {
              ...layer,
              x: mm(
                Math.max(
                  -design.widthMm,
                  Math.min(design.widthMm * 2, layer.x + dx)
                )
              ),
              y: mm(
                Math.max(
                  -design.heightMm,
                  Math.min(design.heightMm * 2, layer.y + dy)
                )
              ),
            }
          : layer
      ),
    })
  const removeGroup = () => {
    change({
      ...design,
      [side]: layers.filter((layer) => !groupIds.includes(layer.id)),
    })
    setGroupIds([])
  }
  const spec = PRINT_SPECS[design.kind]
  const selectedImage = !!selected?.image
  const selectedOverPrintArea =
    !!selectedImage &&
    (selected.x < 0 ||
      selected.y < 0 ||
      selected.x + selected.width > design.widthMm ||
      selected.y + selected.height > design.heightMm)
  const selectedLowDpi =
    !!selected?.image && layerImageDpi(design.kind, selected) < spec.minImageDpi
  const selectedPrintWarning = selectedOverPrintArea || selectedLowDpi

  const [cropId, setCropId] = useState<string | null>(null)
  const [showOverflow, setShowOverflow] = useState(true)
  useEffect(() => {
    if (cropId && cropId !== selectedId) setCropId(null)
  }, [selectedId, cropId])
  useEffect(() => {
    if (!cropId) return
    const finish = (event: KeyboardEvent) => {
      if (event.key === "Enter") setCropId(null)
    }
    window.addEventListener("keydown", finish)
    return () => window.removeEventListener("keydown", finish)
  }, [cropId])
  const startCrop = () => {
    if (!selected || selected.type !== "image" || !selected.image) return
    if (selected.rotation)
      return setMessage("회전을 0°로 되돌린 뒤 자를 수 있습니다.")
    setCropId(selected.id)
  }
  const resetCrop = () => {
    if (!selected?.crop) return
    const { crop } = selected
    const width = selected.width / crop.w
    const height = selected.height / crop.h
    change(
      updateLayer(design, side, selected.id, {
        x: mm(selected.x - crop.x * width),
        y: mm(selected.y - crop.y * height),
        width: mm(width),
        height: mm(height),
        crop: { x: 0, y: 0, w: 1, h: 1 },
      })
    )
  }
  // 그룹으로 묶은 레이어는 같은 groupId 를 갖고, 하나를 누르면 함께 선택·이동·크기 조절된다
  const mergedGroup =
    group.length > 1 &&
    !!group[0].groupId &&
    group.every((layer) => layer.groupId === group[0].groupId)
  // 묶은 레이어는 레이어 목록에서도 한 덩어리로 보이게, 맨 위 레이어 자리로 모은다
  const mergeGroup = () => {
    if (group.length < 2) return
    const groupId = crypto.randomUUID()
    const groupName = `그룹 ${new Set(layers.map((layer) => layer.groupId).filter(Boolean)).size + 1}`
    const top = Math.max(...group.map((layer) => layers.indexOf(layer)))
    const rest = layers.filter((layer) => !groupIds.includes(layer.id))
    const at = rest.filter((layer) => layers.indexOf(layer) < top).length
    change({
      ...design,
      [side]: [
        ...rest.slice(0, at),
        ...group.map((layer) => ({ ...layer, groupId, groupName })),
        ...rest.slice(at),
      ],
    })
    setMessage(
      `${group.length}개 요소를 "${groupName}"으로 묶었습니다. 하나를 누르면 함께 선택됩니다.`
    )
  }
  const splitGroup = () => {
    change({
      ...design,
      [side]: layers.map((layer) =>
        groupIds.includes(layer.id)
          ? { ...layer, groupId: undefined, groupName: undefined }
          : layer
      ),
    })
    setMessage("그룹을 풀었습니다.")
  }
  const selectLayers = (ids: string[]) => {
    if (ids.length === 1) return setSelectedId(ids[0])
    setSelectedId(null)
    setGroupIds(ids)
  }
  const canvas = useCanvasInteraction({
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
  })
  const auth = useAuthRetry(setMessage)
  const storage = useTemplateStorage({
    mode,
    productId,
    size,
    templateId,
    savedDesignId: savedId,
    runAuthed: auth.runAuthed,
    design,
    setDesign,
    change: (loaded) => {
      setRemovedBack(null)
      change(loaded)
    },
    setSelectedId,
    setMessage,
  })
  const actions = useLayerActions({
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
  })
  const pen = usePenTool({
    design,
    setDesign,
    change,
    commit,
    side,
    selected,
    editable: actions.editable,
    setSelectedId,
    svgRef: canvas.svgRef,
    handleSize: canvas.handleSize,
  })
  const flipSelected = (axis: "x" | "y") =>
    actions.flipLayers(
      group.length > 1 ? group : selected ? [selected] : [],
      axis
    )
  const images = useImageTools({
    design,
    side,
    layers,
    selected,
    change,
    patch: actions.patch,
    setSelectedId,
    setMessage,
  })
  const exporter = useTemplateExport({
    design,
    productId,
    side,
    preview,
    previewSide,
    svgRef: canvas.svgRef,
    setMessage,
  })
  const order = useDesignOrder({
    design,
    productId,
    variantId,
    templateId,
    runAuthed: auth.runAuthed,
  })
  // 막는 문제(빈 문구·안전영역 등)는 고쳐야 넘어가고, 해상도만 낮으면 확인 후 그대로 진행할 수 있다
  const [warnings, setWarnings] = useState<string[]>([])
  const openPreview = () => {
    setIssues([])
    setWarnings([])
    setPreviewSide(side)
    setPreview(true)
  }
  const complete = () => {
    const found = printIssues(design)
    const warned = printWarnings(design)
    setWarnings(warned)
    if (found.length) return setIssues(found)
    if (warned.length) return setIssues(warned)
    openPreview()
  }
  useEffect(() => {
    const kind = selected?.type
    if (kind !== "qr" && kind !== "text") return
    // 레이어 패널에서 고를 때는 패널을 그대로 둔다. 바꾸면 이름 바꾸기·순서 끌기를 못 한다
    setTool((current) => (current === "layers" ? current : kind))
    setPanelOpen(true)
  }, [selectedId, selected?.type])
  useEditorShortcuts({
    preview,
    textDialog,
    issues,
    saveDialog: storage.saveDialog,
    loadDialog: storage.loadDialog,
    selected,
    copied: actions.copied,
    hasGroup: group.length > 1,
    editable: group.length > 1 || actions.editable,
    setSelectedId,
    setPreview,
    setTextDialog,
    setHelpOpen,
    setIssues,
    setSaveDialog: storage.setSaveDialog,
    setLoadDialog: storage.setLoadDialog,
    undo,
    redo,
    copySelected: actions.copySelected,
    pasteCopied: actions.pasteCopied,
    cutSelected: actions.cutSelected,
    removeSelected: group.length > 1 ? removeGroup : actions.removeSelected,
    nudgeSelected: (dx, dy) => {
      // 화면 1px 은 작은 규격에서 0.1mm 도 안 돼 움직이지 않는 것처럼 보인다
      const px = Math.max(1 / (canvas.canvasFit * canvas.zoom), 0.5)
      if (group.length > 1) return moveGroup(dx * px, dy * px)
      if (!selected) return
      const clamp = (value: number, size: number) =>
        mm(Math.max(-size, Math.min(size * 2, value)))
      actions.patch(selected.id, {
        x: clamp(selected.x + dx * px, design.widthMm),
        y: clamp(selected.y + dy * px, design.heightMm),
      })
    },
    flipSelected,
    togglePen: pen.togglePen,
    togglePencil: pen.togglePencil,
    canSave: true,
    save: storage.save,
    saveNamed: storage.saveNamed,
  })

  return {
    productId,
    mode,
    variantId,
    size,
    design,
    change,
    history,
    future,
    undo,
    redo,
    side,
    setSide,
    hasBack,
    removedBack,
    removeBack,
    restoreBack,
    selectedId,
    setSelectedId,
    group,
    removeGroup,
    guideMenuOpen,
    setGuideMenuOpen,
    noticeOpen,
    setNoticeOpen,
    showRuler,
    setShowRuler,
    showCutline,
    setShowCutline,
    showSafety,
    setShowSafety,
    message,
    toastId: toast.id,
    setMessage,
    tool,
    setTool,
    panelOpen,
    setPanelOpen,
    textDialog,
    setTextDialog,
    issues,
    setIssues,
    helpOpen,
    setHelpOpen,
    helpTab,
    setHelpTab,
    moveMode,
    setMoveMode,
    previewSide,
    setPreviewSide,
    preview,
    setPreview,
    layers,
    selected,
    spec,
    selectedLowDpi,
    selectedPrintWarning,
    complete,
    warnings,
    openPreview,
    cropId,
    setCropId,
    startCrop,
    resetCrop,
    mergedGroup,
    mergeGroup,
    splitGroup,
    groupIds,
    selectLayers,
    showOverflow,
    setShowOverflow,
    ...storage,
    ...canvas,
    ...actions,
    ...images,
    ...pen,
    ...exporter,
    ...order,
    ...auth,
  }
}

export type AlmondEditor = ReturnType<typeof useAlmondEditor>
