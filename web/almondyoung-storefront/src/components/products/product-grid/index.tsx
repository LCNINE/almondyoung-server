import { ProductCard } from "@/components/products/prodcut-card"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { ProductCardProps } from "@/lib/types/ui/product"

interface ProductGridProps {
  products: ProductCardProps[]
  showRank?: boolean
  showQuickActions?: boolean
  className?: string
  roundedClassName?: string
  countryCode?: string
  isLoggedIn?: boolean
}

export function ProductGrid({
  products,
  showRank = false,
  showQuickActions = false,
  className,
  roundedClassName,
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
              src={product.imageSrc}
              alt={product.title}
              rank={rank && <ProductCard.Rank rank={rank} />}
              action={
                showQuickActions && (product as any).optionMeta ? (
                  <ProductCard.QuickActions
                    productId={product.id}
                    variantId={(product as any).optionMeta?.defaultVariantId}
                    isSingleOption={(product as any).optionMeta?.isSingle ?? false}
                    isWishlisted={(product as any).userMeta?.isWishlisted ?? false}
                    isLoggedIn={isLoggedIn}
                    countryCode={countryCode}
                  />
                ) : undefined
              }
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
