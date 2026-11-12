"use client"

import { useEffect, useRef, useState } from "react"
import { ZoomIn, ZoomOut } from "lucide-react"
import { useTranslations } from "next-intl"
import type { ModelViewerElement } from "@google/model-viewer"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

type NetworkInfo = { saveData?: boolean; effectiveType?: string }

export type DeviceHints = {
  connection?: NetworkInfo
  deviceMemory?: number
}

const SLOW_NETWORKS = ["slow-2g", "2g", "3g"]

export type Model3dStatus = "loading" | "ready" | "failed"

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
  onStatus,
}: {
  fileId: unknown
  productName: string
  visible: boolean
  onStatus?: (status: Model3dStatus) => void
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
      onStatus={onStatus}
    />
  )
}

function Model3dLayer({
  fileId,
  productName,
  visible,
  onStatus,
}: {
  fileId: string
  productName: string
  visible: boolean
  onStatus?: (status: Model3dStatus) => void
}) {
  const t = useTranslations("productDetail.model3d")
  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const spun = useRef(false)
  const alt = t("modelAlt", { name: productName })

  useEffect(() => {
    if (!canAutoLoad3d(navigator as Navigator & DeviceHints)) {
      return
    }

    let cancelled = false
    let dispose: (() => void) | undefined
    const fail = () => {
      if (!cancelled) {
        setReady(false)
        onStatusRef.current?.("failed")
      }
    }

    onStatusRef.current?.("loading")

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
            onLoad: () => {
              setReady(true)
              onStatusRef.current?.("ready")
            },
            onError: fail,
          })
        })
        .then((cleanup) => {
          if (cancelled) {
            cleanup?.()
          } else {
            dispose = cleanup
          }
        })
        // WebGL 미지원·다운로드 실패면 3D 칸을 빼고 사진만 둔다.
        .catch(fail)
    })

    return () => {
      cancelled = true
      cancelWait()
      dispose?.()
    }
  }, [fileId, alt])

  const shown = ready && visible

  // 3D 라는 걸 알아보게 처음 보일 때 한 바퀴만 돌리고 멈춘다.
  useEffect(() => {
    const viewer = container.current?.querySelector("model-viewer")

    if (!shown || spun.current || !viewer) {
      return
    }

    spun.current = true

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return
    }

    viewer.setAttribute("rotation-per-second", "90deg")
    viewer.setAttribute("auto-rotate-delay", "0")
    viewer.setAttribute("auto-rotate", "")
    const stop = () => viewer.removeAttribute("auto-rotate")
    const timer = window.setTimeout(stop, 4000)

    return () => {
      window.clearTimeout(timer)
      stop()
    }
  }, [shown])

  const zoom = (steps: number) => {
    container.current
      ?.querySelector<ModelViewerElement>("model-viewer")
      ?.zoom(steps)
  }

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "bg-gray-20 absolute inset-0 z-[5] transition-opacity duration-300",
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      )}
    >
      <div ref={container} className="size-full" />
      {visible && !ready && (
        <p
          role="status"
          className="text-gray-70 absolute inset-0 flex items-center justify-center text-sm"
        >
          {t("loading")}
        </p>
      )}
      <span className="bg-foreground/80 pointer-events-none absolute top-3 left-3 rounded-full px-2.5 py-1 text-xs font-bold text-white">
        3D
      </span>
      <div
        className={cn(
          "absolute top-3 right-3 flex flex-col gap-2",
          !ready && "hidden"
        )}
      >
        {(
          [
            ["zoomIn", ZoomIn, 3],
            ["zoomOut", ZoomOut, -3],
          ] as const
        ).map(([key, Icon, steps]) => (
          <button
            key={key}
            type="button"
            aria-label={t(key)}
            tabIndex={shown ? 0 : -1}
            onClick={() => zoom(steps)}
            className="bg-background/90 border-border text-foreground flex size-9 items-center justify-center rounded-full border shadow-sm"
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="text-gray-70 pointer-events-none absolute right-3 bottom-3 left-3 text-center text-xs">
        {t("representativeOption")}
      </p>
    </div>
  )
}
