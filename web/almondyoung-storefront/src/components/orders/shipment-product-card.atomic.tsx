// ShipmentProductCard.tsx
import React, { forwardRef } from "react"

/* ------------------------------------------------------------------ */
/* 1. 썸네일                                                           */
/* ------------------------------------------------------------------ */
interface ShipmentProductCardThumbnailProps {
  src: string
  alt?: string
  className?: string
}

export const ShipmentProductCardThumbnail = ({
  src,
  alt = "thumbnail",
  className,
}: ShipmentProductCardThumbnailProps) => (
  <img
    src={src}
    alt={alt}
    width={48}
    height={48}
    className={[
      "flex-shrink-0 rounded-[5px] border border-neutral-300 object-cover",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  />
)

/* ------------------------------------------------------------------ */
/* 2. 정보 영역(주문번호·상태 등)                                       */
/* ------------------------------------------------------------------ */
interface ShipmentProductCardInfoProps {
  children: React.ReactNode
  className?: string
}

export const ShipmentProductCardInfo = ({
  children,
  className,
}: ShipmentProductCardInfoProps) => (
  <div
    className={["flex flex-col gap-[7px]", className].filter(Boolean).join(" ")}
  >
    {children}
  </div>
)

interface ShipmentProductCardOrderNumberProps {
  children: React.ReactNode
}

export const ShipmentProductCardOrderNumber = ({
  children,
}: ShipmentProductCardOrderNumberProps) => (
  <span className="text-[9.5px] leading-[1.19] font-medium text-neutral-500">
    {children}
  </span>
)

interface ShipmentProductCardStatusProps {
  children: React.ReactNode
}

export const ShipmentProductCardStatus = ({
  children,
}: ShipmentProductCardStatusProps) => (
  <span
    className="text-[15px] leading-[1] font-medium -tracking-[0.01em]"
    style={{ color: "#007AFF" }} // 항상 “배송 중” 컬러
  >
    {children}
  </span>
)

/* ------------------------------------------------------------------ */
/* 3. 기본 화살표 & Right 슬롯                                         */
/* ------------------------------------------------------------------ */
const DefaultArrow = () => (
  <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
    <path
      d="M8 5l8 7-8 7"
      stroke="#1E1E1E"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

interface ShipmentProductCardRightProps {
  children?: React.ReactNode
}

export const ShipmentProductCardRight = ({
  children,
}: ShipmentProductCardRightProps) => (
  <div className="ml-auto flex-shrink-0">{children ?? <DefaultArrow />}</div>
)

/* ------------------------------------------------------------------ */
/* 4. (옵션) ProductList                                               */
/* ------------------------------------------------------------------ */
interface ShipmentProductCardProductListProps {
  children: React.ReactNode
  className?: string
}

export const ShipmentProductCardProductList = ({
  children,
  className,
  ...rest
}: ShipmentProductCardProductListProps) => (
  <ul
    className={["flex flex-col gap-1", className].filter(Boolean).join(" ")}
    {...rest}
  >
    {children}
  </ul>
)

/* ------------------------------------------------------------------ */
/* 5. Root                                                             */
/* ------------------------------------------------------------------ */
interface ShipmentProductCardRootProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}
export const ShipmentProductCardRoot = forwardRef<
  HTMLDivElement,
  ShipmentProductCardRootProps
>(({ children, className, ...rest }, ref) => (
  <div
    ref={ref}
    className={["flex w-full items-center gap-[17px] bg-transparent", className]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {children}
  </div>
))
