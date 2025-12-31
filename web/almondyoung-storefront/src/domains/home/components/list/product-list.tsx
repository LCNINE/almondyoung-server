// product-list.tsx

import { cn } from "@lib/utils"
import { ProductCard } from "@lib/types/ui/product"
import React from "react"

interface ResponsiveProductListProps {
  products: ProductCard[]
  renderCard: (product: ProductCard, index: number) => React.ReactNode
  columns?: {
    mobile?: number
    tablet?: number
    desktop?: number
  }
  className?: string
  mobileItemClassName?: string // [추가] 모바일 아이템 스타일을 주입받을 prop
}

export default function ProductList({
  products,
  renderCard,
  columns = { mobile: 1, tablet: 3, desktop: 5 },
  className = "",
  mobileItemClassName = "w-[150px]", // [수정] 기본값은 기존 150px 유지 (하위 호환성)
}: ResponsiveProductListProps) {
  return (
    <div
      className={cn(
        "scrollbar-hide overflow-x-auto md:overflow-visible",
        className
      )}
    >
      <div
        className={cn(
          "flex gap-3",
          "md:grid md:gap-4",
          "lg:gap-6",
          columns.tablet === 3 && "md:grid-cols-3",
          columns.desktop === 5 && "lg:grid-cols-5"
        )}
      >
        {products.map((product, index) => (
          <div
            key={`${product.id}-${index}`}
            // [핵심 수정]
            // 하드코딩된 'w-[150px]' 대신 'mobileItemClassName' prop을 사용합니다.
            className={cn("shrink-0 md:w-auto", mobileItemClassName)}
          >
            {renderCard(product, index)}
          </div>
        ))}
      </div>
    </div>
  )
}
