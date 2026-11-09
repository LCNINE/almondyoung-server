import { useEffect, useRef, useState, useTransition } from "react"
import {
  deleteAlmondTemplate,
  getAdminAlmondTemplate,
  getAlmondTemplate,
  getMyUserId,
  listAdminAlmondTemplates,
  listAlmondTemplates,
  updateAlmondTemplateStatus,
  upsertAlmondTemplate,
} from "@/lib/api/ugc/almond-templates"
import {
  deleteMyAlmondSavedDesign,
  getMyAlmondSavedDesign,
  listMyAlmondSavedDesigns,
  upsertMyAlmondSavedDesign,
} from "@/lib/api/ugc/almond-saved-designs"
import type {
  AdminAlmondTemplateSummary,
  AlmondSavedDesignSummary,
} from "@/lib/types/ui/almond-template"
import { uploadFile } from "@/lib/api/file/upload"
import {
  placeholderThumbnail,
  rasterThumbnail,
  uploadDesignImages,
} from "../lib/design-images"
import { hasProduct, parseDesign, type Design } from "../lib/document"
import type { PublishedTemplate } from "../lib/gallery-filter"
import { printSvg } from "../components/print-svg"
import { fitTextBoxes } from "../components/graphic"
import { PRINT_PRODUCTS } from "../lib/catalog"
import { useLeaveWarning } from "./use-leave-warning"
import {
  reportThumbnailFallback,
  retryTransient,
  withFailureContext,
} from "./use-auth-retry"

export type EditorMode = "customer" | "designer"
export type SavedItem = AlmondSavedDesignSummary &
  Partial<Pick<AdminAlmondTemplateSummary, "status" | "createdBy">>
export type { PublishedTemplate }

type Params = {
  mode: EditorMode
  productId: string
  size: string
  templateId: string
  savedDesignId?: string
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
  savedDesignId = "",
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
  const ownerChecked = useRef<string | null>(null)
  const latest = useRef(design)
  const importToken = useRef(0)
  latest.current = design
  const [savedItems, setSavedItems] = useState<SavedItem[]>([])
  const [publishedTemplates, setPublishedTemplates] = useState<
    PublishedTemplate[]
  >([])
  const [storagePending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const key = `${mode}:${productId}:${size}:${templateId}:${savedDesignId}`
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
  const designer = mode === "designer"
  const remote: {
    list: () => Promise<SavedItem[]>
    get: (id: string) => Promise<{ design: unknown }>
    upsert: (dto: {
      id?: string
      design: Design
      thumbnailSvg: string
    }) => Promise<
      { id: string; status?: string } | { conflict: true } | { invalid: string }
    >
    remove: (id: string) => Promise<void>
  } = designer
    ? {
        list: listAdminAlmondTemplates,
        get: getAdminAlmondTemplate,
        upsert: (dto: { id?: string; design: Design; thumbnailSvg: string }) =>
          upsertAlmondTemplate({ ...dto, status: "draft" }),
        remove: deleteAlmondTemplate,
      }
    : {
        list: () => listMyAlmondSavedDesigns(productId, size),
        get: getMyAlmondSavedDesign,
        upsert: upsertMyAlmondSavedDesign,
        remove: deleteMyAlmondSavedDesign,
      }

  useEffect(() => {
    let cancelled = false
    setSaved(
      mode === "designer" && templateId
        ? { id: templateId, target: saveTarget(design) }
        : null
    )
    setPublishedTemplates([])
    if (mode === "customer" && savedDesignId)
      serverTask(async () => {
        const loaded = forRoute(
          (await getMyAlmondSavedDesign(savedDesignId)).design
        )
        if (cancelled) return
        setDesign(loaded)
        setClean(loaded)
        setSaved({ id: savedDesignId, target: saveTarget(loaded) })
      }, "저장한 디자인을 불러오지 못했습니다.")
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
  useLeaveWarning(dirty)
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
    "저장하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속 안 되면 저장 창의 「JSON 받기」로 작업을 내려받아 두세요."
  // 썸네일은 목록 카드용이다. 어떤 이유로 못 그려도(글꼴·사진·배포 직후 모듈 로딩) 바탕 카드로 대신하고 저장은 계속한다
  const thumbnailOf = async (named: Design, stored: Design) => {
    try {
      const markup = await printSvg(
        {
          ...named,
          front: named.front.filter((layer) => layer.visible !== false),
        },
        "front",
        0
      )
      return await rasterThumbnail(markup, stored.imagePreviews ?? {})
    } catch (error) {
      reportThumbnailFallback(error)
      return placeholderThumbnail(
        named.widthMm,
        named.heightMm,
        named.background
      )
    }
  }
  const persist = async (named: Design, before: Design, id?: string) => {
    const step = async <T>(
      stage: string,
      run: () => Promise<T>,
      context: () => Record<string, unknown> = () => ({})
    ) => {
      try {
        return await run()
      } catch (error) {
        throw withFailureContext(error, { stage, mode, ...context() })
      }
    }
    // 서버·기기 시계가 조금 달라도 방금 것을 찾도록 여유를 둔다
    const startedAt = Date.now() - 5 * 60 * 1000
    const stored = await step("upload-images", () =>
      uploadDesignImages(
        named,
        (formData) => retryTransient(() => uploadFile(formData)),
        { backfill: true }
      )
    )
    const thumbnailSvg = await thumbnailOf(named, stored)
    const upsert = () => remote.upsert({ id, design: stored, thumbnailSvg })
    // 응답만 잃고 서버엔 만들어졌을 수 있으니, 다시 보내기 전에 방금 저장된 것이 있는지 본다
    const justSaved = async () =>
      id
        ? null
        : ((await remote.list().catch(() => [])).find(
            (item) =>
              item.productId === stored.productId &&
              item.size === `${stored.widthMm}x${stored.heightMm}` &&
              item.title === stored.title &&
              Date.parse(item.updatedAt) >= startedAt
          ) ?? null)
    const result = await step(
      "upsert",
      () =>
        retryTransient(async () => {
          try {
            return await upsert()
          } catch (error) {
            const saved = await justSaved()
            if (saved) return saved
            throw error
          }
        }),
      () => ({
        designLength: JSON.stringify(stored).length,
        thumbnailLength: thumbnailSvg.length,
      })
    )
    if ("invalid" in result) {
      setMessage(result.invalid)
      return
    }
    if ("conflict" in result) {
      setMessage(
        designer
          ? `「${named.title}」 이름의 시안이 이미 있습니다. 다른 이름으로 저장해 주세요.`
          : "디자인은 50개까지 보관할 수 있습니다. 불러오기에서 안 쓰는 디자인을 지운 뒤 저장해 주세요."
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
    ownerChecked.current = result.id
    setSaveDialog(false)
    setMessage(
      "status" in result && result.status === "published"
        ? "저장되었습니다. 게시 중인 시안이라 고객 화면에 바로 반영됩니다."
        : designer
          ? "저장되었습니다."
          : "내 디자인에 저장했습니다. 불러오기에서 다시 열 수 있습니다."
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
    if (!hasProduct(design)) {
      setMessage("왼쪽 규격 메뉴에서 작업 상품을 먼저 선택해 주세요.")
      return
    }

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
    if (!checked(before)) return
    saveOnce(async () => {
      if (designer && ownerChecked.current !== savedId) {
        const [item, me] = await retryTransient(() =>
          Promise.all([getAdminAlmondTemplate(savedId), getMyUserId()])
        )
        const notice =
          item.status === "published"
            ? " 게시 중인 시안이라 고객 화면에 바로 반영됩니다."
            : ""
        if (
          item.createdBy !== me &&
          !window.confirm(
            `다른 사람이 만든 시안입니다. 원본을 고칠까요?${notice}\n취소하면 다른 이름으로 저장합니다.`
          )
        )
          return saveAs()
        ownerChecked.current = savedId
      }
      await persist(before, before, savedId)
    })
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
      // 같은 이름 확인은 덮어쓰기 안내용이다. 목록을 못 받아도 저장은 하고, 이름이 겹치면 서버가 알려 준다
      const same = (await remote.list().catch(() => [])).find(
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
            `「${name}」 ${designer ? "시안" : "디자인"}이 이미 있습니다. 덮어쓸까요?${notice}`
          )
        )
          return
      }
      await persist(named, before, same?.id)
    })
  }
  const refreshSaved = () =>
    serverTask(async () => {
      setSavedItems((await remote.list()).filter(matchesRoute))
    }, "저장된 시안 목록을 불러오지 못했습니다.")
  const openLoad = () => {
    setLoadDialog(true)
    refreshSaved()
  }
  const loadNamed = (item: SavedItem) =>
    serverTask(async () => {
      const loaded = forRoute((await remote.get(item.id)).design)
      change(loaded)
      setClean(loaded)
      setSaved({ id: item.id, target: saveTarget(loaded) })
      setSelectedId(null)
      setLoadDialog(false)
      setMessage(`「${item.title}」 시안을 불러왔습니다.`)
    }, "시안을 불러오지 못했습니다.")
  const deleteNamed = (item: SavedItem) =>
    serverTask(async () => {
      await remote.remove(item.id)
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
    const token = ++importToken.current
    const before = latest.current
    try {
      const loaded = await fitTextBoxes(forRoute(JSON.parse(await file.text())))
      // 글꼴을 받는 동안 다른 파일을 골랐거나 편집했으면 그 상태를 덮지 않는다
      if (token !== importToken.current) return
      if (latest.current !== before)
        return setMessage(
          "불러오는 동안 디자인이 바뀌어 불러오기를 멈췄습니다."
        )

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
    refreshSaved,
    loadNamed,
    deleteNamed,
    togglePublished,
    storagePending,
    importJson,
  }
}
