"use client"

import { useMembershipPricing } from "@/hooks/use-membership-pricing"
import { ProductCardProps, StockStatus } from "@/lib/types/ui/product"
import { ProductPrice } from "./product-price"
import { ProductRating } from "./product-rating"
import { LowStockBadge } from "@/components/shared/badges/low-stock-badge"
import { SoldOutTag } from "./sold-out-tag"

const LOW_STOCK_THRESHOLD = 10

export function ProductInfo({
  id,
  title,
  available,
  manageInventory,
  price,
  originalPrice,
  discount,
  rating,
  reviewCount,
  membershipSavings,
  isMembershipOnly,
  showMembershipHint: _showMembershipHint,
}: Omit<ProductCardProps, "imageSrc" | "rank">) {
  const { isMembershipPricing } = useMembershipPricing()
  const isMember = isMembershipPricing

  // 멤버십 회원: 멤버십 가격(price) 표시 + 뱃지
  // 비회원/일반회원: 기본가(originalPrice) 표시 + 멤버십 절약 힌트
  const hasMembershipPrice = membershipSavings != null && membershipSavings > 0
  const membershipPrice =
    membershipSavings != null && originalPrice != null
      ? originalPrice - membershipSavings
      : undefined
  const memberDisplayPrice =
    isMember && hasMembershipPrice
      ? typeof price === "number" && price > 0 && price < originalPrice
        ? price
        : (membershipPrice ?? price)
      : price

  const displayPrice =
    isMember || !hasMembershipPrice ? memberDisplayPrice : originalPrice
  const displayOriginalPrice =
    isMember && hasMembershipPrice ? originalPrice : undefined
  const displayDiscount =
    isMember &&
    hasMembershipPrice &&
    displayPrice > 0 &&
    originalPrice > displayPrice
      ? Math.round(((originalPrice - displayPrice) / originalPrice) * 100)
      : discount
  const showMembershipBadge = isMember && hasMembershipPrice
  const showMembershipHint = !isMember && hasMembershipPrice

  // 재고 상태
  const stockStatus: StockStatus =
    manageInventory && available === 0
      ? "soldOut"
      : manageInventory &&
          Number.isFinite(available) &&
          available > 0 &&
          available <= LOW_STOCK_THRESHOLD
        ? "lowStock"
        : "inStock"

  const renderStockBadge = () => {
    switch (stockStatus) {
      case "soldOut":
        return <SoldOutTag isSoldOut={stockStatus === "soldOut"} />
      case "lowStock":
        return <LowStockBadge count={available} />
      case "inStock":
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col gap-0.5 px-1">
      <h3 className="line-clamp-1 text-[14px] leading-tight text-gray-600">
        {title}
      </h3>

      <div className="min-h-[18px]">{renderStockBadge()}</div>

      <div className="flex flex-col">
        <ProductPrice
          productId={id}
          price={displayPrice}
          originalPrice={displayOriginalPrice ?? originalPrice}
          discount={displayDiscount}
          membershipSavings={membershipSavings}
          showMembershipHint={showMembershipHint}
          showMembershipBadge={showMembershipBadge}
          membershipPrice={membershipPrice}
          isMember={isMember}
          isMembershipOnly={isMembershipOnly}
        />
      </div>

      {/* 리뷰 영역 */}
      <ProductRating rating={rating} reviewCount={reviewCount ?? 0} />
    </div>
  )
}
