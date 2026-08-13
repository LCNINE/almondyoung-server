"use client"

import { useState } from "react"
import Image from "next/image"
import { Camera, ImageIcon } from "lucide-react"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { cn } from "@/lib/utils"

/** 카드 하나에서 미리 보여줄 사진 수. 더 늘리면 구역이 좁아 조준이 어렵다. */
const MAX_PREVIEW = 5

interface Props {
  /** 갤러리 fileId 목록 */
  images: string[]
  /** 갤러리가 비었을 때 쓸 대표 fileId */
  fallbackFileId: string | null
  alt: string
  sizes: string
  /** 목록형 카드는 썸네일이 작아 구역 나누기가 어려워 호버 미리보기를 끈다 */
  enableHover?: boolean
}

export function CardThumbnail({
  images,
  fallbackFileId,
  alt,
  sizes,
  enableHover = true,
}: Props) {
  const [active, setActive] = useState(0)

  const shown = (images.length > 0
    ? images
    : fallbackFileId
      ? [fallbackFileId]
      : []
  ).slice(0, MAX_PREVIEW)

  if (shown.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center">
        <ImageIcon className="h-8 w-8" />
      </div>
    )
  }

  const hoverable = enableHover && shown.length > 1

  return (
    <div
      className="h-full w-full"
      onMouseLeave={() => hoverable && setActive(0)}
    >
      {/* 전부 미리 그려두고 투명도만 바꾼다 — 넘길 때 깜빡이지 않는다 */}
      {shown.map((fileId, index) => (
        <Image
          key={fileId}
          src={getThumbnailUrl(fileId)}
          alt={index === 0 ? alt : `${alt} 사진 ${index + 1}`}
          fill
          sizes={sizes}
          className={cn(
            "object-cover transition-opacity duration-200",
            index === active ? "opacity-100" : "opacity-0"
          )}
        />
      ))}

      {images.length > 1 && (
        <span className="bg-foreground/75 pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-white">
          <Camera className="h-3 w-3" />
          {images.length}
        </span>
      )}

      {hoverable && (
        <>
          {/* 카드를 세로로 갈라 마우스가 놓인 구역의 사진을 보여준다 */}
          <div className="absolute inset-0 flex">
            {shown.map((fileId, index) => (
              <div
                key={fileId}
                className="h-full flex-1"
                onMouseEnter={() => setActive(index)}
              />
            ))}
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {shown.map((fileId, index) => (
              <span
                key={fileId}
                className={cn(
                  "h-1 rounded-full transition-all",
                  index === active ? "w-4 bg-white" : "w-1 bg-white/60"
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
