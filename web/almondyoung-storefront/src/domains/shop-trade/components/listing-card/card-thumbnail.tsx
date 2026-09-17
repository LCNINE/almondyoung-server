"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Camera, ImageIcon } from "lucide-react"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
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
  const [api, setApi] = useState<CarouselApi>()
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!api) return

    const sync = () => setActive(api.selectedScrollSnap())
    sync()
    api.on("select", sync)
    return () => {
      api.off("select", sync)
    }
  }, [api])

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

  if (shown.length === 1) {
    return (
      <Image
        src={getThumbnailUrl(shown[0])}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
      />
    )
  }

  return (
    <div className="h-full w-full" onMouseLeave={() => api?.scrollTo(0)}>
      <Carousel
        setApi={setApi}
        className="h-full w-full"
        opts={{ watchDrag: enableSwipe }}
      >
        <CarouselContent className="ml-0">
          {shown.map((fileId, index) => (
            // 카드 썸네일 칸과 같은 비율이라야 캐러셀이 칸을 꽉 채운다
            <CarouselItem key={fileId} className="relative aspect-[4/3] pl-0">
              <Image
                src={getThumbnailUrl(fileId)}
                alt={index === 0 ? alt : `${alt} 사진 ${index + 1}`}
                fill
                sizes={sizes}
                draggable={false}
                className="object-cover"
              />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {images.length > 1 && (
        <span className="bg-foreground/75 pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-white">
          <Camera className="h-3 w-3" />
          {images.length}
        </span>
      )}

      {enableHover && (
        <>
          {/* 카드를 세로로 갈라 마우스가 놓인 구역의 사진을 보여준다.
              손가락은 캐러셀을 직접 쓸어야 하므로 마우스가 있는 기기에서만 덮는다
              (화면 폭으로 가르면 태블릿에서 이 판이 스와이프를 가로챈다) */}
          <div className="absolute inset-0 hidden [@media(pointer:fine)]:flex">
            {shown.map((fileId, index) => (
              <div
                key={fileId}
                className="h-full flex-1"
                onMouseEnter={() => api?.scrollTo(index)}
              />
            ))}
          </div>

          {/* 넘길 수 없는 카드에 점만 띄우면 넘어갈 것처럼 보인다 */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1 transition-opacity",
              enableSwipe
                ? "[@media(pointer:fine)]:opacity-0 [@media(pointer:fine)]:group-hover:opacity-100"
                : "opacity-0 group-hover:opacity-100"
            )}
          >
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
