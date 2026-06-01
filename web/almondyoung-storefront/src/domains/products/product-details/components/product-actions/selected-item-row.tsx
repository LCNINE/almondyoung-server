import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"
import { X } from "lucide-react"
import ProductPrice from "../product-price"
import QuantityStepper from "./quantity-stepper"
import { SelectedItem } from "./types"

// desktop(md) / mobile(sm) 레이아웃 차이만 여기서
const SIZE_STYLES = {
  md: {
    container: "gap-4 px-4 py-3",
    leftCol: "gap-2",
    label: "text-sm font-medium",
    right: "items-start",
  },
  sm: {
    container: "px-3 py-2",
    leftCol: "gap-1",
    label: "text-sm",
    right: "items-center",
  },
} as const

type SelectedItemRowProps = {
  item: SelectedItem
  product: HttpTypes.StoreProduct
  size?: "sm" | "md"
  showLabel?: boolean
  showRemove?: boolean
  incrementDisabled?: boolean
  directInputDisabled?: boolean
  onDecrement: () => void
  onIncrement: () => void
  onQuantityChange: (next: number) => void
  onInvalidBlur: () => void
  onEmptyInput?: () => void
  onRemove: () => void
}

export default function SelectedItemRow({
  item,
  product,
  size = "md",
  showLabel = true,
  showRemove = true,
  incrementDisabled,
  directInputDisabled,
  onDecrement,
  onIncrement,
  onQuantityChange,
  onInvalidBlur,
  onEmptyInput,
  onRemove,
}: SelectedItemRowProps) {
  const s = SIZE_STYLES[size]

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg",
        s.container
      )}
    >
      <div className={cn("flex flex-col", s.leftCol)}>
        {showLabel && <span className={s.label}>{item.label}</span>}

        <QuantityStepper
          quantity={item.quantity}
          size={size}
          onDecrement={onDecrement}
          onIncrement={onIncrement}
          onQuantityChange={onQuantityChange}
          onInvalidBlur={onInvalidBlur}
          onEmptyInput={onEmptyInput}
          incrementDisabled={incrementDisabled}
          directInputDisabled={directInputDisabled}
        />
      </div>

      <div className={cn("flex gap-2", s.right)}>
        <ProductPrice
          product={product}
          variant={item.variant}
          quantity={item.quantity}
        />

        {showRemove && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-6 w-6 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
