import { cn } from "@lib/utils"
import { ProductThumbnail } from "./parts/product-thumbnail"
import { ProductInfo } from "./parts/product-info"
import { ProductRank } from "./parts/product-rank"

interface ProductCardProps {
  children: React.ReactNode
  className?: string
}

export function ProductCard({ children, className }: ProductCardProps) {
  return (
    <div
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2",
        className
      )}
    >
      {children}
    </div>
  )
}

ProductCard.Thumbnail = ProductThumbnail
ProductCard.Info = ProductInfo
ProductCard.Rank = ProductRank
