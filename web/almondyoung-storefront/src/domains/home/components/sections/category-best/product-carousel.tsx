import { ProductCard } from "@/components/products-origin/prodcut-card"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { cn } from "@lib/utils"
import chunk from "lodash/chunk"

interface ProductCarouselProps {
  products: number[]
  carousel: {
    setApi: (api: any) => void
    current: number
    count: number
  }
  mockProductData: any
}

export function ProductCarousel({
  products,
  carousel,
  mockProductData,
}: ProductCarouselProps) {
  const chunkedProducts = chunk(products, 6)

  return (
    <div className="md:hidden">
      <Carousel setApi={carousel.setApi} className="w-full">
        <CarouselContent>
          {chunkedProducts.map((group, index) => (
            <CarouselItem key={index}>
              <div className="grid grid-cols-3 gap-x-3 gap-y-8">
                {group.map((i) => (
                  <ProductCard key={i} rank={i} {...mockProductData} />
                ))}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {/* 페이지 네이션 도트  */}
      {carousel.count > 1 && (
        <div className="mt-6 flex justify-center gap-1.5">
          {Array.from({ length: carousel.count }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                carousel.current === i ? "w-4 bg-black" : "w-1.5 bg-gray-200"
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
