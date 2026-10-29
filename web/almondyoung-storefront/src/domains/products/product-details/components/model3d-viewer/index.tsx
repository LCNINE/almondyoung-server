"use client"

import { useEffect, useRef, useState } from "react"
import { Box } from "lucide-react"
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
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
        >
          <Box className="size-4" aria-hidden="true" />
          3D로 보기
        </button>
      </DialogTrigger>

      {open && (
        <DialogContent className="sm:max-w-3xl" showCloseButton={false}>
          <DialogTitle>{productName} 3D 보기</DialogTitle>
          <DialogDescription>
            대표 옵션 기준입니다. 선택한 옵션과 색상이나 무늬가 다를 수 있어요.
          </DialogDescription>

          <Model3dContent fileId={fileId} productName={productName} />

          <p className="text-muted-foreground text-sm">
            드래그하여 돌려 보고, 마우스 휠이나 두 손가락으로 확대해 보세요.
          </p>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="3D 보기 닫기"
              className="min-h-11 rounded-md border px-4 py-2 text-sm"
            >
              닫기
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
          alt: `${productName} 3D 모델`,
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
  }, [fileId, productName, failed])

  return (
    <div className="relative aspect-square max-h-[60vh] w-full">
      <div ref={container} className="size-full" />
      {!loaded && !failed && (
        <p
          role="status"
          className="absolute inset-0 flex items-center justify-center"
        >
          3D 모델을 불러오고 있어요…
        </p>
      )}
      {failed && (
        <p
          role="alert"
          className="absolute inset-0 flex items-center justify-center text-center"
        >
          3D 모델을 불러오지 못했어요. 닫은 뒤 다시 시도해 주세요.
        </p>
      )}
    </div>
  )
}
