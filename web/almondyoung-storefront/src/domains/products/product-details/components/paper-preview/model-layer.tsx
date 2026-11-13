"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import type { ModelViewerElement } from "@google/model-viewer"
import { cn } from "@/lib/utils"
import {
  afterPageIdle,
  canAutoLoad3d,
  type DeviceHints,
  type Model3dStatus,
} from "../model3d-viewer"
import type { PaperShape, PaperVariant } from "./paper"
import { usePickedPaper } from "./paper-store"

// 대표 이미지 첫 칸의 3D. 그 상품 템플릿 시안을 입힌 명함이 옵션에서 고른 용지 질감으로 바뀐다
export function PaperModelLayer({
  templateId,
  shape,
  productId,
  productName,
  fallbackVariant,
  visible,
  onStatus,
}: {
  templateId: string
  shape: PaperShape
  productId: string
  productName: string
  fallbackVariant: PaperVariant
  visible: boolean
  onStatus?: (status: Model3dStatus) => void
}) {
  const t = useTranslations("productDetail.paperPreview")
  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const variant = usePickedPaper(productId, fallbackVariant)
  const variantRef = useRef(variant)
  variantRef.current = variant
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const alt = t("modelAlt", { name: productName })
  const interactionPrompt = t("interactionPrompt")

  useEffect(() => {
    const hints: Navigator & DeviceHints = navigator
    if (!canAutoLoad3d(hints)) return

    let cancelled = false
    let dispose: (() => void) | undefined
    const fail = () => {
      if (cancelled) return

      setReady(false)
      onStatusRef.current?.("failed")
    }

    onStatusRef.current?.("loading")

    const cancelWait = afterPageIdle(() => {
      void import("./mount-paper-viewer")
        .then(({ mountPaperViewer }) => {
          if (cancelled || !container.current) return

          return mountPaperViewer(container.current, {
            templateId,
            shape,
            alt,
            interactionPrompt,
            variant: () => variantRef.current,
            onReady: () => {
              if (cancelled) return

              setReady(true)
              onStatusRef.current?.("ready")
            },
            onError: fail,
          })
        })
        .then((cleanup) => {
          if (cancelled) cleanup?.()
          else dispose = cleanup
        })
        .catch(fail)
    })

    return () => {
      cancelled = true
      cancelWait()
      dispose?.()
    }
  }, [templateId, shape, alt, interactionPrompt])

  useEffect(() => {
    const viewer =
      container.current?.querySelector<ModelViewerElement>("model-viewer")
    if (viewer) viewer.variantName = variant
  }, [variant])

  return (
    <div
      ref={container}
      aria-hidden={!(ready && visible)}
      className={cn(
        "bg-muted absolute inset-0 z-[5] transition-opacity",
        ready && visible ? "opacity-100" : "pointer-events-none opacity-0"
      )}
    />
  )
}
