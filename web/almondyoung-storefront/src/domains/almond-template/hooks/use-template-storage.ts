import { useEffect, useRef, useState, useTransition } from "react"
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
import { printSvg } from "../components/print-svg"
import { PRINT_PRODUCTS } from "../lib/catalog"

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
  runAuthed: (task: () => Promise<void>, failure: string) => Promise<void>
}

function saveTarget(design: Design) {
  return `${design.productId}:${design.widthMm}x${design.heightMm}:${(design.title ?? "").trim()}`
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
  runAuthed,
}: Params) {
  const [saveDialog, setSaveDialog] = useState(false)
  const [loadDialog, setLoadDialog] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [saved, setSaved] = useState<{ id: string; target: string } | null>(
    null
  )
  const savedId = saved?.target === saveTarget(design) ? saved.id : null
  const [clean, setClean] = useState<Design | null>(design)
  const dirty = design !== clean
  const saving = useRef(false)
  const latest = useRef(design)
  latest.current = design
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
    setSaved(
      mode === "designer" && templateId
        ? { id: templateId, target: saveTarget(design) }
        : null
    )
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
          if (!templateId) return
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
          if (cancelled) return
          setDesign(loaded)
          setClean(loaded)
        })
        .catch(() => {
          if (!cancelled) setMessage("공개 시안을 불러오지 못했습니다.")
        })
    }
    return () => {
      cancelled = true
    }
  }, [key])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  const loadPublished = async (item: PublishedTemplate) => {
    try {
      const loaded = forRoute((await getAlmondTemplate(item.id)).design)
      change(loaded)
      setClean(loaded)
      setSelectedId(null)
      setMessage(`「${item.title}」 시안을 불러왔습니다.`)
    } catch {
      setMessage("공개 시안을 불러오지 못했습니다.")
    }
  }
  const matchesRoute = (item: SavedItem) =>
    (!productId || item.productId === productId) &&
    (!size || item.size === size)
  const SAVE_FAILURE =
    "서버에 저장하지 못했습니다. 이미지 용량을 줄여 다시 시도해 주세요."
  const persist = async (named: Design, before: Design, id?: string) => {
    const markup = await printSvg(
      {
        ...named,
        front: named.front.filter((layer) => layer.visible !== false),
      },
      "front",
      0
    )
    const [stored, thumbnailSvg] = await Promise.all([
      uploadDesignImages(named, uploadFile),
      inlineThumbnailImages(markup),
    ])
    const result = await upsertAlmondTemplate({
      id,
      design: stored,
      thumbnailSvg,
      status: "draft",
    })
    if ("conflict" in result) {
      setMessage(
        `「${named.title}」 이름의 시안이 이미 있습니다. 다른 이름으로 저장해 주세요.`
      )
      return
    }
    setClean(
      latest.current === before ? stored : named === before ? before : null
    )
    setDesign(
      latest.current === before
        ? stored
        : {
            ...latest.current,
            title:
              latest.current.title === before.title
                ? stored.title
                : latest.current.title,
          }
    )
    setSaved({ id: result.id, target: saveTarget(stored) })
    setSaveDialog(false)
    setMessage(
      result.status === "published"
        ? "저장되었습니다. 게시 중인 시안이라 고객 화면에 바로 반영됩니다."
        : "저장되었습니다."
    )
  }
  const checked = (named: Design) => {
    try {
      parseDesign(named)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "시안을 저장할 수 없습니다."
      )
      return false
    }
    if (!named.front.length && !named.back.length) {
      setMessage("빈 시안은 저장할 수 없습니다.")
      return false
    }
    return true
  }
  const openSaveDialog = (name: string) => {
    setSaveName(name)
    setSaveDialog(true)
  }
  const defaultName = () =>
    design.title || PRINT_PRODUCTS[design.productId]?.title || "내 시안"
  const saveOnce = (task: () => Promise<void>) =>
    serverTask(async () => {
      if (saving.current) return
      saving.current = true
      try {
        await task()
      } finally {
        saving.current = false
      }
    }, SAVE_FAILURE)
  const save = () => {
    if (!savedId) return openSaveDialog(defaultName())
    const before = design
    if (checked(before)) saveOnce(() => persist(before, before, savedId))
  }
  const saveAs = () => openSaveDialog(`${defaultName()} (사본)`)
  const saveNamed = () => {
    const name = saveName.trim().slice(0, 50)
    if (!name) return setMessage("시안 이름을 입력하세요.")
    const before = design
    const named = { ...before, title: name }
    if (!checked(named)) return
    const fileSize = `${named.widthMm}x${named.heightMm}`
    saveOnce(async () => {
      const same = (await listAdminAlmondTemplates()).find(
        (item) =>
          item.productId === named.productId &&
          item.size === fileSize &&
          item.title === name
      )
      if (same) {
        const notice =
          same.status === "published"
            ? " 게시 중인 시안이라 고객 화면에 바로 반영됩니다."
            : ""
        if (
          !window.confirm(
            `「${name}」 시안이 이미 있습니다. 덮어쓸까요?${notice}`
          )
        )
          return
      }
      await persist(named, before, same?.id)
    })
  }
  const openLoad = () => {
    setLoadDialog(true)
    serverTask(async () => {
      setSavedItems((await listAdminAlmondTemplates()).filter(matchesRoute))
    }, "저장된 시안 목록을 불러오지 못했습니다.")
  }
  const loadNamed = (item: SavedItem) =>
    serverTask(async () => {
      const loaded = forRoute((await getAdminAlmondTemplate(item.id)).design)
      change(loaded)
      setClean(loaded)
      setSaved({ id: item.id, target: saveTarget(loaded) })
      setSelectedId(null)
      setLoadDialog(false)
      setMessage(`「${item.title}」 시안을 불러왔습니다.`)
    }, "시안을 불러오지 못했습니다.")
  const deleteNamed = (item: SavedItem) =>
    serverTask(async () => {
      await deleteAlmondTemplate(item.id)
      if (item.id === saved?.id) setSaved(null)
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
    savedId,
    dirty,
    save,
    saveAs,
    saveNamed,
    openLoad,
    loadNamed,
    deleteNamed,
    togglePublished,
    storagePending,
    importJson,
  }
}
