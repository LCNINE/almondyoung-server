"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import { ProductGrid } from "@/components/products/product-grid"
import type { ProductCardProps } from "@/lib/types/ui/product"
import { useParams } from "next/navigation"
import Link from "next/link"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"
import { useUser } from "@/contexts/user-context"

interface WelcomeDealSectionProps {
  products: ProductCardProps[]
}

export function WelcomeDealSection({ products }: WelcomeDealSectionProps) {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const { user } = useUser()
  const isLoggedIn = !!user

  return (
    <div className="w-full">
      <SectionHeader className="mb-6 justify-between md:justify-start">
        <SectionHeader.Title>
          <span>웰컴딜 전체 제품 100원</span>
        </SectionHeader.Title>
        <SectionHeader.More showOnDesktop={true} href="/welcome-deal" />
      </SectionHeader>

      {/* mobile */}
      <div className="md:hidden">
        <ProductCarousel
          opts={{ align: "start", containScroll: "trimSnaps" }}
          className="md:hidden"
        >
          <ProductCarousel.List className="ml-0">
            {products.map((product) => {
              const isSoldOut =
                product.manageInventory && product.available <= 0
              return (
                <ProductCarousel.Item
                  key={product.id}
                  className="basis-[42%] pl-0"
                >
                  <Link
                    href={`/${countryCode}/products/${product.id}`}
                    className="block"
                  >
                    <ProductCard className="border-r-[0.5px] border-r-gray-100 pr-4 last:border-r-0">
                      <ProductCard.Thumbnail
                        src={product.imageSrc}
                        alt={product.title}
                        isSoldOut={isSoldOut}
                        action={
                          !isSoldOut ? (
                            <ProductCard.QuickActions
                              productId={product.id}
                              variantId={product.optionMeta?.defaultVariantId}
                              isSingleOption={
                                product.optionMeta?.isSingle ?? false
                              }
                              isLoggedIn={isLoggedIn}
                              countryCode={countryCode}
                            />
                          ) : undefined
                        }
                        className="rounded-sm md:rounded-md"
                      />
                      <ProductCard.Info {...product} />
                    </ProductCard>
                  </Link>
                </ProductCarousel.Item>
              )
            })}
          </ProductCarousel.List>

          <ProductCarousel.Indicator itemsPerGroup={3} />
        </ProductCarousel>
      </div>

      {/* desktop */}
      <div className="hidden md:block">
        <ProductGrid
          products={products.slice(0, 5)}
          showRank={false}
          showQuickActions
          thumbnailClassName="rounded-sm md:rounded-md"
          countryCode={countryCode}
          isLoggedIn={isLoggedIn}
        />
      </div>
    </div>
  )
}
