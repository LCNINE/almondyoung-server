"use client"

import Image from "next/image"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import { parseImageCrop, type ImageCrop } from "@packages/product-description/directive"
import { remarkProductDescription } from "@packages/product-description/remark-blocks"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { Badge } from "@/components/ui/badge"
import { cn } from "@lib/utils"
import { parseHashtagParagraph } from "./hashtag-paragraph"
import "./product-description-blocks.css"

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
            const imageAlt = alt || imageAltFallback || ""

            return crop ? (
              <CroppedImage src={src} alt={imageAlt} crop={crop} />
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
 */
function CroppedImage({ src, alt, crop }: { src: string; alt: string; crop: ImageCrop }) {
  const [ratio, setRatio] = useState(crop.w / crop.h)

  return (
    <span className="pd-crop" style={{ aspectRatio: ratio }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 원본 확대·이동이라 next/image 의 고정 크기와 맞지 않는다 */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget
          if (naturalWidth && naturalHeight) {
            setRatio((crop.w * naturalWidth) / (crop.h * naturalHeight))
          }
        }}
        style={{
          width: `${100 / crop.w}%`,
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
        }}
      />
    </span>
  )
}
