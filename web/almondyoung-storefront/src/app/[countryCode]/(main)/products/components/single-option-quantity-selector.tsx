"use client"

import { useRef } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SingleOptionQuantitySelectorProps {
  productName: string
  quantity: number
  onQuantityChange: (quantity: number) => void
  price: number
  stock: number | null // null = 재고 관리 안 함
  className?: string
  showTitle?: boolean
}

export const SingleOptionQuantitySelector = ({
  productName,
  quantity,
  onQuantityChange,
  price,
  stock,
  className = "",
  showTitle = false,
}: SingleOptionQuantitySelectorProps) => {
  const inputRef = useRef<HTMLInputElement>(null)

  const getStockText = () => {
    if (stock === null) return null // 재고 관리 안 함
    if (stock === 0) return "품절"
    if (stock < 5) return `재고 ${stock}개`
    return `재고 ${stock}개`
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === "") {
      return
    }
    const val = parseInt(raw, 10)
    if (!isNaN(val)) {
      onQuantityChange(val)
    }
  }

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    if (isNaN(val) || val < 1) {
      onQuantityChange(1)
    }
  }

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select()
  }

  const handleDirectInputClick = () => {
    inputRef.current?.focus()
  }

  return (
    <div className={className}>
      {showTitle && <div className="mb-3 text-base font-bold">수량 선택</div>}
      <div className="flex items-center gap-3 rounded-lg bg-white py-3">
        <div className="flex-1">
          <p className="text-sm font-medium">{productName}</p>
          {getStockText() && (
            <div className="mt-1 text-xs text-gray-500">{getStockText()}</div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
                className="flex h-8 w-8 items-center justify-center rounded border"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                value={quantity}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onFocus={handleInputFocus}
                className="h-8 w-12 rounded border text-center outline-none"
              />
              <button
                onClick={() => onQuantityChange(quantity + 1)}
                className="flex h-8 w-8 items-center justify-center rounded border"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <Button
              variant="outline"
              onClick={handleDirectInputClick}
              className="h-8 px-3 text-xs text-gray-600"
            >
              직접입력
            </Button>
          </div>
        </div>
        <div className="text-right">
          <p className="font-medium">{(price * quantity).toLocaleString()}원</p>
        </div>
      </div>
    </div>
  )
}
