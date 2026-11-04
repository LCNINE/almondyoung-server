"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

type NetworkInfo = { saveData?: boolean; effectiveType?: string }

export type DeviceHints = {
  connection?: NetworkInfo
  deviceMemory?: number
}

const SLOW_NETWORKS = ["slow-2g", "2g", "3g"]

// 브라우저가 알려 주지 않는 값(사파리의 connection·deviceMemory)은 막지 않는다.
export function canAutoLoad3d({ connection, deviceMemory }: DeviceHints) {
  if (connection?.saveData) {
    return false
  }

  if (
    connection?.effectiveType &&
    SLOW_NETWORKS.includes(connection.effectiveType)
  ) {
    return false
  }

  return deviceMemory === undefined || deviceMemory >= 4
}

function afterPageIdle(run: () => void): () => void {
  let idleId: number | undefined
  let timerId: number | undefined

  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(run, { timeout: 3000 })
    } else {
      timerId = window.setTimeout(run, 1)
    }
  }

  if (document.readyState === "complete") {
    schedule()
  } else {
    window.addEventListener("load", schedule, { once: true })
  }

  return () => {
    window.removeEventListener("load", schedule)

    if (idleId !== undefined) {
      window.cancelIdleCallback(idleId)
    }

    window.clearTimeout(timerId)
  }
}

export function ProductModel3dLayer({
  fileId,
  productName,
  visible,
}: {
  fileId: unknown
  productName: string
  visible: boolean
}) {
  if (typeof fileId !== "string" || !fileId.trim()) {
    return null
  }

  // 다른 상품으로 이동하면 이전 모델을 해제하고 새로 받는다.
  return (
    <Model3dLayer
      key={fileId}
      fileId={fileId}
      productName={productName}
      visible={visible}
    />
  )
}

function Model3dLayer({
  fileId,
  productName,
  visible,
}: {
  fileId: string
  productName: string
  visible: boolean
}) {
  const t = useTranslations("productDetail.model3d")
  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const alt = t("modelAlt", { name: productName })

  useEffect(() => {
    if (!canAutoLoad3d(navigator as Navigator & DeviceHints)) {
      return
    }

    let cancelled = false
    let dispose: (() => void) | undefined

    // 사진이 먼저 뜨고 페이지가 한가해진 뒤에 뷰어 코드와 GLB를 받는다.
    const cancelWait = afterPageIdle(() => {
      void import("./mount-viewer")
        .then(({ mountViewer }) => {
          if (cancelled || !container.current) {
            return
          }

          return mountViewer(container.current, {
            src: getThumbnailUrl(fileId),
            alt,
            onLoad: () => setReady(true),
            onError: () => setReady(false),
          })
        })
        .then((cleanup) => {
          if (cancelled) {
            cleanup?.()
          } else {
            dispose = cleanup
          }
        })
        // WebGL 미지원·다운로드 실패면 사진을 그대로 둔다.
        .catch(() => {})
    })

    return () => {
      cancelled = true
      cancelWait()
      dispose?.()
    }
  }, [fileId, alt])

  const shown = ready && visible

  return (
    <div
      aria-hidden={!shown}
      className={cn(
        "bg-muted absolute inset-0 z-[5] transition-opacity duration-300",
        shown ? "opacity-100" : "pointer-events-none opacity-0"
      )}
    >
      <div ref={container} className="size-full" />
      <span className="bg-foreground/80 pointer-events-none absolute top-3 left-3 rounded-full px-2.5 py-1 text-xs font-bold text-white">
        3D
      </span>
      <p className="text-muted-foreground pointer-events-none absolute right-3 bottom-3 left-3 text-center text-xs">
        {t("representativeOption")}
      </p>
    </div>
  )
}
