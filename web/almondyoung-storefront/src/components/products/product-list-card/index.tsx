"use client"

import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { useMembershipPricing } from "@/hooks/use-membership-pricing"
import { ProductPrice } from "@/components/products/prodcut-card/parts/product-price"

export interface ProductListCardProps {
  id: string
  handle: string
  title: string
  imageSrc: string
  price: number
  originalPrice: number
  discount: number
  membershipSavings?: number
  available: number
  manageInventory: boolean
  restockDate?: string
  countryCode?: string
  onDelete?: () => void
  onAddToCart?: () => void
  isDeleting?: boolean
  isAddingToCart?: boolean
  showDeleteButton?: boolean
  showCartButton?: boolean
  optionMeta?: {
    isSingle?: boolean
    defaultVariantId?: string
  }
}

export function ProductListCard({
  handle,
  title,
  imageSrc,
  price,
  originalPrice,
  discount,
  membershipSavings,
  available,
  manageInventory,
  restockDate,
  countryCode = "kr",
  onDelete,
  onAddToCart,
  isDeleting = false,
  isAddingToCart = false,
  showDeleteButton = true,
  showCartButton = true,
}: ProductListCardProps) {
  const { isMembershipPricing } = useMembershipPricing()
  const isMember = isMembershipPricing

  const isSoldOut = manageInventory && available <= 0
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

  // 가격 표시 로직 (ProductInfo와 동일)
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

  return (
    <div className="flex gap-4 border-b border-gray-100 py-4 last:border-b-0">
      {/* 썸네일 */}
      <Link
        href={`/${countryCode}/products/${handle}`}
        className="relative h-[100px] w-[100px] flex-shrink-0 overflow-hidden rounded-lg md:h-[120px] md:w-[120px]"

      >
        <Image
          src={imageSrc ? getThumbnailUrl(imageSrc) : "/placeholder.png"}
          alt={title}
          fill
          className={cn("object-cover", isSoldOut && "opacity-50")}
          sizes="(max-width: 768px) 100px, 120px"
        />
      </Link>

      {/* 상품 정보 */}
      <div className="flex flex-1 flex-col justify-between">
        {/* 상품명 */}
        <Link
          href={`/${countryCode}/products/${handle}`}
          className="line-clamp-2 text-sm font-medium text-gray-900 hover:underline md:text-base"
        >
          {title}
        </Link>

        {/* 가격 정보 - 공통 컴포넌트 사용 */}
        <div className="mt-2 flex flex-col gap-1">
          {isSoldOut ? (
            <div className="flex flex-col gap-1">
              <span className="text-base font-bold text-gray-900 md:text-lg">
                일시품절
              </span>
              {restockDate && (
                <span className="text-xs text-[#E74C3C]">
                  재입고 일정 : {restockDate} 입고예정
                </span>
              )}
            </div>
          ) : (
            <>
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
              {/* 잔여수량 */}
              {manageInventory && available > 0 && available <= 10 && (
                <span className="text-xs text-gray-500">
                  잔여수량 : {available}
                </span>
              )}
            </>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="mt-3 flex gap-2">
          {showDeleteButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
              className="h-8 rounded-md border-gray-300 px-4 text-xs font-medium text-gray-700"
            >
              삭제
            </Button>
          )}
          {showCartButton && !isSoldOut && (
            <Button
              variant="outline"
              size="sm"
              onClick={onAddToCart}
              disabled={isAddingToCart}
              className="h-8 rounded-md border-[#F2994A] px-4 text-xs font-medium text-[#F2994A] hover:bg-[#F2994A]/5"
            >
              장바구니 담기
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// 스켈레톤 컴포넌트
export function ProductListCardSkeleton() {
  return (
    <div className="flex gap-4 border-b border-gray-100 py-4 last:border-b-0">
      {/* 썸네일 스켈레톤 */}
      <div className="h-[100px] w-[100px] flex-shrink-0 animate-pulse rounded-lg bg-gray-200 md:h-[120px] md:w-[120px]" />

      {/* 상품 정보 스켈레톤 */}
      <div className="flex flex-1 flex-col justify-between">
        <div className="h-5 w-3/4 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 flex flex-col gap-2">
          <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
          <div className="h-6 w-1/3 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-1/4 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="mt-3 flex gap-2">
          <div className="h-8 w-16 animate-pulse rounded bg-gray-200" />
          <div className="h-8 w-24 animate-pulse rounded bg-gray-200" />
        </div>
      </div>
    </div>
  )
}
