import { ButtonHTMLAttributes, ReactNode } from "react"

/**
 * 버튼 variant 타입 (색상 기준)
 */
export type ButtonVariant = "orange" | "gray"

/**
 * 버튼 appearance 타입 (스타일 형태)
 * - filled: 배경 채움
 * - outline: 테두리만
 */
export type ButtonAppearance = "filled" | "outline"

/**
 * 버튼 size 타입 (높이 기준)
 * - xs: h-[27px] (장바구니 담기)
 * - sm: h-9 (36px)
 * - md: h-[38px]
 * - lg: py-3 (custom)
 */
export type ButtonSize = "xs" | "sm" | "md" | "lg"

/**
 * 반응형 size 타입
 * - base: 모바일 기본 크기
 * - lg: 데스크탑 크기 (optional)
 */
export type ResponsiveSize = {
  base: ButtonSize
  lg?: ButtonSize
}

interface CommonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  appearance?: ButtonAppearance
  size?: ButtonSize | ResponsiveSize
  /** 커스텀 높이 (px 단위) - 지정하면 size보다 우선 적용 */
  height?: number
  fullWidth?: boolean
  children: ReactNode
}

/**
 * CommonButton - 공통 버튼 컴포넌트
 *
 * @example
 * // 고정 크기
 * <CommonButton size="lg">배송 조회</CommonButton>
 *
 * // 반응형 크기
 * <CommonButton size={{ base: "sm", lg: "md" }}>배송 조회</CommonButton>
 *
 * // 커스텀 높이
 * <CommonButton height={50}>배송 조회</CommonButton>
 */
const CommonButton = ({
  variant = "orange",
  appearance = "filled",
  size = "md",
  height,
  fullWidth = false,
  disabled = false,
  className = "",
  children,
  ...props
}: CommonButtonProps) => {
  // ===== Appearance + Variant 조합 스타일 =====
  const getVariantStyles = (): string => {
    if (appearance === "filled") {
      const filledStyles = {
        orange: disabled
          ? "bg-[#ffa500]/40 text-white border-0"
          : "bg-[#f29219] text-white border-0 font-semibold hover:bg-[#d67e15] active:bg-[#c97113]",
        gray: disabled
          ? "bg-gray-300 text-gray-500 border-0"
          : "bg-gray-600 text-white border-0 hover:bg-gray-700 active:bg-gray-800",
      }
      return filledStyles[variant]
    }

    const outlineStyles = {
      orange: disabled
        ? "bg-white border border-amber-300 text-amber-300"
        : "bg-white border border-amber-500 text-amber-500 hover:bg-amber-50 active:bg-amber-100",
      gray: disabled
        ? "bg-white border border-zinc-300 text-gray-400"
        : "bg-white border border-zinc-400 text-gray-900 hover:bg-gray-50 active:bg-gray-100",
    }
    return outlineStyles[variant]
  }

  // ===== Size 스타일 처리 =====
  const baseSizeStyles: Record<ButtonSize, string> = {
    xs: "h-[27px] px-2.5 py-2.5 text-xs",
    sm: "h-9 px-4 py-2.5 text-sm",
    md: "h-[38px] px-4 py-2.5 text-xs",
    lg: "h-[40px] px-4 py-3 text-sm", // h-auto → h-11 (44px 고정)
  }

  const lgSizeStyles: Record<ButtonSize, string> = {
    xs: "lg:h-[27px] lg:px-2.5 lg:py-2.5 lg:text-xs",
    sm: "lg:h-9 lg:px-4 lg:py-2.5 lg:text-sm",
    md: "lg:h-[38px] lg:px-4 lg:py-2.5 lg:text-xs",
    lg: "lg:h-[40px] lg:px-4 lg:py-3 lg:text-sm", // lg:h-auto → lg:h-11
  }

  // size 처리 - 문자열이면 고정, 객체면 반응형
  const getSizeClasses = (): string => {
    // 0. 커스텀 높이가 지정되면 우선 적용
    if (height !== undefined) {
      return `h-[${height}px] px-4 py-2.5 text-sm`
    }

    // 1. 문자열 = 고정 크기
    if (typeof size === "string") {
      return baseSizeStyles[size]
    }

    // 2. 객체 = 반응형 크기
    const baseClass = baseSizeStyles[size.base]
    const lgClass = size.lg ? lgSizeStyles[size.lg] : ""
    return `${baseClass} ${lgClass}`.trim()
  }

  // ===== Width 스타일 =====
  const widthStyle = fullWidth ? "w-full" : ""

  // ===== 조합 =====
  const combinedClassName = `
    flex items-center justify-center
    rounded-[5px]
    leading-none
    transition-colors
    disabled:cursor-not-allowed
    ${getVariantStyles()}
    ${getSizeClasses()}
    ${widthStyle}
    ${className}
  `
    .trim()
    .replace(/\s+/g, " ")

  return (
    <button
      type="button"
      disabled={disabled}
      className={combinedClassName}
      {...props}
    >
      {children}
    </button>
  )
}

export default CommonButton
