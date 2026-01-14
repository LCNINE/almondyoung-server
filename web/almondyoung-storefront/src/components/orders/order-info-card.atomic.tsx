/* OrderInfoCard.tsx ------------------------------------------------- */
import React from "react"
import {
  RoundedBaseCard,
  type RoundedBaseCardProps,
} from "../shared/components/base-rounded-card"

/* ---------------- Root & Divider ---------------------------------- */
export const OrderInfoCardRoot = (props: RoundedBaseCardProps) => (
  <RoundedBaseCard {...props} />
)

interface OrderInfoCardTitleProps {
  children: React.ReactNode
  className?: string
}

export const OrderInfoCardTitle = ({
  children,
  className,
}: OrderInfoCardTitleProps) => (
  <h3
    className={["mb-[9px] text-sm leading-snug font-bold", className]
      .filter(Boolean)
      .join(" ")}
  >
    {children}
  </h3>
)

export const OrderInfoCardDivider = () => (
  <hr className="my-4 border-gray-200" />
)

/* ---------------- Row Components ---------------------------------- */
export interface RowItemProps extends React.HTMLAttributes<HTMLSpanElement> {
  bold?: boolean
  align?: "left" | "right"
}

export const OrderInfoCardRowItem = ({
  bold,
  align = "left",
  className,
  children,
  ...rest
}: RowItemProps) => (
  <span
    className={[
      "text-sm",
      bold ? "font-medium" : "",
      align === "right" ? "text-right" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {children}
  </span>
)

interface OrderInfoCardRowProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "between" | "gap"
  gap?: number
}

export const OrderInfoCardRow = ({
  children,
  className,
  variant = "between",
  gap = 52,
  ...rest
}: OrderInfoCardRowProps) => {
  const count = React.Children.toArray(children).length
  const isGap = variant === "gap" && count === 2

  return (
    <div
      className={[
        "mb-[9px] flex",
        isGap ? "" : count >= 2 ? "justify-between" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={isGap ? { gap: `${gap}px` } : undefined}
      {...rest}
    >
      {children}
    </div>
  )
}

/* ---------------- Empty (공통) ------------------------------------ */
interface OrderInfoCardEmptyProps {
  label?: string
}

export const OrderInfoCardEmpty = ({
  label = "+ 새 정보 입력",
}: OrderInfoCardEmptyProps) => (
  <OrderInfoCardRoot>
    <div className="flex h-28 items-center justify-center text-sm text-gray-400">
      {label}
    </div>
  </OrderInfoCardRoot>
)
