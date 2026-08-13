"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { cn } from "@/lib/utils"
import { GalleryLightbox } from "./lightbox"

interface Props {
  /** file-service fileId 목록 */
  images: string[]
  alt: string
}

export function ListingGallery({ images, alt }: Props) {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [zoomed, setZoomed] = useState<number | null>(null)

  useEffect(() => {
    if (!api) return

    const sync = () => setCurrent(api.selectedScrollSnap())
    sync()
    api.on("select", sync)
    return () => {
      api.off("select", sync)
    }
  }, [api])

  if (images.length === 0) return null

  return (
    <div className="mt-6">
      <Carousel setApi={setApi} opts={{ loop: images.length > 1 }}>
        <CarouselContent>
          {images.map((fileId, index) => (
            <CarouselItem key={fileId}>
              <button
                type="button"
                onClick={() => setZoomed(index)}
                aria-label={`${index + 1}번째 사진 크게 보기`}
                className="bg-muted relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-xl"
              >
                <Image
                  src={getThumbnailUrl(fileId)}
                  alt={`${alt} 사진 ${index + 1}`}
                  fill
                  sizes="(min-width: 800px) 800px, 100vw"
                  priority={index === 0}
                  className="object-cover"
                />
              </button>
            </CarouselItem>
          ))}
        </CarouselContent>

        {images.length > 1 && (
          <>
            <CarouselPrevious className="left-3" />
            <CarouselNext className="right-3" />
          </>
        )}
      </Carousel>

      {images.length > 1 && (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {images.map((fileId, index) => (
            <button
              key={fileId}
              type="button"
              onClick={() => api?.scrollTo(index)}
              aria-label={`${index + 1}번째 사진 보기`}
              aria-current={index === current}
              className={cn(
                "h-1.5 rounded-full transition-all",
                index === current
                  ? "bg-primary w-5"
                  : "bg-border hover:bg-muted-foreground w-1.5"
              )}
            />
          ))}
        </div>
      )}

      <GalleryLightbox
        images={images}
        index={zoomed}
        onIndexChange={(next) => {
          setZoomed(next)
          api?.scrollTo(next) // 닫았을 때 슬라이드도 같은 사진에 맞춰둔다
        }}
        onClose={() => setZoomed(null)}
        alt={alt}
      />
    </div>
  )
}
