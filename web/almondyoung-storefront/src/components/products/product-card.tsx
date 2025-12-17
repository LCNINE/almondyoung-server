"use client"

import React from "react"
import Link from "next/link"
import {
  AlternativeProductButton,
  ProductThumbnail,
  SoldOutTag,
  ProductTitle,
  ProductStockAlert,
  ProductRating,
  MembershipTag,
  ProductPrice,
} from "./atomics"
import { AnimatedMembershipText } from "@components/products/atomics/animated-membership-text"
import { ProductCard as UIProductCard } from "../../lib/types/ui/product"
import { addToRecentViewsService } from "@lib/services/users/recent-views"

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
  // ===== 프론트 계산 (최소한) =====

  // 1. 품절 여부 (status 기반)
  const isSoldOut = product.status ? product.status !== "active" : false

  // 2. 가격 처리
  const basePrice = product.basePrice ?? 0
  const membershipPrice = product.membershipPrice ?? 0
  const isMembershipOnly = product.isMembershipOnly ?? false

  // 2-1. 가격 정보가 없는 경우 체크
  const noPriceInfo = basePrice === 0 && membershipPrice === 0

  // 3. 할인율 계산 (단순 수식 - 프론트 책임)
  const discountRate =
    basePrice > 0 && membershipPrice > 0 && membershipPrice < basePrice
      ? Math.round(((basePrice - membershipPrice) / basePrice) * 100)
      : undefined

  // 4. 표시할 가격 결정
  const displayPrice = membershipPrice > 0 ? membershipPrice : basePrice
  const originalPrice =
    membershipPrice > 0 && basePrice > membershipPrice ? basePrice : undefined

  // 5. 멤버십 태그 표시 여부
  const showMembershipTag =
    !isMembershipOnly && membershipPrice > 0 && basePrice > membershipPrice

  // 6. 장바구니 아이콘 표시 여부
  const showCartIcon = product.optionMeta?.isSingle && !isSoldOut

  // 7. 재고 알림 (5개 미만)
  const showStockAlert = product.stock?.available && product.stock.available < 5

  // 8. 타임세일 여부
  const isTimeSale = product.isTimeSale ?? false

  return (
    <Link
      href={`/kr/products/${product.id}`}
      className="flex w-full flex-col gap-2 transition-opacity hover:opacity-80 md:max-w-[280px] md:gap-3"
      style={{ minWidth: `${minWidth}px` }}
    >
      <ProductThumbnail
        src={product.thumbnail}
        alt={product.name}
        showCartIcon={showCartIcon}
        timer={showTimer && timeLeft ? formatTimer(timeLeft) : undefined}
        rankInfo={{ show: show, rank: rank }}
        isSoldOut={isSoldOut}
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
            discountRate={discountRate}
            isSoldOut={isSoldOut}
            isMembershipOnly={isMembershipOnly}
            showMembershipTag={showMembershipTag}
            isTimeSale={isTimeSale}
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
