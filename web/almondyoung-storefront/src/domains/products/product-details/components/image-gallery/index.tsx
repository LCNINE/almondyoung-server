"use client"

import { useState } from "react"
import { HttpTypes } from "@medusajs/types"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"

type Props = {
  product: HttpTypes.StoreProduct
}

export function ImageGallery({ product }: Props) {
  const images = product.images?.length
    ? product.images
    : product.thumbnail
      ? [{ id: "thumbnail", url: product.thumbnail }]
      : []

  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedImage = images[selectedIndex]

  if (images.length === 0) {
    return (
      <section className="bg-muted flex aspect-square items-center justify-center rounded-lg">
        <span className="text-muted-foreground text-sm">이미지 없음</span>
      </section>
    )
  }

  return (
    <section className="mb-8 flex flex-col-reverse gap-3 md:flex-row lg:px-14">
      {/* 썸네일 목록 - PC: 왼쪽 세로, 모바일: 아래 가로 */}
      {images.length > 1 && (
        <div className="flex gap-2 md:flex-col">
          {images.map((image, index) => (
            <button
              key={image.id ?? index}
              type="button"
              className={cn(
                "relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 transition-colors md:size-20",
                selectedIndex === index
                  ? "border-primary"
                  : "hover:border-primary/40 border-transparent"
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => setSelectedIndex(index)}
            >
              <Image
                src={getThumbnailUrl(image.url)}
                alt={product.title ?? `상품 이미지 ${index + 1}`}
                fill
                sizes="80px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* 메인 이미지 */}
      <div className="bg-muted relative aspect-square w-full overflow-hidden rounded-lg">
        {selectedImage && (
          <Image
            src={getThumbnailUrl(selectedImage.url)}
            alt={product.title ?? "상품 이미지"}
            fill
            sizes="(max-width: 768px) 100vw, 600px"
            className="object-cover"
            priority
          />
        )}
      </div>
    </section>
  )
}
