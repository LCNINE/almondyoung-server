import { ProductCard } from "@/components/products/prodcut-card"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { ProductCardProps } from "@/lib/types/ui/product"

interface ProductGridProps {
  products: ProductCardProps[]
  showRank: boolean
  className?: string
  roundedClassName?: string
  countryCode?: string
}

export function ProductGrid({
  products,
  showRank = false,
  className,
  roundedClassName,
  countryCode,
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
        const card = (
          <ProductCard>
            <ProductCard.Thumbnail
              src={product.imageSrc}
              alt={product.title}
              rank={rank && <ProductCard.Rank rank={rank} />}
              className={roundedClassName}
            />
            <ProductCard.Info {...product} />
          </ProductCard>
        )

        return countryCode ? (
          <Link
            key={product.id}
            href={`/${countryCode}/products/${product.id}`}
            className="block"
          >
            {card}
          </Link>
        ) : (
          <div key={product.id}>{card}</div>
        )
      })}
    </div>
  )
}
