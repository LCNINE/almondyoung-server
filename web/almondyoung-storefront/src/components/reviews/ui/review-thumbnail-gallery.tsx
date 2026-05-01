"use client"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { useState } from "react"
import { ReviewImageModal } from "."

type Props = {
  thumbnails: string[]
}

export function ReviewThumbnailGallery({ thumbnails }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  if (!thumbnails || thumbnails.length === 0) return null

  const handleImageClick = (index: number) => {
    setSelectedIndex(index)
    setModalOpen(true)
  }

  return (
    <>
      <Carousel opts={{ dragFree: true, align: "start" }} className="w-full">
        <CarouselContent className="-ml-2">
          {thumbnails.map((thumb, index) => (
            <CarouselItem key={index} className="basis-auto pl-2">
              <img
                src={getThumbnailUrl(thumb)}
                alt={`리뷰 이미지 ${index + 1}`}
                className="h-[74px] w-[74px] cursor-pointer rounded-md object-cover transition-opacity hover:opacity-80"
                loading="lazy"
                onClick={() => handleImageClick(index)}
              />
            </CarouselItem>
          ))}
        </CarouselContent>

        {thumbnails.length > 4 && (
          <>
            <CarouselPrevious className="-left-3 hidden h-7 w-7 sm:flex" />
            <CarouselNext className="-right-3 hidden h-7 w-7 sm:flex" />
          </>
        )}
      </Carousel>

      <ReviewImageModal
        images={thumbnails}
        startIndex={selectedIndex}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  )
}
