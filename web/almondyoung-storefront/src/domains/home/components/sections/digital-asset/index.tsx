"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import type { ProductCardProps } from "@/lib/types/ui/product"
import { isProductSoldOut } from "@/lib/utils"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ProductGrid } from "../../../../../components/products/product-grid"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"

interface DigitalAssetSectionProps {
  products: ProductCardProps[]
}

export function DigitalAssetSection({ products }: DigitalAssetSectionProps) {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"

  return (
    <div className="w-full">
      <SectionHeader className="mb-6 justify-between md:justify-start">
        <SectionHeader.Title>
          <span>간단편집, 뷰티샵 디지털 템플릿</span>
        </SectionHeader.Title>
        <SectionHeader.More showOnDesktop={true} href={`/category/time-sale`} />
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
                      href={`/${countryCode}/products/${product.id}`}
                      className="block"
                    >
                      <ProductCard className="border-r-[0.5px] border-r-gray-100 pr-4 last:border-r-0">
                        <ProductCard.Thumbnail
                          src={product.imageSrc}
                          alt={product.title}
                          isSoldOut={isSoldOut}
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
            thumbnailClassName="rounded-sm md:rounded-md"
            countryCode={countryCode}
          />
        </div>
      </div>
    </div>
  )
}
