"use client"

import { useEffect, useState } from "react"
import { getAlmondDesign } from "@/lib/api/ugc/almond-designs"
import { cn } from "@/lib/utils"
import {
  parseDesign,
  sideBackground,
  unfiltered,
  type Design,
} from "../lib/document"
import { Backdrop } from "./graphic"
import { LayerStack } from "./layer-stack"
import { ImagePreviews } from "../lib/image-previews"

// 주문용으로 저장한 시안(almond-designs)의 앞면을 편집기와 같은 그리기로 작게 보여 준다
export function DesignThumbnail({
  id,
  className,
}: {
  id: string
  className?: string
}) {
  const [design, setDesign] = useState<Design | null>(null)
  useEffect(() => {
    let cancelled = false
    getAlmondDesign(id)
      .then((value) => !cancelled && setDesign(parseDesign(value.design)))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id])
  return (
    <span
      className={cn(
        "bg-muted flex shrink-0 items-center justify-center overflow-hidden",
        className ?? "h-14 w-20"
      )}
    >
      {design && (
        <ImagePreviews.Provider value={design.imagePreviews ?? {}}>
          <svg
            viewBox={`0 0 ${design.widthMm} ${design.heightMm}`}
            className="h-full w-full"
            aria-hidden="true"
          >
            <defs>
              <clipPath id={`thumb-${id}`}>
                <rect width={design.widthMm} height={design.heightMm} />
              </clipPath>
            </defs>
            <g clipPath={`url(#thumb-${id})`}>
              <Backdrop value={sideBackground(design, "front")} />
              <LayerStack
                layers={design.front}
                backdrop={(filtered) => (
                  <Backdrop
                    value={
                      filtered
                        ? sideBackground(design, "front")
                        : unfiltered(sideBackground(design, "front"))
                    }
                  />
                )}
              />
            </g>
          </svg>
        </ImagePreviews.Provider>
      )}
    </span>
  )
}
