import React from "react"

export interface RoundedBaseCardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** 테두리 색 변형 등을 위한 옵션 (선택) */
  variant?: "default" | "primary" | "danger"
}

export const RoundedBaseCard: React.FC<RoundedBaseCardProps> = ({
  variant = "default",
  className,
  children,
  ...rest
}) => (
  <div
    className={[
      "rounded-lg border bg-white px-[12px] py-[15px]",
      variant === "primary" && "border-primary-500",
      variant === "danger" && "border-red-500",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {children}
  </div>
)
