"use client"

import { Minus, Plus } from "lucide-react"
import Image from "next/image"

interface SingleOptionQuantitySelectorProps {
  productName: string
  thumbnail: string
  quantity: number
  onQuantityChange: (quantity: number) => void
  price: number
  stock: number
  className?: string
  showTitle?: boolean
}

export const SingleOptionQuantitySelector = ({
  productName,
  thumbnail,
  quantity,
  onQuantityChange,
  price,
  stock,
  className = "",
  showTitle = false,
}: SingleOptionQuantitySelectorProps) => {
  const getStockText = () => {
    if (stock === 0) return "품절"
    if (stock < 5) return `재고 ${stock}개`
    return `재고 ${stock}개`
  }

  return (
    <div className={className}>
      {showTitle && <div className="mb-3 text-base font-bold">수량 선택</div>}
      <div className="flex items-center gap-3 rounded-lg bg-white py-3">
        <Image
          className="h-20 w-20 rounded object-cover"
          src={thumbnail}
          alt={productName || "상품 이미지"}
          width={80}
          height={80}
        />
        <div className="flex-1">
          <p className="text-sm font-medium">{productName}</p>
          <div className="mt-1 text-xs text-gray-500">{getStockText()}</div>
          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
              className="flex h-8 w-8 items-center justify-center rounded border"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={quantity}
              readOnly
              className="h-8 w-12 rounded border text-center"
            />
            <button
              onClick={() => onQuantityChange(quantity + 1)}
              className="flex h-8 w-8 items-center justify-center rounded border"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="text-right">
          <p className="font-medium">{(price * quantity).toLocaleString()}원</p>
        </div>
      </div>
    </div>
  )
}
