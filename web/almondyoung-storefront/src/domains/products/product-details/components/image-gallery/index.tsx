"use client"

import { useRef, useState } from "react"
import { Box } from "lucide-react"
import { HttpTypes } from "@medusajs/types"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { SoldOutOverlay } from "@/components/products/sold-out-overlay"
import { pickComingSoon } from "@/domains/products/product-details/components/product-actions/coming-soon"
import { ComingSoonBadge } from "@/components/shared/badges/coming-soon-badge"
import { calculateStockStatus } from "@/domains/products/components/product-card/quantity/stock-status"
import { type Model3dStatus, ProductModel3dLayer } from "../model3d-viewer"
import { PaperModelLayer } from "../paper-preview/model-layer"
import type { PaperVariant } from "../paper-preview/paper"

type Props = {
  product: HttpTypes.StoreProduct
  // 아몬드템플릿 명함 상품이면 그 시안을 입힌 용지 3D 를 첫 칸에 둔다
  paper?: { templateId: string; fallbackVariant: PaperVariant }
}

export function ImageGallery({ product, paper }: Props) {
  const t = useTranslations("productDetail.image")
  const images = product.images?.length
    ? product.images
    : product.thumbnail
      ? [{ id: "thumbnail", url: product.thumbnail }]
      : []

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [modelStatus, setModelStatus] = useState<Model3dStatus | null>(null)
  const userPicked = useRef(false)
  // 3D 를 받기 시작하면 첫 칸에 3D 를 끼우고 사진들은 한 칸씩 뒤로 민다. 사진은 그대로 다 남는다.
  const hasModelSlot = modelStatus === "loading" || modelStatus === "ready"
  const slides = hasModelSlot ? [null, ...images] : images
  const selectedImage = slides[selectedIndex] ?? images[0]
  const isSoldOut = calculateStockStatus(product).kind === "soldOut"
  const comingSoon = pickComingSoon(product.variants)

  const pick = (index: number) => {
    userPicked.current = true
    setSelectedIndex(index)
  }

  const handleModelStatus = (status: Model3dStatus) => {
    setModelStatus(status)

    if (status === "loading") {
      setSelectedIndex((index) => index + 1)
    } else if (status === "ready" && !userPicked.current) {
      setSelectedIndex(0)
    } else if (status === "failed") {
      setSelectedIndex((index) => Math.max(0, index - 1))
    }
  }

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
      {slides.length > 1 && (
        <div className="flex gap-2 md:flex-col">
          {slides.map((image, index) => (
            <button
              key={image ? (image.id ?? index) : "model3d"}
              type="button"
              className={cn(
                "relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 transition-colors md:size-20",
                selectedIndex === index
                  ? "border-primary"
                  : "hover:border-primary/40 border-transparent"
              )}
              onMouseEnter={() => pick(index)}
              onClick={() => pick(index)}
            >
              {image ? (
                <Image
                  src={getThumbnailUrl(image.url)}
                  alt={
                    product.title
                      ? t("altIndex", {
                          name: product.title,
                          index: hasModelSlot ? index : index + 1,
                        })
                      : t("mainAlt")
                  }
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <span className="bg-muted text-foreground absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-xs font-bold">
                  <Box className="size-5" aria-hidden="true" />
                  3D
                </span>
              )}
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
            className="object-cover"
            priority
          />
        )}
        {paper ? (
          <PaperModelLayer
            templateId={paper.templateId}
            productId={product.id}
            productName={product.title ?? ""}
            fallbackVariant={paper.fallbackVariant}
            visible={hasModelSlot && selectedIndex === 0}
            onStatus={handleModelStatus}
          />
        ) : (
          <ProductModel3dLayer
            fileId={product.metadata?.model3dFileId}
            productName={product.title ?? ""}
            visible={hasModelSlot && selectedIndex === 0}
            onStatus={handleModelStatus}
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
