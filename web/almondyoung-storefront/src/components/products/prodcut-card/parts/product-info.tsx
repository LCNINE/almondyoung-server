"use client"

import { useMembership } from "@/contexts/membership-context"
import { ProductCardProps } from "@/lib/types/ui/product"
import { ProductPrice } from "./product-price"
import { ProductRating } from "./product-rating"

export function ProductInfo({
  title,
  price,
  originalPrice,
  discount,
  rating,
  reviewCount,
  membershipSavings,
  showMembershipHint: _showMembershipHint,
}: Omit<ProductCardProps, "imageSrc" | "rank">) {
  const { status } = useMembership()
  const isMember = status === "membership"

  // 멤버십 회원: 멤버십 가격(price) 표시 + 뱃지
  // 비회원/일반회원: 기본가(originalPrice) 표시 + 멤버십 절약 힌트
  const hasMembershipPrice = membershipSavings != null && membershipSavings > 0

  const displayPrice = isMember || !hasMembershipPrice ? price : originalPrice
  const displayOriginalPrice = isMember && hasMembershipPrice ? originalPrice : undefined
  const displayDiscount = isMember && hasMembershipPrice ? discount : 0
  const showMembershipBadge = isMember && hasMembershipPrice
  const showMembershipHint = !isMember && hasMembershipPrice
  const membershipPrice =
    membershipSavings != null && originalPrice != null
      ? originalPrice - membershipSavings
      : undefined

  return (
    <div className="flex flex-col gap-0.5 px-1">
      <h3 className="line-clamp-2 text-[14px] leading-tight text-gray-600">
        {title}
      </h3>

      <div className="mt-1 flex flex-col">
        <ProductPrice
          price={displayPrice}
          originalPrice={displayOriginalPrice ?? originalPrice}
          discount={displayDiscount}
          membershipSavings={membershipSavings}
          showMembershipHint={showMembershipHint}
          showMembershipBadge={showMembershipBadge}
          membershipPrice={membershipPrice}
          isMember={isMember}
        />
      </div>

      {/* 리뷰 영역 */}
      <ProductRating rating={rating} reviewCount={reviewCount ?? 0} />
    </div>
  )
}
