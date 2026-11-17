"use client"

import { useEffect, useRef, useState } from "react"
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
import { PhotoMockupScene, useTemplateArt } from "../paper-preview/photo-layer"
import {
  MENU_MOCKUPS,
  type PhotoMockup,
  WINDOW_MOCKUP,
} from "../paper-preview/photo-mockup"
import type { PaperShape, PaperVariant } from "../paper-preview/paper"

type Props = {
  product: HttpTypes.StoreProduct
  // 아몬드템플릿 인쇄 상품이면 그 시안을 입힌 3D·장면 사진을 앞 칸들에 둔다
  paper?: {
    templateId: string
    shape: PaperShape
    fallbackVariant: PaperVariant
  }
}

type Slide =
  | { type: "model" }
  | { type: "photo"; mockup: PhotoMockup }
  | {
      type: "image"
      image: HttpTypes.StoreProductImage | { id: string; url: string }
    }

// 유리창 현수막은 장면 사진이 첫 칸(3D 대신), 메뉴판은 3D 뒤에 장면 사진 세 장이 붙는다
const PHOTO_SLIDES: Partial<Record<PaperShape, PhotoMockup[]>> = {
  menu: MENU_MOCKUPS,
}

export function ImageGallery({ product, paper }: Props) {
  const t = useTranslations("productDetail.image")
  const tPaper = useTranslations("productDetail.paperPreview")
  const images = product.images?.length
    ? product.images
    : product.thumbnail
      ? [{ id: "thumbnail", url: product.thumbnail }]
      : []

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [modelStatus, setModelStatus] = useState<Model3dStatus | null>(null)
  const userPicked = useRef(false)
  const isWindow = paper?.shape === "window"
  const photoMockups = paper ? (PHOTO_SLIDES[paper.shape] ?? []) : []

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

  // 유리창은 그림이 곧 첫 칸이라 그림 준비 상태가 첫 칸 상태다
  const art = useTemplateArt(
    isWindow || photoMockups.length > 0 ? paper?.templateId : undefined,
    isWindow ? handleModelStatus : undefined
  )

  // 3D 를 받기 시작하면 첫 칸에 3D 를 끼우고 사진들은 한 칸씩 뒤로 민다. 사진은 그대로 다 남는다.
  const hasModelSlot = modelStatus === "loading" || modelStatus === "ready"
  const photoCount = art ? photoMockups.length : 0
  const slides: Slide[] = [
    ...(hasModelSlot ? [{ type: "model" as const }] : []),
    ...(art
      ? photoMockups.map((mockup) => ({ type: "photo" as const, mockup }))
      : []),
    ...images.map((image) => ({ type: "image" as const, image })),
  ]
  const selected = slides[selectedIndex]
  const firstImageSlide = (hasModelSlot ? 1 : 0) + photoCount
  const selectedImage = selected?.type === "image" ? selected.image : images[0]
  const isSoldOut = calculateStockStatus(product).kind === "soldOut"
  const comingSoon = pickComingSoon(product.variants)

  // 장면 사진 칸이 생기면, 사용자가 이미 고른 상품 사진이 같은 사진으로 남게 그만큼 민다
  useEffect(() => {
    if (photoCount > 0 && userPicked.current) {
      setSelectedIndex((index) =>
        index >= (hasModelSlot ? 1 : 0) ? index + photoCount : index
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoCount])

  const pick = (index: number) => {
    userPicked.current = true
    setSelectedIndex(index)
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
        <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
          {slides.map((slide, index) => (
            <button
              key={
                slide.type === "image"
                  ? (slide.image.id ?? index)
                  : slide.type === "photo"
                    ? slide.mockup.background
                    : "model3d"
              }
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
              {slide.type === "image" ? (
                <Image
                  src={getThumbnailUrl(slide.image.url)}
                  alt={
                    product.title
                      ? t("altIndex", {
                          name: product.title,
                          index: index - firstImageSlide + 1,
                        })
                      : t("mainAlt")
                  }
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : slide.type === "photo" && art ? (
                <PhotoMockupScene mockup={slide.mockup} art={art} />
              ) : isWindow && art ? (
                <PhotoMockupScene mockup={WINDOW_MOCKUP} art={art} />
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
        {isWindow ? (
          art && (
            <div
              role="img"
              aria-label={tPaper("windowAlt", { name: product.title ?? "" })}
              aria-hidden={selected?.type !== "model"}
              className={cn(
                "bg-muted absolute inset-0 z-[5] transition-opacity",
                selected?.type === "model"
                  ? "opacity-100"
                  : "pointer-events-none opacity-0"
              )}
            >
              <PhotoMockupScene mockup={WINDOW_MOCKUP} art={art} />
            </div>
          )
        ) : paper && paper.shape !== "window" ? (
          <PaperModelLayer
            templateId={paper.templateId}
            shape={paper.shape}
            productId={product.id}
            productName={product.title ?? ""}
            fallbackVariant={paper.fallbackVariant}
            visible={selected?.type === "model"}
            onStatus={handleModelStatus}
          />
        ) : (
          <ProductModel3dLayer
            fileId={product.metadata?.model3dFileId}
            productName={product.title ?? ""}
            visible={selected?.type === "model"}
            onStatus={handleModelStatus}
          />
        )}
        {selected?.type === "photo" && art && (
          <div
            role="img"
            aria-label={tPaper("sceneAlt", { name: product.title ?? "" })}
            className="bg-muted absolute inset-0 z-[5]"
          >
            <PhotoMockupScene mockup={selected.mockup} art={art} />
          </div>
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
