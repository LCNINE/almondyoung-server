"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import { ProductGrid } from "@/components/products/product-grid"
import type { ProductCardProps } from "@/lib/types/ui/product"
import { useParams } from "next/navigation"
import Link from "next/link"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"

interface WelcomeDealSectionProps {
  products: ProductCardProps[]
}

export function WelcomeDealSection({ products }: WelcomeDealSectionProps) {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"

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
            {products.map((product) => (
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
                      className="rounded-sm md:rounded-md"
                    />
                    <ProductCard.Info {...product} />
                  </ProductCard>
                </Link>
              </ProductCarousel.Item>
            ))}
          </ProductCarousel.List>

          <ProductCarousel.Indicator itemsPerGroup={3} />
        </ProductCarousel>
      </div>

      {/* desktop */}
      <div className="hidden md:block">
        <ProductGrid
          products={products.slice(0, 5)}
          showRank={false}
          roundedClassName="rounded-sm md:rounded-md"
          countryCode={countryCode}
        />
      </div>
    </div>
  )
}
