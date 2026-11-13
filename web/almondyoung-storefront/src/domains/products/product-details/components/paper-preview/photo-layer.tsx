"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { getAlmondTemplate } from "@/lib/api/ugc/almond-templates"
import { parseDesign } from "@/domains/almond-template/lib/document"
import { printSvg } from "@/domains/almond-template/components/print-svg"
import { rasterPng } from "@/domains/almond-template/lib/design-images"
import { afterPageIdle, type Model3dStatus } from "../model3d-viewer"
import { type PhotoMockup, quadMatrix3d } from "./photo-mockup"

// 템플릿 앞면을 그림으로 그려 blob 주소로 준다. 사진 합성 칸들이 같은 그림을 나눠 쓴다
export function useTemplateArt(
  templateId: string | undefined,
  onStatus?: (status: Model3dStatus) => void
): string | undefined {
  const [art, setArt] = useState<string>()
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    if (!templateId) return

    let cancelled = false
    let url: string | undefined

    onStatusRef.current?.("loading")

    const cancelWait = afterPageIdle(() => {
      void (async () => {
        const template = await getAlmondTemplate(templateId)
        const markup = await printSvg(parseDesign(template.design), "front", 0)
        const blob = await rasterPng(markup, 1600)
        if (cancelled) return

        url = URL.createObjectURL(blob)
        setArt(url)
        onStatusRef.current?.("ready")
      })().catch(() => {
        if (!cancelled) onStatusRef.current?.("failed")
      })
    })

    return () => {
      cancelled = true
      cancelWait()
      if (url) URL.revokeObjectURL(url)
    }
  }, [templateId])

  return art
}

const ART_LONG_PX = 1000

// 실제 장면 사진에 시안을 원근으로 붙인 한 장. 사진 좌표(size px) 기준 레이어를 담는 칸 크기에 맞춰 통째로 줄인다
export function PhotoMockupScene({
  mockup,
  art,
}: {
  mockup: PhotoMockup
  art: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const [[x0, y0], [x1, y1], , [x3, y3]] = mockup.quad
  const portrait = Math.hypot(x3 - x0, y3 - y0) > Math.hypot(x1 - x0, y1 - y0)
  const artW = portrait ? Math.round(ART_LONG_PX * 0.707) : ART_LONG_PX
  const artH = ART_LONG_PX

  useEffect(() => {
    const el = box.current
    if (!el) return

    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.width / mockup.size)
    )
    observer.observe(el)

    return () => observer.disconnect()
  }, [mockup.size])

  const layer = "absolute inset-0 size-full"

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden">
      {scale > 0 && (
        <div
          className="relative isolate origin-top-left"
          style={{
            width: mockup.size,
            height: mockup.size,
            transform: `scale(${scale})`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 사진 좌표로 겹치는 레이어라 next/image 의 크기 조정을 쓰지 않는다 */}
          <img src={mockup.background} alt="" className={layer} />
          {/* eslint-disable-next-line @next/next/no-img-element -- 시안은 페이지에서 그린 blob 이다 */}
          <img
            src={art}
            alt=""
            width={artW}
            height={artH}
            className={cn(
              "absolute top-0 left-0 origin-top-left object-cover",
              mockup.artBlend === "multiply"
                ? "mix-blend-multiply [filter:brightness(1.04)]"
                : "[filter:contrast(0.9)_saturate(0.92)_sepia(0.06)_blur(0.6px)]"
            )}
            style={{
              width: artW,
              height: artH,
              transform: quadMatrix3d(mockup.quad, artW, artH),
            }}
          />
          {mockup.layers?.map(({ src, blend }) => (
            // eslint-disable-next-line @next/next/no-img-element -- 사진 좌표의 고정 레이어다
            <img
              key={src}
              src={src}
              alt=""
              className={cn(
                layer,
                blend === "multiply" && "mix-blend-multiply",
                blend === "screen" && "mix-blend-screen"
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
