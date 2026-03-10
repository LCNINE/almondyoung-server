// CartCard.tsx

import React, { forwardRef } from "react"
import { ChevronRight } from "lucide-react"
import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Image from "next/image"

// --- Props 타입 정의 ---
interface CartCardThumbnailProps {
  src: string
  alt?: string
}
interface CartCardTitleProps {
  children: React.ReactNode
}
interface CartCardOptionProps {
  children: React.ReactNode
}
interface CartCardBrandProps {
  children: React.ReactNode
}
interface CartCardBadgeProps {
  children: React.ReactNode
}
interface CartCardPriceProps {
  original?: number
  discounted?: number
  discountRate?: number
  membership?: boolean
  actual?: number
  showMembershipHint?: boolean
}
interface CartCardContentProps {
  children: React.ReactNode
}
interface CartCardRootProps extends React.HTMLAttributes<HTMLDivElement> {
  controlLeft?: React.ReactNode
  controlRight?: React.ReactNode
  children: React.ReactNode
}

// PC 버전용 Props 타입 정의
interface CartCardPCThumbnailProps {
  src: string
  alt?: string
}
interface CartCardPCTitleProps {
  children: React.ReactNode
}
interface CartCardPCOptionProps {
  children: React.ReactNode
}
interface CartCardPCBadgeProps {
  children: React.ReactNode
}
interface CartCardPCPriceProps {
  original?: number
  discounted: number
  discountRate?: number
  isMembership?: boolean
  actual?: number
  showMembershipHint?: boolean
}
interface CartCardPCContentProps {
  children: React.ReactNode
}
interface CartCardPCRootProps extends React.HTMLAttributes<HTMLDivElement> {
  controlLeft?: React.ReactNode
  controlRight?: React.ReactNode
  children: React.ReactNode
}

export const CartCardThumbnail = ({
  src,
  alt = "상품 이미지",
}: CartCardThumbnailProps) => {
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md shadow-xs ring-1 ring-black/5">
      <Image
        src={getThumbnailUrl(src)}
        fill
        alt={alt}
        sizes="64px"
        className="object-cover"
      />
    </div>
  )
}

export const CartCardTitle = ({ children }: CartCardTitleProps) => {
  return <p className="truncate text-sm font-medium text-black">{children}</p>
}

export const CartCardOption = ({ children }: CartCardOptionProps) => {
  return <p className="text-muted-foreground text-xs">옵션 : {children}</p>
}

export const CartCardBrand = ({ children }: CartCardBrandProps) => {
  return (
    <div className="mt-1 flex items-center gap-1 text-sm font-medium text-zinc-800">
      {children} <ChevronRight className="h-4 w-4" />
    </div>
  )
}

export const CartCardBadge = ({ children }: CartCardBadgeProps) => {
  return <div className="text-xs text-green-600 md:text-sm">{children}</div>
}

export const CartCardPrice = ({
  original,
  discounted,
  discountRate,
  membership,
  actual,
  showMembershipHint = false,
}: CartCardPriceProps) => {
  const hasDiscount =
    typeof original === "number" &&
    typeof discountRate === "number" &&
    discountRate > 0

  if (showMembershipHint && typeof actual === "number") {
    const membershipSavings =
      hasDiscount && discounted != null ? original - discounted : null
    return (
      <>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{actual.toLocaleString()}원</span>
        </div>
        {hasDiscount && discounted != null && (
          <div className="mt-1 space-y-0.5">
            <p className="text-xs text-gray-400">
              {discountRate}%{" "}
              <span className="line-through">
                {original.toLocaleString()}원
              </span>
            </p>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-[#F2994A]">
                {discounted.toLocaleString()}원
              </span>
              <ProductMembershipBadge size="sm" />
            </div>
            {membershipSavings != null && membershipSavings > 0 && (
              <p className="text-[11px] text-gray-500">
                멤버십 가입 시 {membershipSavings.toLocaleString()}원 절약
              </p>
            )}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      {membership && discounted != null && hasDiscount && (
        <p className="text-xs text-gray-400">
          {discountRate}%{" "}
          <span className="line-through">{original.toLocaleString()}원</span>
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold">
          {(discounted ?? original ?? 0).toLocaleString()}원
        </span>
        {membership && discounted != null && (
          <ProductMembershipBadge size="sm" />
        )}
      </div>
    </>
  )
}

/** 썸네일과 나머지 정보를 감싸는 컨테이너 */
export const CartCardContent = ({ children }: CartCardContentProps) => (
  <div className="flex min-w-0 flex-col gap-1">{children}</div>
)

/** 전체 카드 레이아웃을 담당하는 Root 컴포넌트 */
export const CartCardRoot = forwardRef<HTMLDivElement, CartCardRootProps>(
  ({ controlLeft, controlRight, children, className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          "grid grid-cols-[auto_1fr_auto] items-start gap-x-2",
          "border-b border-gray-200 px-4 py-5",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {/* 좌측 컨트롤 (e.g., 체크박스) */}
        <div className="pt-[3px]">{controlLeft}</div>
        {/* 메인 컨텐츠 */}
        <div className="min-w-0">{children}</div>
        {/* 우측 컨트롤 (e.g., 삭제 버튼) */}
        <div>{controlRight}</div>
      </div>
    )
  }
)

// --- PC 버전용 Atomic 컴포넌트들 ---

export const CartCardPCThumbnail = ({
  src,
  alt = "상품 이미지",
}: CartCardPCThumbnailProps) => {
  return (
    <div className="relative h-[101px] w-[99px] shrink-0 overflow-hidden rounded-[5px] shadow-xs ring-1 ring-black/5">
      <Image
        src={getThumbnailUrl(src)}
        alt={alt}
        fill
        sizes="99px"
        className="object-cover"
      />
    </div>
  )
}

export const CartCardPCTitle = ({ children }: CartCardPCTitleProps) => {
  return (
    <h3 className="line-clamp-1 text-base font-normal text-gray-900">
      {children}
    </h3>
  )
}

export const CartCardPCOption = ({ children }: CartCardPCOptionProps) => {
  return <p className="mt-2.5 text-sm text-gray-500">옵션 : {children}</p>
}

export const CartCardPCBadge = ({ children }: CartCardPCBadgeProps) => {
  return <p className="text-sm text-[#3baa64]">{children}</p>
}

export const CartCardPCPrice = ({
  original,
  discounted,
  discountRate,
  isMembership = false,
  actual,
  showMembershipHint = false,
}: CartCardPCPriceProps) => {
  const hasDiscount =
    typeof original === "number" &&
    typeof discountRate === "number" &&
    discountRate > 0

  if (showMembershipHint && typeof actual === "number") {
    const membershipSavings = hasDiscount ? original - discounted : null
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <span className="text-[19px] font-bold text-gray-900">
            {actual.toLocaleString()}원
          </span>
        </div>
        {hasDiscount && (
          <div>
            <div className="flex items-center gap-1 text-xs text-[#aeaeb2]">
              <span className="font-medium">{discountRate}%</span>
              <span className="line-through">
                {original.toLocaleString()}원
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <span className="text-[15px] font-bold text-[#F2994A]">
                {discounted.toLocaleString()}원
              </span>
              <ProductMembershipBadge size="md" />
            </div>
            {membershipSavings != null && membershipSavings > 0 && (
              <p className="mt-1 text-[12px] text-gray-500">
                멤버십 가입 시 {membershipSavings.toLocaleString()}원 절약
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* 할인가격 표시 */}
      {hasDiscount ? (
        <div>
          <div className="flex items-center gap-1 text-xs text-[#aeaeb2]">
            <span className="font-medium">{discountRate}%</span>
            <span className="line-through">{original.toLocaleString()}원</span>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-[19px] font-bold text-gray-900">
              {discounted.toLocaleString()}원
            </span>
            {isMembership && <ProductMembershipBadge size="md" />}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <span className="text-[19px] font-bold text-gray-900">
            {discounted.toLocaleString()}원
          </span>
        </div>
      )}
    </div>
  )
}

export const CartCardPCContent = ({ children }: CartCardPCContentProps) => (
  <div className="flex min-w-[200px] flex-col gap-4">{children}</div>
)

export const CartCardPCInfo = ({ children }: { children: React.ReactNode }) => (
  <div className="flex-1">{children}</div>
)

export const CartCardPCImageSection = ({
  children,
}: {
  children: React.ReactNode
}) => <div className="mt-2.5 flex gap-3.5 pl-8">{children}</div>

export const CartCardPCHeader = ({
  children,
}: {
  children: React.ReactNode
}) => <div className="flex items-start gap-5">{children}</div>

/** PC 버전 전체 카드 레이아웃을 담당하는 Root 컴포넌트 */
export const CartCardPCRoot = forwardRef<HTMLDivElement, CartCardPCRootProps>(
  ({ controlLeft, controlRight, children, className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={["border-b border-gray-200 bg-white px-4 py-5", className]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {children}
      </div>
    )
  }
)
