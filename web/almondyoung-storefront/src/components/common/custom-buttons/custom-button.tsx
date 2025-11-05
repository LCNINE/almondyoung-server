import { Slot } from "@radix-ui/react-slot"
import * as React from "react"

import { cn } from "@lib/utils"
import { Spinner } from "../spinner" // Spinner 컴포넌트가 있다고 가정

/**
 * Variant 타입: CustomButton 기준
 */
type ButtonVariant =
  | "primary"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link"

/**
 * Size 타입: CommonButton 기준 + 'icon'
 */
type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon"

interface CustomButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
  fullWidth?: boolean
  isLoading?: boolean
}

/**
 * CustomButton (CVA 대신 내부 로직으로 구현)
 * - Variant: CustomButton 기준
 * - Size/Text: CommonButton 기준 + 'icon'
 */
function CustomButton({
  className,
  variant = "primary",
  size = "md",
  asChild = false,
  fullWidth = false,
  isLoading = false,
  disabled,
  children,
  ...props
}: CustomButtonProps) {
  const Comp = asChild ? Slot : "button"

  /**
   * .ay-btn-base에 해당하는 기본 스타일
   */
  const baseStyles = `
    inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md 
    font-medium transition-all 
    disabled:pointer-events-none disabled:opacity-50 
    [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 
    outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] 
    aria-invalid:ring-destructive/20 aria-invalid:border-destructive
  `

  /**
   * Variant별 스타일 반환 (CSS @apply 내용을 내장)
   */
  const getVariantStyles = (): string => {
    switch (variant) {
      case "primary":
        return "bg-primary text-primary-foreground shadow-xs border border-transparent hover:bg-yellow-40"
      case "outline":
        return "border border-primary text-primary hover:border-yellow-40 hover:bg-yellow-10 active:bg-yellow-10 active:text-yellow-30 active:border-yellow-30 disabled:text-muted-foreground disabled:border-muted"
      case "destructive":
        return "bg-destructive text-white shadow-xs hover:bg-red-40 border border-transparent hover:border-yellow-20 disabled:bg-transparent disabled:text-muted-foreground disabled:shadow-none"
      case "secondary":
        return "bg-background text-secondary-foreground border border-border hover:bg-secondary/80 disabled:border-muted disabled:text-muted-foreground active:bg-yellow-10"
      case "ghost":
        return "hover:bg-accent hover:text-accent-foreground"
      case "link":
        return "text-primary underline-offset-4 underline hover:underline hover:text-yellow-40 disabled:text-muted-foreground disabled:no-underline"
      default:
        return ""
    }
  }

  /**
   * Size별 스타일 반환 (CommonButton 기준 + 'icon')
   * 텍스트 크기(text-xs, text-sm)를 여기서 명시
   */
  const getSizeStyles = (): string => {
    switch (size) {
      // 1. (신규) CommonButton의 'xs'
      case "xs":
        return "h-[27px] px-2.5 text-xs"

      // 2. CustomButton 'sm' shape + CommonButton 'sm' text
      case "sm":
        return "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 text-sm"

      // 3. (신규) CustomButton 'md' shape + CommonButton 'md' text
      case "md":
        return "h-9 px-4 py-2 has-[>svg]:px-3 text-xs"

      // 4. CustomButton 'lg' shape + CommonButton 'lg' text
      case "lg":
        return "h-11 rounded-md px-6 has-[>svg]:px-4 text-sm"

      // 5. CustomButton 'icon'
      case "icon":
        return "size-9" // text-size 불필요

      default:
        return "h-9 px-4 py-2 has-[>svg]:px-3 text-xs" // 기본 'md'
    }
  }
  /**
   * 로딩 스피너 색상 결정
   * 배경이 있는 버튼(primary, destructive)은 'white', 나머지는 'currentColor'
   */
  const spinnerColor =
    variant === "primary" || variant === "destructive"
      ? "white"
      : "currentColor"

  // 모든 클래스를 cn으로 조합
  const combinedClassName = cn(
    baseStyles.trim().replace(/\s+/g, " "), // 기본 스타일
    getVariantStyles(), // Variant 스타일
    getSizeStyles(), // Size 스타일
    fullWidth && "w-full", // Full width
    className // 사용자가 추가한 클래스
  )

  return (
    <Comp
      data-slot="button"
      className={combinedClassName}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <Spinner size="sm" color="white" />
          {children}
        </span>
      ) : (
        children
      )}
    </Comp>
  )
}

export { CustomButton }
