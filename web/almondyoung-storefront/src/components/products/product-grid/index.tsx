import { ProductCard } from "@/components/products/prodcut-card"
import { cn } from "@/lib/utils"
import type { ProductCardProps } from "@/lib/types/ui/product"

interface ProductGridProps {
  products: ProductCardProps[]
  showRank: boolean
  className?: string
  roundedClassName?: string
}

export function ProductGrid({
  products,
  showRank = false,
  className,
  roundedClassName,
}: ProductGridProps) {
  return (
    <div
      className={cn(
        "grid-cols-3 gap-x-3 gap-y-8 md:grid md:grid-cols-4 lg:grid-cols-5",
        className
      )}
    >
      {products.map((product, index) => {
        const rank = showRank ? index + 1 : undefined
        return (
          <ProductCard key={product.id}>
            <ProductCard.Thumbnail
              src={product.imageSrc}
              alt={product.title}
              rank={rank && <ProductCard.Rank rank={rank} />}
              className={roundedClassName}
            />
            <ProductCard.Info {...product} />
          </ProductCard>
        )
      })}
    </div>
  )
}
