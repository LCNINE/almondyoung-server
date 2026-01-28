"use client"

import { useMembership } from "@/contexts/membership-context"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import Link from "next/link"
import React from "react"
import { ProductCard as UIProductCard } from "../../lib/types/ui/product"
import {
  AlternativeProductButton,
  ProductPrice,
  ProductRating,
  ProductStockAlert,
  ProductThumbnail,
  ProductTitle,
} from "./atomics"

/**
 * 추후 사라질 레거시코드
 */
/**
 * ProductInfo - 공통 상품 정보 렌더링 컴포넌트
 *
 * 책임:
 * 💻 프론트: 할인율 계산 (단순 수식), 품절 판단, 재고 알림 판단
 * 📡 서버에서 받은 원본 데이터 기반 최소 가공
 */
const ProductInfo = ({
  product,
  showTimer,
  timeLeft,
  rankInfo: { show, rank },
  minWidth = 130,
}: {
  product: UIProductCard
  showTimer?: boolean
  timeLeft?: { hours: number; minutes: number; seconds: number } | null
  rankInfo: { show: boolean; rank: number }
  minWidth?: number
}) => {
  const { addToCart } = useAddToCart()
  const { status } = useMembership()
  const isMember = status === "membership"

  // ===== 프론트 계산 (최소한) =====

  // 1. 품절 여부 (status 기반)
  const isSoldOut = product.status ? product.status !== "active" : false

  // 2. 가격 처리
  const basePrice = product.basePrice ?? 0
  const membershipPrice = product.membershipPrice ?? 0
  const actualPrice = product.actualPrice ?? basePrice
  const isMembershipOnly = product.isMembershipOnly ?? false
  const effectiveMembershipPrice =
    basePrice > 0 && membershipPrice > 0 && membershipPrice < basePrice
      ? membershipPrice
      : 0

  // 2-1. 가격 정보가 없는 경우 체크
  const noPriceInfo = basePrice === 0 && membershipPrice === 0

  // 3. 할인율 계산 (단순 수식 - 프론트 책임)
  const discountRate =
    basePrice > 0 && effectiveMembershipPrice > 0
      ? Math.round(((basePrice - effectiveMembershipPrice) / basePrice) * 100)
      : undefined
  const membershipSavings =
    effectiveMembershipPrice > 0 ? basePrice - effectiveMembershipPrice : undefined

  // 4. 표시할 가격 결정 (멤버십 상태에 따라)
  // 멤버십 회원: 멤버십 가격 표시 + 뱃지
  // 비회원/일반회원: 기본가 표시 + 멤버십 절약 힌트
  const hasMembershipPrice = effectiveMembershipPrice > 0
  const displayPrice = isMember && hasMembershipPrice ? effectiveMembershipPrice : basePrice
  const originalPrice = isMember && hasMembershipPrice ? basePrice : undefined

  // 5. 멤버십 태그 표시 여부
  const showMembershipTag = !isMembershipOnly && isMember && hasMembershipPrice
  const showMembershipHint = !isMember && hasMembershipPrice

  // 6. 장바구니 아이콘 표시 여부
  const showCartIcon = product.optionMeta?.isSingle && !isSoldOut

  // 7. 재고 알림 (5개 미만)
  const showStockAlert = product.stock?.available && product.stock.available < 5

  // 8. 타임세일 여부
  const isTimeSale = product.isTimeSale ?? false

  if (process.env.NODE_ENV === "development") {
    console.log("[PRICE DEBUG][ProductCard]", {
      id: product.id,
      name: product.name,
      basePrice,
      membershipPrice,
      actualPrice,
      isMembershipOnly,
      isMember,
    })
  }

  return (
    <Link
      href={`/kr/products/${product.id}`}
      className="flex w-full flex-col gap-2 transition-opacity hover:opacity-80 md:max-w-[280px] md:gap-3"
      style={{ minWidth: `${minWidth}px` }}
    >
      <ProductThumbnail
        src={
          product.thumbnail
            ? getThumbnailUrl(product.thumbnail)
            : "https://placehold.co/240x240?text=No+Image"
        }
        alt={product.name}
        showCartIcon={showCartIcon}
        timer={showTimer && timeLeft ? formatTimer(timeLeft) : undefined}
        rankInfo={{ show: show, rank: rank }}
        isSoldOut={isSoldOut}
        onCartClick={() => addToCart({ variantId: product.id, quantity: 1 })}
      />

      <div className="flex flex-col gap-0 md:gap-1">
        <ProductTitle>{product.name}</ProductTitle>

        {/* 재고 알림 */}

        <div className="min-h-[20px] md:min-h-[24px]">
          {showStockAlert && (
            <ProductStockAlert stock={product.stock?.available ?? 0} />
          )}
        </div>

        {/* 가격 */}
        {noPriceInfo ? (
          <span className="text-base font-medium text-gray-600 md:text-[19px]">
            가격 문의
          </span>
        ) : (
          <ProductPrice
            displayPrice={displayPrice}
            originalPrice={originalPrice}
            discountRate={isMember ? discountRate : undefined}
            isSoldOut={isSoldOut}
            isMembershipOnly={isMembershipOnly}
            showMembershipTag={showMembershipTag}
            isTimeSale={isTimeSale}
            showMembershipHint={showMembershipHint}
            membershipSavings={membershipSavings}
          />
        )}

        {/* 평점/리뷰 */}
        {product.rating && product.reviewCount && (
          <ProductRating
            score={product.rating}
            reviewCount={product.reviewCount}
          />
        )}

        <AlternativeProductButton isSoldOut={isSoldOut} />
      </div>
    </Link>
  )
}

// 타이머 포맷팅 유틸리티
const formatTimer = (timer: {
  hours: number
  minutes: number
  seconds: number
}) => {
  const pad = (num: number) => num.toString().padStart(2, "0")
  return `${pad(timer.hours)}:${pad(timer.minutes)}:${pad(timer.seconds)}`
}

// 타이머 훅
const useTimer = (
  initialTimer: { hours: number; minutes: number; seconds: number } | null
) => {
  const [timeLeft, setTimeLeft] = React.useState(
    initialTimer || { hours: 0, minutes: 0, seconds: 0 }
  )

  React.useEffect(() => {
    if (!initialTimer) return

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        let { hours, minutes, seconds } = prev

        if (seconds > 0) {
          seconds -= 1
        } else if (minutes > 0) {
          minutes -= 1
          seconds = 59
        } else if (hours > 0) {
          hours -= 1
          minutes = 59
          seconds = 59
        } else {
          clearInterval(timer)
          return prev
        }

        return { hours, minutes, seconds }
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [initialTimer])

  return timeLeft
}

// ===== 외부로 export하는 컴포넌트들 =====

export function BasicProductCard({
  product,
  minWidth = 130,
}: {
  product: UIProductCard
  minWidth?: number
}) {
  return (
    <ProductInfo
      product={product}
      rankInfo={{ show: false, rank: 0 }}
      minWidth={minWidth}
    />
  )
}

export function RankProductCard({
  product,
  rank,
  minWidth = 130,
}: {
  product: UIProductCard
  rank: number
  minWidth?: number
}) {
  return (
    <ProductInfo
      product={product}
      rankInfo={{ show: true, rank: rank }}
      minWidth={minWidth}
    />
  )
}

export function DiscountProductCard({
  product,
  minWidth = 130,
}: {
  product: UIProductCard & {
    discountRate?: number
  }
  minWidth?: number
}) {
  return (
    <ProductInfo
      product={product}
      rankInfo={{ show: false, rank: 0 }}
      minWidth={minWidth}
    />
  )
}

export function TimeSaleProductCard({
  product,
  minWidth = 130,
}: {
  product: UIProductCard & {
    timer?: { hours: number; minutes: number; seconds: number }
  }
  minWidth?: number
}) {
  const timeLeft = useTimer(product.timer ?? null)
  return (
    <ProductInfo
      product={{ ...product, isTimeSale: true }}
      showTimer={!!product.timer}
      timeLeft={timeLeft}
      rankInfo={{ show: false, rank: 0 }}
      minWidth={minWidth}
    />
  )
}

// 스켈레톤 컴포넌트들
export function ProductCardSkeleton({ minWidth = 130 }: { minWidth?: number }) {
  return (
    <div
      className="flex w-full animate-pulse flex-col gap-2 md:max-w-[280px] md:gap-3"
      style={{ minWidth: `${minWidth}px` }}
    >
      {/* 썸네일 스켈레톤 */}
      <div className="aspect-square w-full rounded-2xl bg-gray-200" />

      {/* 텍스트 스켈레톤 */}
      <div className="flex flex-col gap-1.5">
        <div className="h-4 w-3/4 rounded bg-gray-200" />
        <div className="h-5 w-1/2 rounded bg-gray-200" />
        <div className="h-3 w-1/3 rounded bg-gray-200" />
      </div>
    </div>
  )
}

export function ProductsGridSkeleton({
  count = 8,
  minWidth = 130,
}: {
  count?: number
  minWidth?: number
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} minWidth={minWidth} />
      ))}
    </>
  )
}
