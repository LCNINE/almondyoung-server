import { useEffect, useState } from "react"
import { PRINT_PRODUCTS, PRINT_SPECS } from "../lib/catalog"
import { imageDpi, newDesign, printIssues, type Design } from "../lib/document"
import { useCanvasInteraction } from "./use-canvas-interaction"
import { useDesignHistory } from "./use-design-history"
import { useEditorShortcuts } from "./use-editor-shortcuts"
import { useImageTools } from "./use-image-tools"
import { useLayerActions } from "./use-layer-actions"
import { useAuthRetry } from "./use-auth-retry"
import { useDesignOrder } from "./use-design-order"
import { useDraftBackup } from "./use-draft-backup"
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
  | "frame"
  | "qr"
export type AlmondEditorProps = {
  productId?: string
  mode?: EditorMode
  variantId?: string
  size?: string
  templateId?: string
  initialDesign?: Design
}

export function useAlmondEditor({
  productId = "",
  mode = "customer",
  variantId = "",
  size = "",
  templateId = "",
  initialDesign,
}: AlmondEditorProps) {
  const product = PRINT_PRODUCTS[productId]
  const { design, setDesign, history, setHistory, future, change, undo, redo } =
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [guideMenuOpen, setGuideMenuOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [showRuler, setShowRuler] = useState(false)
  const [showCutline, setShowCutline] = useState(true)
  const [showSafety, setShowSafety] = useState(true)
  const [message, setMessage] = useState("")
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
  const layers = design[side]
  const selected = layers.find((layer) => layer.id === selectedId)
  const spec = PRINT_SPECS[design.kind]
  const selectedImage =
    selected && (selected.type === "image" || selected.type === "frame")
  const selectedOverPrintArea =
    !!selectedImage &&
    (selected.x < 0 ||
      selected.y < 0 ||
      selected.x + selected.width > design.widthMm ||
      selected.y + selected.height > design.heightMm)
  const selectedLowDpi =
    !!selectedImage &&
    !!selected.image &&
    !!selected.pixelWidth &&
    !!selected.pixelHeight &&
    imageDpi(
      design.kind,
      selected.pixelWidth,
      selected.pixelHeight,
      selected.width,
      selected.height,
      selected.imageScale
    ) < spec.minImageDpi
  const selectedPrintWarning = selectedOverPrintArea || selectedLowDpi

  const canvas = useCanvasInteraction({
    design,
    setDesign,
    setHistory,
    side,
    mode,
    moveMode,
    setSelectedId,
  })
  const auth = useAuthRetry(setMessage)
  const backup = useDraftBackup({
    backupKey: `${mode}:${productId}:${size}:${templateId}`,
    design,
    change,
    setMessage,
  })
  const storage = useTemplateStorage({
    mode,
    productId,
    size,
    templateId,
    runAuthed: auth.runAuthed,
    forgetBackup: backup.forgetBackup,
    design,
    setDesign,
    change,
    setSelectedId,
    setMessage,
    svgRef: canvas.svgRef,
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
  })
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
    forgetBackup: backup.forgetBackup,
  })
  const complete = () => {
    const found = printIssues(design)
    if (found.length) {
      setIssues(found)
      return
    }
    void backup.flushBackup()
    setPreviewSide(side)
    setPreview(true)
  }
  useEffect(() => {
    if (selected?.type !== "qr") return
    setTool("qr")
    setPanelOpen(true)
  }, [selectedId, selected?.type])
  useEditorShortcuts({
    preview,
    textDialog,
    helpOpen,
    issues,
    saveDialog: storage.saveDialog,
    loadDialog: storage.loadDialog,
    selected,
    copied: actions.copied,
    editable: actions.editable,
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
    removeSelected: actions.removeSelected,
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
    selectedId,
    setSelectedId,
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
    ...storage,
    ...canvas,
    ...actions,
    ...images,
    ...exporter,
    ...order,
    ...auth,
    ...backup,
  }
}

export type AlmondEditor = ReturnType<typeof useAlmondEditor>
