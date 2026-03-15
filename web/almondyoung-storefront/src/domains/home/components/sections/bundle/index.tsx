"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import type { ProductCardProps } from "@/lib/types/ui/product"
import { isProductSoldOut } from "@/lib/utils/is-product-sold-out"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ProductGrid } from "../../../../../components/products/product-grid"
import { SectionHeader } from "../../header"
import { ProductCarousel } from "../../shared/product-carousel"
import { useUser } from "@/contexts/user-context"

interface BundleSectionProps {
  products: ProductCardProps[]
}

export function BundleSection({ products }: BundleSectionProps) {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const { user } = useUser()
  const isLoggedIn = !!user

  return (
    <div className="w-full">
      <SectionHeader className="mb-6 justify-between md:justify-start">
        <SectionHeader.Title>
          <span>묶고 더블로 가!</span>
        </SectionHeader.Title>
        <SectionHeader.More
          showOnDesktop={true}
          href={`/category/bulk-discount`}
        />
      </SectionHeader>

      <div className="flex w-full flex-col gap-1.5">
        {/* mobile */}
        <div className="md:hidden">
          <ProductCarousel
            opts={{ align: "start", containScroll: "trimSnaps" }}
            className="md:hidden"
          >
            <ProductCarousel.List className="ml-0">
              {products.map((product) => {
                const isSoldOut = isProductSoldOut(product)
                return (
                  <ProductCarousel.Item
                    key={product.id}
                    className="basis-[42%] pl-0"
                  >
                    <Link
                      href={`/${countryCode}/products/${product.handle}`}
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
                                productHandle={product.handle}
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
    </div>
  )
}
