// CartCard.tsx

import React, { forwardRef } from "react"
import { ChevronRight, X } from "lucide-react"
import MemberShipTagIcon from "../../icons/membership-tag-icon"

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
  original: number
  discounted?: number
  discountRate?: number
  membership?: boolean
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
}
interface CartCardPCContentProps {
  children: React.ReactNode
}
interface CartCardPCRootProps extends React.HTMLAttributes<HTMLDivElement> {
  controlLeft?: React.ReactNode
  controlRight?: React.ReactNode
  children: React.ReactNode
}

// --- 풀네임으로 수정된 개별 컴포넌트 ---

export const CartCardThumbnail = ({
  src,
  alt = "상품 이미지",
}: CartCardThumbnailProps) => {
  return (
    <img
      src={src}
      alt={alt}
      width={65}
      height={66}
      className="h-16 w-16 flex-shrink-0 rounded-md"
    />
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
    <div className="mt-1 text-sm font-medium text-zinc-800 flex items-center gap-1">
      {children} <ChevronRight className="h-4 w-4" />
    </div>
  )
}

export const CartCardBadge = ({ children }: CartCardBadgeProps) => {
  return <div className="text-sm text-green-600">{children}</div>
}

export const CartCardPrice = ({
  original,
  discounted,
  discountRate,
  membership,
}: CartCardPriceProps) => {
  return (
    <>
      {membership && discounted != null && (
        <p className="text-xs text-gray-400">
          {discountRate}%{" "}
          <span className="line-through">{original.toLocaleString()}원</span>
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold">
          {(discounted ?? original).toLocaleString()}원
        </span>
        {membership && discounted != null && (
          <MemberShipTagIcon width={80} height={16} />
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
    <div className="h-[101px] w-[99px] flex-shrink-0">
      <img
        src={src}
        alt={alt}
        className="h-full w-full rounded-[5px] object-cover"
      />
    </div>
  )
}

export const CartCardPCTitle = ({ children }: CartCardPCTitleProps) => {
  return (
    <h3 className="text-base font-normal text-gray-900 line-clamp-1">
      {children}
    </h3>
  )
}

export const CartCardPCOption = ({ children }: CartCardPCOptionProps) => {
  return (
    <p className="mt-2.5 text-sm text-gray-500">
      옵션 : {children}
    </p>
  )
}

export const CartCardPCBadge = ({ children }: CartCardPCBadgeProps) => {
  return <p className="text-sm text-[#3baa64]">{children}</p>
}

export const CartCardPCPrice = ({
  original,
  discounted,
  discountRate,
  isMembership = false,
}: CartCardPCPriceProps) => {
  return (
    <div className="space-y-2">
      {/* 할인가격 표시 */}
      {original && discountRate ? (
        <div>
          <div className="flex items-center gap-1 text-xs text-[#aeaeb2]">
            <span className="font-medium">{discountRate}%</span>
            <span className="line-through">{original.toLocaleString()}원</span>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-[19px] font-bold text-gray-900">
              {discounted.toLocaleString()}원
            </span>
            {isMembership && (
              <div className="flex items-center gap-0.5">
                <MemberShipTagIcon width={90} height={20} />
              </div>
            )}
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
  <div className="flex flex-col gap-4 min-w-[200px]">{children}</div>
)

export const CartCardPCInfo = ({ children }: { children: React.ReactNode }) => (
  <div className="flex-1">{children}</div>
)

export const CartCardPCImageSection = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-2.5 flex gap-3.5 pl-8">{children}</div>
)

export const CartCardPCHeader = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-start gap-5">{children}</div>
)

/** PC 버전 전체 카드 레이아웃을 담당하는 Root 컴포넌트 */
export const CartCardPCRoot = forwardRef<HTMLDivElement, CartCardPCRootProps>(
  ({ controlLeft, controlRight, children, className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          "bg-white border-b border-gray-200 px-4 py-5",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {children}
      </div>
    )
  }
)
