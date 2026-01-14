"use client"
import React, { useState, useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { ProductCard } from "@lib/types/ui/product"
import { BasicProductCard } from "@components/products/product-card"

interface ProductComparisonCarouselProps {
  title: string
  products: ProductCard[]
  onCartClick?: (product: ProductCard) => void
  className?: string
  itemsPerView?: {
    mobile: number
    tablet: number
    desktop: number
  }
}

export const ProductRecommandSlider: React.FC<
  ProductComparisonCarouselProps
> = ({
  title,
  products,
  className = "",
  itemsPerView = {
    mobile: 1.2,
    tablet: 2.5,
    desktop: 4,
  },
}) => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const scrollToIndex = (index: number) => {
    if (!scrollContainerRef.current) return

    const container = scrollContainerRef.current
    const itemWidth = container.children[0]?.clientWidth || 0
    const gap = 16 // gap-4 = 16px
    const scrollLeft = index * (itemWidth + gap)

    container.scrollTo({
      left: scrollLeft,
      behavior: "smooth",
    })

    setCurrentIndex(index)
  }

  const scrollNext = () => {
    const maxIndex = Math.max(
      0,
      products.length - Math.floor(itemsPerView.desktop)
    )
    if (currentIndex < maxIndex) {
      scrollToIndex(currentIndex + 1)
    }
  }

  const scrollPrev = () => {
    if (currentIndex > 0) {
      scrollToIndex(currentIndex - 1)
    }
  }

  const canScrollNext =
    currentIndex <
    Math.max(0, products.length - Math.floor(itemsPerView.desktop))
  const canScrollPrev = currentIndex > 0

  if (!products || products.length === 0) {
    return null
  }

  return (
    <div className={`relative ${className}`}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
      </div>

      {/* Carousel Container */}
      <div>
        {/* Products Container */}
        <div
          ref={scrollContainerRef}
          className="scrollbar-hide flex snap-x snap-mandatory flex-nowrap gap-4 overflow-x-auto"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {products.map((product, index) => (
            <div
              key={product.id}
              className="flex-fl snap-start"
              style={{
                width: `calc(${100 / itemsPerView.mobile}% - 12px)`,
              }}
            >
              <BasicProductCard product={product} />
            </div>
          ))}
        </div>
      </div>

      {/* Desktop Indicators */}
      <div className="mt-4 hidden justify-center gap-2 md:flex">
        {Array.from({
          length: Math.ceil(products.length / itemsPerView.desktop),
        }).map((_, index) => (
          <button
            key={index}
            onClick={() => scrollToIndex(index)}
            className={`h-2 w-2 rounded-full transition-colors ${
              index === currentIndex ? "bg-blue-500" : "bg-gray-300"
            }`}
          />
        ))}
      </div>
      {/* Navigation Buttons - Desktop Only */}
      <div className="hidden items-center gap-2 md:flex">
        <button
          onClick={scrollPrev}
          disabled={!canScrollPrev}
          className={`rounded-full border p-2 transition-colors ${
            canScrollPrev
              ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              : "bg-muted cursor-not-allowed border-gray-200 text-gray-400"
          }`}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={scrollNext}
          disabled={!canScrollNext}
          className={`rounded-full border p-2 transition-colors ${
            canScrollNext
              ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              : "bg-muted cursor-not-allowed border-gray-200 text-gray-400"
          }`}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      {/* Mobile Navigation Dots */}
      <div className="my-4 flex justify-center gap-2 md:hidden">
        {Array.from({
          length: Math.ceil(products.length / itemsPerView.mobile),
        }).map((_, index) => (
          <button
            key={index}
            onClick={() => scrollToIndex(index)}
            className={`h-2 w-2 rounded-full transition-colors ${
              index === currentIndex ? "bg-blue-500" : "bg-gray-300"
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// CSS for hiding scrollbar
const styles = `
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
`

// Inject styles
if (typeof document !== "undefined") {
  const styleSheet = document.createElement("style")
  styleSheet.textContent = styles
  document.head.appendChild(styleSheet)
}
