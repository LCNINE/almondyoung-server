"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import { ProductGrid } from "@/components/products/product-grid"
import testImg from "@assets/images/test.png"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"

export function WelcomeDealSection() {
  const mockProductData = {
    brand: "아리메스",
    title: "아리메스 리뉴얼 블랙 영양제 블랙 10ml",
    price: 27000,
    originalPrice: 70000,
    discount: 78,
    rating: 4.9,
    reviewCount: 401,
    imageSrc: testImg.src,
  }

  const products = Array.from({ length: 12 }, (_, index) => ({
    ...mockProductData,
    id: String(index + 1),
  }))

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
            {products.map((product, index) => (
              <ProductCarousel.Item
                key={product.id}
                className="basis-[42%] pl-0"
              >
                <ProductCard className="border-r-[0.5px] border-r-gray-100 pr-4 last:border-r-0">
                  <ProductCard.Thumbnail
                    src={product.imageSrc}
                    alt={product.title}
                    className="rounded-sm md:rounded-md"
                  />
                  <ProductCard.Info {...product} />
                </ProductCard>
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
        />
      </div>
    </div>
  )
}
