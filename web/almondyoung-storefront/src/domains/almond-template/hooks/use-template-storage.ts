import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react"
import {
  deleteAlmondTemplate,
  getAdminAlmondTemplate,
  getAlmondTemplate,
  listAdminAlmondTemplates,
  listAlmondTemplates,
  updateAlmondTemplateStatus,
  upsertAlmondTemplate,
} from "@/lib/api/ugc/almond-templates"
import type { AdminAlmondTemplateSummary } from "@/lib/types/ui/almond-template"
import { uploadFile } from "@/lib/api/file/upload"
import { inlineThumbnailImages, uploadDesignImages } from "../lib/design-images"
import { parseDesign, type Design } from "../lib/document"
import type { PublishedTemplate } from "../lib/gallery-filter"
import { svgMarkup } from "./use-template-export"

export type EditorMode = "customer" | "designer"
export type SavedItem = AdminAlmondTemplateSummary
export type { PublishedTemplate }

type Params = {
  mode: EditorMode
  productId: string
  size: string
  templateId: string
  design: Design
  setDesign: (design: Design) => void
  change: (design: Design) => void
  setSelectedId: (id: string | null) => void
  setMessage: (message: string) => void
  svgRef: RefObject<SVGSVGElement>
  runAuthed: (task: () => Promise<void>, failure: string) => Promise<void>
  forgetBackup: () => Promise<unknown>
}

export function useTemplateStorage({
  mode,
  productId,
  size,
  templateId,
  design,
  setDesign,
  change,
  setSelectedId,
  setMessage,
  svgRef,
  runAuthed,
  forgetBackup,
}: Params) {
  const [saveDialog, setSaveDialog] = useState(false)
  const [loadDialog, setLoadDialog] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [savedItems, setSavedItems] = useState<SavedItem[]>([])
  const [publishedTemplates, setPublishedTemplates] = useState<
    PublishedTemplate[]
  >([])
  const [storagePending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const key = `${mode}:${productId}:${size}:${templateId}`
  const forRoute = (value: unknown) => {
    const loaded = parseDesign(value)
    if (productId && loaded.productId !== productId)
      throw new Error("다른 상품의 디자인은 불러올 수 없습니다.")
    if (size && `${loaded.widthMm}x${loaded.heightMm}` !== size)
      throw new Error("선택한 상품 규격과 디자인 크기가 다릅니다.")
    return loaded
  }
  const serverTask = (task: () => Promise<void>, failure: string) =>
    startTransition(() => runAuthed(task, failure))

  useEffect(() => {
    let cancelled = false
    setPublishedTemplates([])
    if (mode === "customer" && productId) {
      const fileSize = size || `${design.widthMm}x${design.heightMm}`
      listAlmondTemplates()
        .then(async (data) => {
          if (cancelled) return
          const items = data.filter(
            (item) => item.productId === productId && item.size === fileSize
          )
          setPublishedTemplates(items)
          if (!items.length) {
            setMessage(
              "아직 공개된 상품 시안이 없습니다. 시안 제작 후 이용할 수 있습니다."
            )
            return
          }
          if (templateId && !items.some((item) => item.id === templateId)) {
            setMessage("선택한 시안을 찾을 수 없습니다.")
            return
          }
          const chosen =
            items.find((item) => item.id === templateId) ?? items[0]
          const loaded = forRoute((await getAlmondTemplate(chosen.id)).design)
          if (!cancelled) setDesign(loaded)
        })
        .catch(() => {
          if (!cancelled) setMessage("공개 시안을 불러오지 못했습니다.")
        })
    }
    return () => {
      cancelled = true
    }
  }, [key])
  const loadPublished = async (item: PublishedTemplate) => {
    try {
      change(forRoute((await getAlmondTemplate(item.id)).design))
      setSelectedId(null)
      setMessage(`「${item.title}」 시안을 불러왔습니다.`)
    } catch {
      setMessage("공개 시안을 불러오지 못했습니다.")
    }
  }
  const matchesRoute = (item: SavedItem) =>
    (!productId || item.productId === productId) &&
    (!size || item.size === size)
  const saveNamed = () => {
    const name = saveName.trim().slice(0, 50)
    if (!name) return setMessage("시안 이름을 입력하세요.")
    const named = { ...design, title: name }
    try {
      parseDesign(named)
    } catch (error) {
      return setMessage(
        error instanceof Error ? error.message : "시안을 저장할 수 없습니다."
      )
    }
    if (!named.front.length && !named.back.length)
      return setMessage("빈 시안은 저장할 수 없습니다.")
    if (!svgRef.current) return setMessage("미리보기를 만들 수 없습니다.")
    const markup = svgMarkup(svgRef.current, named)
    serverTask(async () => {
      const [stored, thumbnailSvg] = await Promise.all([
        uploadDesignImages(named, uploadFile),
        inlineThumbnailImages(markup),
      ])
      const saved = await upsertAlmondTemplate({
        design: stored,
        thumbnailSvg,
        status: "draft",
      })
      setDesign(stored)
      setSaveDialog(false)
      void forgetBackup()
      setMessage(
        saved.status === "published"
          ? `「${name}」 게시 중인 시안을 갱신했습니다. 고객 화면에 바로 반영됩니다.`
          : `「${name}」 시안을 서버에 저장했습니다.`
      )
    }, "서버에 저장하지 못했습니다. 이미지 용량을 줄여 다시 시도해 주세요.")
  }
  const openLoad = () => {
    setLoadDialog(true)
    serverTask(async () => {
      setSavedItems((await listAdminAlmondTemplates()).filter(matchesRoute))
    }, "저장된 시안 목록을 불러오지 못했습니다.")
  }
  const loadNamed = (item: SavedItem) =>
    serverTask(async () => {
      change(forRoute((await getAdminAlmondTemplate(item.id)).design))
      setSelectedId(null)
      setLoadDialog(false)
      setMessage(`「${item.title}」 시안을 불러왔습니다.`)
    }, "시안을 불러오지 못했습니다.")
  const deleteNamed = (item: SavedItem) =>
    serverTask(async () => {
      await deleteAlmondTemplate(item.id)
      setSavedItems((items) => items.filter((saved) => saved.id !== item.id))
    }, "시안을 삭제하지 못했습니다.")
  const togglePublished = (item: SavedItem) =>
    serverTask(async () => {
      const updated = await updateAlmondTemplateStatus(
        item.id,
        item.status === "published" ? "draft" : "published"
      )
      setSavedItems((items) =>
        items.map((saved) => (saved.id === item.id ? updated : saved))
      )
    }, "게시 상태를 바꾸지 못했습니다.")
  const importJson = async (file: File) => {
    if (file.size > 10_000_000)
      return setMessage("10MB 이하 JSON만 불러올 수 있습니다.")
    try {
      const loaded = forRoute(JSON.parse(await file.text()))
      change(loaded)
      setSelectedId(null)
      setLoadDialog(false)
      setMessage("디자인을 불러왔습니다.")
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "불러오기에 실패했습니다."
      )
    }
  }

  return {
    inputRef,
    publishedTemplates,
    loadPublished,
    saveDialog,
    setSaveDialog,
    loadDialog,
    setLoadDialog,
    saveName,
    setSaveName,
    savedItems,
    saveNamed,
    openLoad,
    loadNamed,
    deleteNamed,
    togglePublished,
    storagePending,
    importJson,
  }
}
