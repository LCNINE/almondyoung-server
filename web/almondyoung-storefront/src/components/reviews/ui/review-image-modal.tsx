"use client"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { useCallback, useEffect, useState } from "react"

type Props = {
  images: string[]
  startIndex: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReviewImageModal({
  images,
  startIndex,
  open,
  onOpenChange,
}: Props) {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(startIndex)

  useEffect(() => {
    if (!api) return

    api.scrollTo(startIndex, true)
    setCurrent(startIndex)

    const onSelect = () => {
      setCurrent(api.selectedScrollSnap())
    }

    api.on("select", onSelect)
    return () => {
      api.off("select", onSelect)
    }
  }, [api, startIndex])

  const scrollPrev = useCallback(() => api?.scrollPrev(), [api])
  const scrollNext = useCallback(() => api?.scrollNext(), [api])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[90vw] border-none bg-transparent p-0 shadow-none sm:max-w-[600px] [&>button]:flex [&>button]:h-9 [&>button]:w-9 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:bg-black/50 [&>button]:text-white [&>button]:opacity-100 [&>button]:hover:bg-black/70 [&>button]:hover:text-white"
        showCloseButton
      >
        <DialogTitle className="sr-only">리뷰 이미지</DialogTitle>

        <div className="relative">
          <Carousel setApi={setApi} opts={{ startIndex, loop: true }}>
            <CarouselContent>
              {images.map((imageId, index) => (
                <CarouselItem key={index}>
                  <div className="flex items-center justify-center">
                    <img
                      src={getThumbnailUrl(imageId)}
                      alt={`리뷰 이미지 ${index + 1}`}
                      className="max-h-[70vh] w-auto rounded-lg object-contain"
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>

          {/* 좌우 네비게이션 */}
          {images.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1/2 left-2 h-9 w-9 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
                onClick={scrollPrev}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1/2 right-2 h-9 w-9 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
                onClick={scrollNext}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>

              {/* 인디케이터 */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
                {current + 1} / {images.length}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
