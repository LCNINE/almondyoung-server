"use client"

import Image from "next/image"
import { Camera, ImageIcon } from "lucide-react"
import { PhotoSwipeFrame } from "@/components/shared/photo-swipe-frame"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

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
  /** 가로로 넘기는 줄 안에 든 카드는 손짓이 겹쳐 사진 넘기기를 끈다 */
  enableSwipe?: boolean
}

export function CardThumbnail({
  images,
  fallbackFileId,
  alt,
  sizes,
  enableHover = true,
  enableSwipe = true,
}: Props) {
  const shown = (
    images.length > 0 ? images : fallbackFileId ? [fallbackFileId] : []
  ).slice(0, MAX_PREVIEW)

  if (shown.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center">
        <ImageIcon className="h-8 w-8" />
      </div>
    )
  }

  const photo = (index: number) => (
    <Image
      src={getThumbnailUrl(shown[index])}
      alt={index === 0 ? alt : `${alt} 사진 ${index + 1}`}
      fill
      sizes={sizes}
      draggable={false}
      className="object-cover"
    />
  )

  if (shown.length === 1) return photo(0)

  return (
    <>
      <PhotoSwipeFrame
        count={shown.length}
        renderImage={photo}
        // 카드 썸네일 칸과 같은 비율이라야 캐러셀이 칸을 꽉 채운다
        itemClassName="aspect-[4/3]"
        enableHover={enableHover}
        enableSwipe={enableSwipe}
      />

      {images.length > 1 && (
        <span className="bg-foreground/75 pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-white">
          <Camera className="h-3 w-3" />
          {images.length}
        </span>
      )}
    </>
  )
}
