"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import { containInCell, fitCropToAspect, parseImageCrop, type ImageCrop } from "@packages/product-description/directive"
import { remarkProductDescription } from "@packages/product-description/remark-blocks"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { Badge } from "@/components/ui/badge"
import { cn } from "@lib/utils"
import { parseHashtagParagraph } from "./hashtag-paragraph"
import "@packages/product-description/description-blocks.css"

const plugins = [
  remarkGfm,
  remarkDirective,
  remarkProductDescription({ resolveImageUrl: getThumbnailUrl }),
]

export function ProductDescriptionMarkdown({
  markdown,
  imageAltFallback,
}: {
  markdown: string
  /** 이미지 지시자에 alt 가 없을 때 쓸 대체 텍스트 (보통 상품명) */
  imageAltFallback?: string
}) {
  return (
    <div className="pd-root prose max-w-none">
      <ReactMarkdown
        remarkPlugins={plugins}
        components={{
          img: ({ node, src, alt, className }) => {
            if (typeof src !== "string" || !src) return null

            const crop = parseImageCrop(node?.properties?.dataCrop)
            const aspect = Number(node?.properties?.dataAspect) || undefined
            const cell = Number(node?.properties?.dataCell) || undefined
            const imageAlt = alt || imageAltFallback || ""

            return crop ? (
              <CroppedImage src={src} alt={imageAlt} crop={crop} aspect={aspect} cell={cell} />
            ) : (
              <DescriptionImage src={src} alt={imageAlt} className={className} />
            )
          },
          p: ({ node, children, className }) => {
            const text = node?.children.every((c) => c.type === "text")
              ? node.children.map((c) => (c.type === "text" ? c.value : "")).join("")
              : ""
            const tags = parseHashtagParagraph(text)

            if (!tags) return <p className={className}>{children}</p>

            return (
              <div className="pd-tags not-prose mt-6 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="font-normal text-gray-500"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

function DescriptionImage({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [unoptimized, setUnoptimized] = useState(false)

  return (
    <Image
      src={src}
      alt={alt}
      className={cn("h-auto w-full object-contain", className)}
      loading="lazy"
      width={860}
      height={860}
      sizes="(max-width: 768px) 100vw, 860px"
      unoptimized={unoptimized}
      onError={() => setUnoptimized(true)}
    />
  )
}

/**
 * 원본 이미지의 일부(crop)만 보여 준다. 원본 크기를 알기 전엔 crop 비율로 칸을 잡고,
 * 로드되면 실제 픽셀 비율로 바로잡는다 — 정사각형이 아닌 원본에서도 영역이 어긋나지 않게.
 * aspect 가 오면(격자 칸) 칸 비율을 고정하고 crop 을 그 비율로 넓힌다 — 칸마다 높이가 들쑥날쑥하지 않게.
 */
function CroppedImage({
  src,
  alt,
  crop,
  aspect,
  cell,
}: {
  src: string
  alt: string
  crop: ImageCrop
  aspect?: number
  /** 옵션 카드 칸 비율(crop 좌표의 가로/세로). 오면 영역을 칸 안에 잘리지 않게 통째로 넣는다. */
  cell?: number
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // 서버 렌더된 img 가 하이드레이션 전에 다 받아지면 React 는 onLoad 를 부르지 않는다(캐시된 이미지).
  // 그대로 두면 격자 칸 이미지가 끝까지 가려져 있으니 마운트 때 한 번 직접 읽는다.
  useEffect(() => {
    const loaded = imgRef.current?.complete ? naturalSize(imgRef.current) : null
    if (loaded) setSize(loaded)
  }, [])

  const shown = size && aspect ? fitCropToAspect(crop, size.width, size.height, aspect) : crop
  const ratio = aspect ?? (size ? (crop.w * size.width) / (crop.h * size.height) : crop.w / crop.h)
  const cellRatio = cell && size ? (cell * size.width) / size.height : cell

  const cropped = (
    <span className="pd-crop" style={{ aspectRatio: ratio, ...(cellRatio ? containInCell(ratio, cellRatio) : {}) }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 원본 확대·이동이라 next/image 의 고정 크기와 맞지 않는다 */}
      <img
        src={src}
        alt={alt}
        ref={imgRef}
        loading="lazy"
        onLoad={(event) => {
          const loaded = naturalSize(event.currentTarget)
          if (loaded) setSize(loaded)
        }}
        style={{
          // 격자 칸은 원본 크기를 알아야 crop 을 칸 비율로 넓힐 수 있어 그때까지 가린다
          opacity: (aspect || cell) && !size ? 0 : 1,
          width: `${100 / shown.w}%`,
          left: `${(-shown.x / shown.w) * 100}%`,
          top: `${(-shown.y / shown.h) * 100}%`,
        }}
      />
    </span>
  )

  return cellRatio ? (
    <span className="pd-cell" style={{ aspectRatio: cellRatio }}>
      {cropped}
    </span>
  ) : (
    cropped
  )
}

function naturalSize(img: HTMLImageElement) {
  return img.naturalWidth && img.naturalHeight
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : null
}
