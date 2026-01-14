import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@lib/utils"
import { Spinner } from "../spinner" // Spinner 컴포넌트

/**
 * 1. CVA를 사용한 버튼 스타일 정의
 */
const buttonVariants = cva(
  // [Base] 기본 스타일
  `
    inline-flex items-center justify-center gap-2 whitespace-nowrap 
    font-medium transition-all 
    disabled:pointer-events-none disabled:opacity-50 
    [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 
    outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] 
    aria-invalid:ring-destructive/20 aria-invalid:border-destructive
  `, // (수정) 'rounded-md'를 base에서 제거
  {
    variants: {
      // [Variant] 버튼의 '스타일'
      variant: {
        fill: "shadow-xs border border-transparent",
        outline: "border",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "underline-offset-4 underline hover:underline",
      },
      // [Color] 버튼의 '색상 팔레트'
      color: {
        primary: "",
        destructive: "",
        secondary: "",
      },
      // [Size] 버튼의 '크기'
      size: {
        xs: "h-[27px] px-2.5 text-xs",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5 text-sm", // 'rounded-md' 제거
        md: "h-9 px-4 py-2 has-[>svg]:px-3 text-xs",
        lg: "h-11 px-6 has-[>svg]:px-4 text-sm", // 'rounded-md' 제거
        icon: "size-9",
      },
      // [FullWidth]
      fullWidth: {
        true: "w-full",
      },
      // [Rounded] (신규 추가) 버튼의 'border-radius'
      rounded: {
        none: "rounded-none",
        sm: "rounded-sm",
        md: "rounded-md",
        lg: "rounded-lg",
        full: "rounded-full",
      },
    },
    // [Compound Variants]
    compoundVariants: [
      // (기존 'size' variant에 있던 'rounded-md'를 제거했으므로)
      // (여기서는 'rounded' prop이 'size'에 종속되지 않아 수정할 필요 없음)

      // ... (fill, outline, link 조합은 그대로) ...
      {
        variant: "fill",
        color: "primary",
        className: "bg-primary text-primary-foreground hover:bg-yellow-40",
      },
      {
        variant: "fill",
        color: "destructive",
        className:
          "bg-destructive text-white hover:bg-red-40 hover:border-yellow-20 disabled:bg-transparent disabled:text-muted-foreground disabled:shadow-none",
      },
      {
        variant: "fill",
        color: "secondary",
        className:
          "bg-background text-secondary-foreground border-border hover:bg-secondary/80 disabled:border-muted disabled:text-muted-foreground active:bg-yellow-10",
      },
      {
        variant: "outline",
        color: "primary",
        className:
          "border-primary text-primary hover:border-yellow-40 hover:bg-yellow-10 active:bg-yellow-10 active:text-yellow-30 active:border-yellow-30 disabled:text-muted-foreground disabled:border-muted",
      },
      {
        variant: "outline",
        color: "secondary",
        className:
          "bg-white text-gray-900 border-zinc-400 hover:bg-gray-100 disabled:border-muted disabled:text-muted-foreground active:bg-yellow-10",
        // (수정) "hover:bg-secondary/10" -> "hover:bg-gray-100"
      },
      {
        variant: "link",
        color: "primary",
        className:
          "text-primary hover:text-yellow-40 disabled:text-muted-foreground disabled:no-underline",
      },
    ],
    // [Default] 기본값
    defaultVariants: {
      variant: "fill",
      color: "primary",
      size: "md",
      rounded: "md", // (신규 추가) 기본 'rounded' 값을 'md'로 설정
    },
  }
)

/**
 * 2. CVA 타입을 컴포넌트 Props로 사용
 */
interface CustomButtonProps
  extends
    Omit<React.ComponentProps<"button">, "color">,
    VariantProps<typeof buttonVariants> {
  // 'rounded'가 자동으로 포함됨
  asChild?: boolean
  isLoading?: boolean
  spinnerColor?: "blue" | "gray" | "white"
}

/**
 * 3. CVA를 적용한 CustomButton 컴포넌트
 */
function CustomButton({
  className,
  variant,
  color,
  size,
  fullWidth,
  rounded,
  asChild = false,
  isLoading = false,
  disabled,
  spinnerColor = "white",
  children,
  ...props
}: CustomButtonProps) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(
        buttonVariants({ variant, color, size, fullWidth, rounded, className }) // (수정) 'rounded' prop 전달
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <Spinner size="sm" color={spinnerColor} />
          {children}
        </span>
      ) : (
        children
      )}
    </Comp>
  )
}

export { buttonVariants, CustomButton }
