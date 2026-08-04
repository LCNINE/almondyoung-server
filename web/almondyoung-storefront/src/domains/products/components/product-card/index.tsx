"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ProductQuickActions } from "domains/products/components/product-quick-actions"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { isDigitalProduct } from "@/lib/api/medusa/shipping-method-policy"
import { fetchRatingSummaryBatched } from "@/lib/api/ugc/rating-summary-batch"
import { HttpTypes } from "@medusajs/types"
import { Lock, Star } from "lucide-react"
import { useTranslations } from "next-intl"
import React, { useEffect, useMemo, useState } from "react"
import ProductPrice from "./price"
import Thumbnail from "../thumbnail"
import { Quantity } from "./quantity"
import { calculateStockStatus } from "./quantity/stock-status"
import { SoldOutOverlay } from "@/components/products/sold-out-overlay"
import { OverseasBadge } from "@/components/shared/badges/overseas-badge"
import {
  getIsOverseas,
  getRequiresMembershipToPurchase,
} from "@/lib/utils/product-card"

type RatingSummary = {
  averageRating: number
  totalCount: number
}

const toFiniteNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const getMetadataRatingSummary = (
  metadata: HttpTypes.StoreProduct["metadata"]
): RatingSummary => ({
  averageRating: toFiniteNumber(
    metadata?.averageRating ?? metadata?.rating ?? metadata?.reviewRating
  ),
  totalCount: toFiniteNumber(
    metadata?.reviewCount ?? metadata?.totalCount ?? metadata?.reviewTotalCount
  ),
})

// 카드마다 호출하지만 같은 tick 의 요청은 한 번으로 합쳐진다
const fetchRatingSummary = fetchRatingSummaryBatched

function ProductCardRating({
  rating,
  reviewCount,
}: {
  rating: number
  reviewCount: number
}) {
  if (reviewCount <= 0) return null

  const clampedRating = Math.max(0, Math.min(5, rating))
  const roundedRating = Math.round(clampedRating * 2) / 2

  return (
    <div
      className="mt-1 flex items-center gap-0.5"
      aria-label={`평점 ${clampedRating.toFixed(1)}점, 리뷰 ${reviewCount.toLocaleString()}개`}
    >
      {Array.from({ length: 5 }).map((_, index) => {
        const fillPercent = Math.max(
          0,
          Math.min(100, (roundedRating - index) * 100)
        )

        return (
          <span key={index} className="relative h-3.5 w-3.5">
            <Star
              className="absolute h-3.5 w-3.5 fill-gray-200 text-gray-200"
              aria-hidden="true"
            />
            {fillPercent > 0 && (
              <span
                className="absolute block h-3.5 overflow-hidden"
                style={{ width: `${fillPercent}%` }}
                aria-hidden="true"
              >
                <Star className="h-3.5 w-3.5 fill-[#F2994A] text-[#F2994A]" />
              </span>
            )}
          </span>
        )
      })}
      <span className="ml-0.5 text-[12px] leading-none text-gray-700">
        ({reviewCount.toLocaleString()})
      </span>
    </div>
  )
}

export default function ProductCard({
  product,
  isMembership,
  isMembershipOnly,
  overlay,
  countryCode = "kr",
  isWishlisted = false,
}: {
  product: HttpTypes.StoreProduct
  isMembership: boolean
  isMembershipOnly: boolean
  overlay?: React.ReactNode
  countryCode?: string
  isWishlisted?: boolean
}) {
  const { cheapestPrice } = getProductPrice({
    product,
  })
  const tCard = useTranslations("productCard")
  const isDigital = isDigitalProduct(product)

  const isSingleOption = (product.variants?.length ?? 0) <= 1
  const isSoldOut = useMemo(
    () => calculateStockStatus(product).kind === "soldOut",
    [product]
  )
  const membersOnlyPurchase =
    !isMembership && getRequiresMembershipToPurchase(product)
  const productReviewId =
    typeof product.metadata?.pimMasterId === "string"
      ? product.metadata.pimMasterId
      : product.handle
  const metadataSummary = useMemo(
    () => getMetadataRatingSummary(product.metadata),
    [product.metadata]
  )
  const [ratingSummary, setRatingSummary] =
    useState<RatingSummary>(metadataSummary)

  useEffect(() => {
    setRatingSummary(metadataSummary)

    if (!productReviewId) return

    let ignore = false

    fetchRatingSummary(productReviewId).then((summary) => {
      if (!ignore) setRatingSummary(summary)
    })

    return () => {
      ignore = true
    }
  }, [metadataSummary, productReviewId])

  return (
    <LocalizedClientLink
      href={`/products/${product.handle}`}
      className="group cursor-pointer"
    >
      <div>
        <div className="relative">
          <Thumbnail
            thumbnail={product.thumbnail}
            images={product.images}
            size="full"
            overlay={
              <>
                {overlay}
                {isSoldOut && (
                  <SoldOutOverlay
                    variants={product.variants}
                    className="rounded-large"
                  />
                )}
              </>
            }
          />

          {membersOnlyPurchase && (
            <span className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
              <Lock className="size-3" />
              {tCard("membersOnly")}
            </span>
          )}

          {isDigital && (
            <span className="bg-primary/90 absolute top-2 left-2 z-10 rounded px-2 py-0.5 text-[11px] font-medium text-white">
              {tCard("digitalBadge")}
            </span>
          )}

          {/* 장바구니 담기 및 위시리스트 버튼  */}
          <ProductQuickActions
            productId={product.id ?? ""}
            productHandle={product.handle ?? ""}
            productTitle={product.title ?? ""}
            productImage={product.thumbnail ?? undefined}
            variantId={product.variants?.[0]?.id}
            isSingleOption={isSingleOption}
            countryCode={countryCode}
            isWishlisted={isWishlisted}
            membersOnlyPurchase={membersOnlyPurchase}
          />
        </div>

        <div className="mt-4 min-h-20">
          <h3 className="text-foreground line-clamp-1 text-[14px] leading-tight">
            {getIsOverseas(product) && <OverseasBadge />}
            {product.title}
          </h3>
          <ProductCardRating
            rating={ratingSummary.averageRating}
            reviewCount={ratingSummary.totalCount}
          />

          <div className="flex flex-col gap-3">
            {cheapestPrice && (
              <ProductPrice
                price={cheapestPrice}
                membershipPrice={
                  product.variants?.[0]?.metadata?.membershipPrice as number
                }
                isMembership={isMembership}
                isMembershipOnly={isMembershipOnly}
              />
            )}

            {!isSoldOut && <Quantity product={product} />}
          </div>
        </div>
      </div>
    </LocalizedClientLink>
  )
}
