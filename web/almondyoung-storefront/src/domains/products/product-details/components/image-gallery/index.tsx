"use client"

import { useState } from "react"
import { HttpTypes } from "@medusajs/types"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { SoldOutOverlay } from "@/components/products/sold-out-overlay"
import { pickComingSoon } from "@/domains/products/product-details/components/product-actions/coming-soon"
import { ComingSoonBadge } from "@/components/shared/badges/coming-soon-badge"
import { calculateStockStatus } from "@/domains/products/components/product-card/quantity/stock-status"

type Props = {
  product: HttpTypes.StoreProduct
}

export function ImageGallery({ product }: Props) {
  const t = useTranslations("productDetail.image")
  const images = product.images?.length
    ? product.images
    : product.thumbnail
      ? [{ id: "thumbnail", url: product.thumbnail }]
      : []

  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedImage = images[selectedIndex]
  const isSoldOut = calculateStockStatus(product).kind === "soldOut"
  const comingSoon = pickComingSoon(product.variants)

  if (images.length === 0) {
    return (
      <section className="bg-muted flex aspect-square items-center justify-center rounded-lg">
        <span className="text-muted-foreground text-sm">{t("noImage")}</span>
      </section>
    )
  }

  return (
    <section className="mb-8 flex flex-col-reverse gap-3 md:flex-row md:justify-center xl:justify-start xl:px-14">
      {/* 썸네일 목록 */}
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
                alt={
                  product.title
                    ? t("altIndex", { name: product.title, index: index + 1 })
                    : t("mainAlt")
                }
                fill
                sizes="80px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* 메인 이미지 — 1단 구간(xl 미만)에서는 컨테이너 폭을 그대로 먹으면
          정사각형이 화면을 넘길 만큼 커진다. 2단으로 갈라지는 xl 부터만 제한을 푼다. */}
      <div className="bg-muted relative aspect-square w-full max-w-[560px] overflow-hidden rounded-lg xl:max-w-none">
        {selectedImage && (
          <Image
            src={getThumbnailUrl(selectedImage.url)}
            alt={product.title ?? t("mainAlt")}
            fill
            sizes="(max-width: 767px) 100vw, (max-width: 1279px) 560px, 700px"
            quality={100}
            className="object-cover"
            priority
          />
        )}
        {isSoldOut && comingSoon && (
          <ComingSoonBadge
            date={comingSoon.date}
            size="lg"
            className="absolute top-4 right-4 z-[6]"
          />
        )}
        {isSoldOut && !comingSoon && (
          <SoldOutOverlay
            variants={product.variants}
            size="detail"
            className="rounded-lg"
          />
        )}
      </div>
    </section>
  )
}
