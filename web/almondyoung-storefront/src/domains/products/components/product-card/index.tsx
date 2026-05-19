"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ProductQuickActions } from "domains/products/components/product-quick-actions"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { HttpTypes } from "@medusajs/types"
import { Star } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"
import ProductPrice from "./price"
import Thumbnail from "../thumbnail"
import { Quantity } from "./quantity"

type RatingSummary = {
  averageRating: number
  totalCount: number
}

const ratingSummaryCache = new Map<string, Promise<RatingSummary>>()

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

const fetchRatingSummary = (productId: string) => {
  const cached = ratingSummaryCache.get(productId)
  if (cached) return cached

  const request = fetch(
    `/api/ugc/rating-summary?${new URLSearchParams({ productId })}`
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => ({
      averageRating: toFiniteNumber(data?.averageRating),
      totalCount: toFiniteNumber(data?.totalCount),
    }))
    .catch(() => ({ averageRating: 0, totalCount: 0 }))

  ratingSummaryCache.set(productId, request)
  return request
}

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

  const isSingleOption = (product.variants?.length ?? 0) <= 1
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

    if (!productReviewId || metadataSummary.totalCount > 0) return

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
            overlay={overlay}
          />
          <ProductQuickActions
            productId={product.id ?? ""}
            productHandle={product.handle ?? ""}
            productTitle={product.title ?? ""}
            productImage={product.thumbnail ?? undefined}
            variantId={product.variants?.[0]?.id}
            isSingleOption={isSingleOption}
            countryCode={countryCode}
            isWishlisted={isWishlisted}
          />
        </div>

        <div className="mt-4 min-h-20">
          <h3 className="text-foreground line-clamp-1 text-[14px] leading-tight">
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

            <Quantity product={product} />
          </div>
        </div>
      </div>
    </LocalizedClientLink>
  )
}
