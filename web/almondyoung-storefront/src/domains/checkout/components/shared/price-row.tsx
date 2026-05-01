import { cn } from "@/lib/utils"
import {
  createElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react"

type Size = "xs" | "sm" | "base" | "lg"
type LabelTone = "default" | "muted" | "sub" | "membership" | "accent"
type ValueTone = "default" | "muted" | "membership" | "discount"
type Weight = "normal" | "medium" | "semibold" | "bold"
type Highlight = "none" | "beige"

const sizeClass: Record<Size, string> = {
  xs: "text-[10px] lg:text-xs",
  sm: "text-xs lg:text-sm",
  base: "text-sm lg:text-base",
  lg: "text-base lg:text-lg",
}

const weightClass: Record<Weight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
}

const labelToneClass: Record<LabelTone, string> = {
  default: "text-gray-900",
  muted: "text-gray-600",
  sub: "text-gray-400",
  membership: "text-[#E08F00]",
  accent: "text-[#F29219]",
}

const valueToneClass: Record<ValueTone, string> = {
  default: "text-gray-900",
  muted: "text-gray-600",
  membership: "text-[#E08F00]",
  discount: "text-[#F29219]",
}

const highlightClass: Record<Highlight, string> = {
  none: "",
  beige: "bg-[#FFF7E5]/50 px-4 py-4 lg:px-6",
}

interface PriceRowProps extends HTMLAttributes<HTMLDivElement> {
  highlight?: Highlight
  children: ReactNode
}

interface PriceRowLabelProps extends HTMLAttributes<HTMLElement> {
  as?: "span" | "p"
  size?: Size
  tone?: LabelTone
  weight?: Weight
  children: ReactNode
}

interface PriceRowValueProps extends HTMLAttributes<HTMLElement> {
  as?: "span" | "p"
  size?: Size
  tone?: ValueTone
  weight?: Weight
  children: ReactNode
}

function PriceRowRoot({
  highlight = "none",
  className,
  children,
  ...rest
}: PriceRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        highlightClass[highlight],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

function PriceRowLabel({
  as = "span",
  size = "sm",
  tone = "default",
  weight = "normal",
  className,
  children,
  ...rest
}: PriceRowLabelProps): ReactElement {
  return createElement(
    as,
    {
      className: cn(
        sizeClass[size],
        labelToneClass[tone],
        weightClass[weight],
        className
      ),
      ...rest,
    },
    children
  )
}

function PriceRowValue({
  as = "span",
  size = "sm",
  tone = "default",
  weight = "normal",
  className,
  children,
  ...rest
}: PriceRowValueProps): ReactElement {
  return createElement(
    as,
    {
      className: cn(
        sizeClass[size],
        valueToneClass[tone],
        weightClass[weight],
        className
      ),
      ...rest,
    },
    children
  )
}

export const PriceRow = Object.assign(PriceRowRoot, {
  Label: PriceRowLabel,
  Value: PriceRowValue,
})
