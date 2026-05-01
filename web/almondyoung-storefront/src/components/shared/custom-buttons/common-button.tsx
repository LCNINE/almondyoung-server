import { ButtonHTMLAttributes, ReactNode } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@lib/utils" // CustomButton에서 사용하는 cn 유틸리티를 가져옵니다.

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

// 1. CVA 정의: variant와 appearance의 조합을 선언적으로 관리합니다.
const commonButtonVariants = cva(
  // 기본 스타일
  "flex items-center justify-center rounded-[5px] leading-none transition-colors disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        orange: "", // 기본 variant는 compoundVariants에서 처리
        gray: "",
      },
      appearance: {
        filled: "",
        outline: "",
      },
    },
    // 2. 조합 스타일: hover, active, disabled 상태를 여기서 모두 처리
    compoundVariants: [
      // Orange Filled
      {
        variant: "orange",
        appearance: "filled",
        className:
          "bg-[#f29219] text-white border-0 font-semibold hover:bg-[#d67e15] active:bg-[#c97113] disabled:bg-[#ffa500]/40",
      },
      // Gray Filled
      {
        variant: "gray",
        appearance: "filled",
        className:
          "bg-gray-600 text-white border-0 hover:bg-gray-700 active:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500",
      },
      // Orange Outline
      {
        variant: "orange",
        appearance: "outline",
        className:
          "bg-white border border-amber-500 text-amber-500 hover:bg-amber-50 active:bg-amber-100 disabled:border-amber-300 disabled:text-amber-300",
      },
      // Gray Outline
      {
        variant: "orange",
        appearance: "outline",
        className:
          "bg-white border border-zinc-400 text-gray-900 hover:bg-gray-50 active:bg-gray-100 disabled:border-zinc-300 disabled:text-gray-400",
      },
    ],
    defaultVariants: {
      variant: "orange",
      appearance: "filled",
    },
  }
)

// 3. Props 인터페이스: CVA의 VariantProps를 상속
interface CommonButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof commonButtonVariants> {
  size?: ButtonSize | ResponsiveSize
  /** 커스텀 높이 (px 단위) - 지정하면 size보다 우선 적용 */
  height?: number
  fullWidth?: boolean
  children: ReactNode
}

/**
 * CommonButton - 공통 버튼 컴포넌트 (CVA 적용)
 */
const CommonButton = ({
  variant, // cva가 기본값(orange) 처리
  appearance, // cva가 기본값(filled) 처리
  size = "md",
  height,
  fullWidth = false,
  disabled = false,
  className = "",
  children,
  ...props
}: CommonButtonProps) => {
  const sizeStyles: Record<ButtonSize, string> = {
    xs: "h-[27px] px-2.5 py-2.5 text-xs",
    sm: "h-9 px-4 py-2.5 text-sm",
    md: "h-[38px] px-4 py-2.5 text-xs",
    lg: "h-[44px] px-4 py-3 text-sm",
  }

  const getSizeClasses = (): string => {
    // 0. 커스텀 높이가 지정되면 우선 적용
    if (height !== undefined) {
      return `h-[${height}px] px-4 py-2.5 text-sm`
    }

    // 1. 문자열 = 고정 크기 (단일 객체 참조)
    if (typeof size === "string") {
      return sizeStyles[size]
    }

    // 2. 객체 = 반응형 크기
    const baseClass = sizeStyles[size.base]

    // 3. lg: 접두사를 동적으로 추가합니다.
    const lgClass = size.lg
      ? sizeStyles[size.lg] // "h-[38px] px-4 text-xs"
          .split(" ") // ["h-[38px]", "px-4", "text-xs"]
          .map((cls) => `lg:${cls}`) // ["lg:h-[38px]", "lg:px-4", "lg:text-xs"]
          .join(" ") // "lg:h-[38px] lg:px-4 lg:text-xs"
      : ""

    return `${baseClass} ${lgClass}`.trim()
  }

  // ===== 클래스 조합 (cn 유틸리티 사용) =====
  const combinedClassName = cn(
    commonButtonVariants({ variant, appearance }),
    getSizeClasses(), // 리팩토링된 함수 호출
    fullWidth && "w-full",
    className
  )

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
