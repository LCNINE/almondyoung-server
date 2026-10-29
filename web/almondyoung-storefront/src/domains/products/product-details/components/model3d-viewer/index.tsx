"use client"

import { useEffect, useRef, useState } from "react"
import { Box } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

export function ProductModel3dViewer({
  fileId,
  productName,
}: {
  fileId: unknown
  productName: string
}) {
  if (typeof fileId !== "string" || !fileId.trim()) {
    return null
  }

  // 다른 상품으로 이동하면 열린 뷰어와 이전 모델을 함께 해제한다.
  return (
    <Model3dDialog key={fileId} fileId={fileId} productName={productName} />
  )
}

function Model3dDialog({
  fileId,
  productName,
}: {
  fileId: string
  productName: string
}) {
  const t = useTranslations("productDetail.model3d")
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
        >
          <Box className="size-4" aria-hidden="true" />
          {t("open")}
        </button>
      </DialogTrigger>

      {open && (
        <DialogContent className="sm:max-w-3xl" showCloseButton={false}>
          <DialogTitle>{t("title", { name: productName })}</DialogTitle>
          <DialogDescription>{t("representativeOption")}</DialogDescription>

          <Model3dContent fileId={fileId} productName={productName} />

          <p className="text-muted-foreground text-sm">{t("instructions")}</p>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("closeAria")}
              className="min-h-11 rounded-md border px-4 py-2 text-sm"
            >
              {t("close")}
            </button>
          </DialogClose>
        </DialogContent>
      )}
    </Dialog>
  )
}

function Model3dContent({
  fileId,
  productName,
}: {
  fileId: string
  productName: string
}) {
  const t = useTranslations("productDetail.model3d")
  const container = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (failed || !container.current) {
      return
    }

    let cancelled = false
    let dispose: (() => void) | undefined
    const timeout = window.setTimeout(() => setFailed(true), 45_000)

    // 버튼을 누르기 전에는 뷰어 코드와 GLB 모두 다운로드하지 않는다.
    void import("./mount-viewer")
      .then(({ mountViewer }) => {
        if (cancelled || !container.current) {
          return
        }

        return mountViewer(container.current, {
          src: getThumbnailUrl(fileId),
          alt: t("modelAlt", { name: productName }),
          onLoad: () => {
            window.clearTimeout(timeout)
            setLoaded(true)
          },
          onError: () => setFailed(true),
        })
      })
      .then((cleanup) => {
        if (cancelled) {
          cleanup?.()
        } else {
          dispose = cleanup
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      dispose?.()
    }
  }, [fileId, productName, failed, t])

  return (
    <div className="relative aspect-square max-h-[60vh] w-full">
      <div ref={container} className="size-full" />
      {!loaded && !failed && (
        <p
          role="status"
          className="absolute inset-0 flex items-center justify-center"
        >
          {t("loading")}
        </p>
      )}
      {failed && (
        <p
          role="alert"
          className="absolute inset-0 flex items-center justify-center text-center"
        >
          {t("error")}
        </p>
      )}
    </div>
  )
}
