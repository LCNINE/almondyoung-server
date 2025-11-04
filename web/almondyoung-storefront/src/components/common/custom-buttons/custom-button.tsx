import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@lib/utils"
import { Spinner } from "../spinner"

/**
 * CustomButton - 모든 버튼 타입을 하나의 컴포넌트로 처리
 * 
 * @example
 * // 기본 버튼
 * <CustomButton variant="primary">클릭</CustomButton>
 * 
 * @example
 * // Submit 버튼 (로딩 상태 포함)
 * <CustomButton variant="primary" isLoading={isSubmitting} type="submit">
 *   제출하기
 * </CustomButton>
 * 
 * @example
 * // 아이콘 버튼
 * <CustomButton variant="ghost" size="icon">
 *   <ChevronRight className="w-5 h-5" />
 * </CustomButton>
 * 
 * @example
 * // 아이콘 + 텍스트 버튼
 * <CustomButton variant="outline" size="lg">
 *   <ShoppingCart className="w-4 h-4" />
 *   장바구니
 * </CustomButton>
 */

const CustomButtonVariants = cva(
  "ay-btn-base",
  {
    variants: {
      variant: {
        primary: "ay-btn-primary",
        destructive: "ay-btn-destructive",
        outline: "ay-btn-outline",
        secondary: "ay-btn-secondary",
        ghost: "ay-btn-ghost",
        link: "ay-btn-link",
      },
      size: {
        default: "ay-btn-size-md",
        sm: "ay-btn-size-sm",
        lg: "ay-btn-size-lg",
        icon: "ay-btn-size-icon",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

interface CustomButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof CustomButtonVariants> {
  asChild?: boolean
  fullWidth?: boolean
  isLoading?: boolean
}

function CustomButton({
  className,
  variant,
  size,
  asChild = false,
  fullWidth = false,
  isLoading = false,
  disabled,
  children,
  ...props
}: CustomButtonProps) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(CustomButtonVariants({ variant, size }), fullWidth && "w-full", className)}
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

export { CustomButton, CustomButtonVariants }
