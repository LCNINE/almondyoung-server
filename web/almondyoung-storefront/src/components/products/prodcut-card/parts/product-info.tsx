"use client"

import { ProductCardProps, StockStatus } from "@/lib/types/ui/product"
import { ProductPrice } from "./product-price"
import { ProductRating } from "./product-rating"
import { LowStockBadge } from "@/components/shared/badges/low-stock-badge"
import { OverseasBadge } from "@/components/shared/badges/overseas-badge"
import { SoldOutTag } from "./sold-out-tag"
import { resolveCardPriceDisplay } from "@/lib/utils/product-card-display"

const LOW_STOCK_THRESHOLD = 10

export function ProductInfo({
  title,
  available,
  manageInventory,
  price,
  originalPrice,
  discount: _discount,
  rating,
  reviewCount,
  membershipSavings,
  isMembershipOnly,
  isMembership,
  isOverseas,
  showMembershipHint: _showMembershipHint,
}: Omit<ProductCardProps, "imageSrc" | "rank">) {
  const {
    displayPrice,
    displayOriginalPrice,
    displayDiscount,
    membershipPrice,
    showMembershipBadge,
    showMembershipHint,
    membershipHintSavings,
  } = resolveCardPriceDisplay({
    price,
    originalPrice,
    membershipSavings,
    isMembership,
  })

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
        {isOverseas && <OverseasBadge />}
        {title}
      </h3>

      <div className="min-h-[18px]">{renderStockBadge()}</div>

      <div className="flex flex-col">
        <ProductPrice
          price={displayPrice}
          originalPrice={displayOriginalPrice ?? originalPrice}
          discount={displayDiscount}
          membershipSavings={membershipHintSavings}
          showMembershipHint={showMembershipHint}
          showMembershipBadge={showMembershipBadge}
          membershipPrice={membershipPrice}
          isMembershipOnly={isMembershipOnly}
          isMembership={isMembership}
        />
      </div>

      {/* 리뷰 영역 */}
      <ProductRating rating={rating} reviewCount={reviewCount ?? 0} />
    </div>
  )
}
