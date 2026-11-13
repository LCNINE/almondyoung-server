"use client"

import Image from "next/image"
import { useEffect, useId, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import type { ModelViewerElement } from "@google/model-viewer"
import { Card } from "@/components/ui/card"
import { useIntersection } from "@/hooks/use-intersection"
import { cn } from "@/lib/utils"
import {
  afterPageIdle,
  canAutoLoad3d,
  type DeviceHints,
} from "../model3d-viewer"
import type { PaperVariant } from "./paper"

export type PaperPreviewProps = {
  templateId: string
  productName: string
  variant: PaperVariant
}

const papers: PaperVariant[] = ["uncoated", "matte_coated"]

export default function PaperPreview({
  templateId,
  productName,
  variant,
}: PaperPreviewProps) {
  const t = useTranslations("productDetail.paperPreview")
  const titleId = useId()
  const section = useRef<HTMLElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const visible = useIntersection(section)
  const [started, setStarted] = useState(false)
  const [ready, setReady] = useState(false)
  // 3D 를 못 띄우면 칸을 빼고 사진만 둔다. 높이는 처음부터 잡아 둬야 뷰어가 0 크기로 그리지 않는다
  const [unavailable, setUnavailable] = useState(false)
  const variantRef = useRef(variant)
  variantRef.current = variant
  const alt = t("modelAlt", { name: productName })
  const interactionPrompt = t("interactionPrompt")

  useEffect(() => {
    if (visible) setStarted(true)
  }, [visible])

  useEffect(() => {
    const hints: Navigator & DeviceHints = navigator
    if (!started) return
    if (!canAutoLoad3d(hints)) {
      setUnavailable(true)

      return
    }

    let cancelled = false
    let dispose: (() => void) | undefined
    setReady(false)
    const fail = () => {
      if (cancelled) return

      setReady(false)
      setUnavailable(true)
    }
    const cancelWait = afterPageIdle(() => {
      void import("./mount-paper-viewer")
        .then(({ mountPaperViewer }) => {
          if (cancelled || !container.current) return

          return mountPaperViewer(container.current, {
            templateId,
            alt,
            interactionPrompt,
            variant: () => variantRef.current,
            onReady: () => {
              if (!cancelled) setReady(true)
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
  }, [started, templateId, alt, interactionPrompt])

  useEffect(() => {
    const viewer =
      container.current?.querySelector<ModelViewerElement>("model-viewer")
    if (viewer) viewer.variantName = variant
  }, [variant])

  return (
    <section
      ref={section}
      aria-labelledby={titleId}
      className="text-foreground space-y-3 py-4"
    >
      <h3 id={titleId} className="text-base font-bold">
        {t("title")}
      </h3>
      {!unavailable && (
        <div
          ref={container}
          aria-hidden={!ready}
          className={cn(
            "bg-muted h-72 overflow-hidden rounded-xl transition-opacity",
            !ready && "opacity-0"
          )}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        {papers.map((paper) => (
          <Card
            key={paper}
            className={cn(
              "border-border bg-background overflow-hidden rounded-lg shadow-none",
              variant === paper && "border-ink ring-ink ring-1"
            )}
          >
            <figure aria-current={variant === paper ? "true" : undefined}>
              <Image
                src={`/almond-template/paper/macro-${paper}.jpg`}
                alt={t(`${paper}.caption`)}
                width={900}
                height={600}
                sizes="(min-width: 1280px) 240px, 50vw"
                className="aspect-[3/2] w-full object-cover"
              />
              <figcaption
                className={cn(
                  "text-muted-foreground p-3 text-xs",
                  variant === paper && "text-ink font-bold"
                )}
              >
                {t(`${paper}.caption`)}
              </figcaption>
            </figure>
          </Card>
        ))}
      </div>
      <p aria-live="polite" className="text-sm">
        {t(`${variant}.description`)}
      </p>
      <p className="text-muted-foreground text-xs">
        {t(ready ? "notice" : "disclaimer")}
      </p>
    </section>
  )
}
