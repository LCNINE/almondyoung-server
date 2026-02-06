import { ProductCard } from "@/components/products/prodcut-card"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { ProductCardProps } from "@/lib/types/ui/product"

interface ProductGridProps {
  products: ProductCardProps[]
  showRank?: boolean
  showQuickActions?: boolean
  className?: string
  thumbnailClassName?: string
  countryCode?: string
  isLoggedIn?: boolean
}

export function ProductGrid({
  products,
  showRank = false,
  showQuickActions = false,
  className,
  thumbnailClassName,
  countryCode,
  isLoggedIn = false,
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
              className={thumbnailClassName}
              src={product.imageSrc}
              alt={product.title}
              rank={rank && <ProductCard.Rank rank={rank} />}
              action={
                showQuickActions ? (
                  <ProductCard.QuickActions
                    productId={product.id}
                    variantId={product.optionMeta?.defaultVariantId}
                    isSingleOption={product.optionMeta?.isSingle ?? false}
                    isLoggedIn={isLoggedIn}
                    countryCode={countryCode}
                  />
                ) : undefined
              }
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
