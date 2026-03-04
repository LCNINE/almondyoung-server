"use client"

import React, { useState, useRef, ReactNode, MouseEvent } from "react"
import Link from "next/link"
import { ProductCard } from "@/components/products/prodcut-card"
import type { ProductCardProps } from "@lib/types/ui/product"

interface DraggableSliderProps {
  title: string
  children: ReactNode
}

function DraggableSliderCards({ title, children }: DraggableSliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!scrollRef.current) return
    setIsDragging(true)
    setStartX(e.pageX - scrollRef.current.offsetLeft)
    setScrollLeft(scrollRef.current.scrollLeft)
  }
  const onMouseUpOrLeave = () => setIsDragging(false)
  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !scrollRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = (x - startX) * 2
    scrollRef.current.scrollLeft = scrollLeft - walk
  }
  return (
    <section className="recommendation-section">
      <div className="recommendation-container bg-white p-4">
        <header className="recommendation-header">
          <h3 className="recommendation-title mb-4 text-lg font-bold">
            {title}
          </h3>
        </header>
        <div className="slider-wrapper">
          <div
            ref={scrollRef}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUpOrLeave}
            onMouseLeave={onMouseUpOrLeave}
            onMouseMove={onMouseMove}
            className={`slider-track scrollbar-hide flex cursor-grab overflow-x-auto scroll-smooth pb-4 ${isDragging ? "cursor-grabbing" : ""}`}
          >
            <div className="slider-inner flex">{children}</div>
          </div>
        </div>
      </div>
    </section>
  )
}

interface RecommendedProductsProps {
  products: ProductCardProps[]
  countryCode?: string
}

export function RecommendedProducts({
  products,
  countryCode = "kr",
}: RecommendedProductsProps) {
  if (products.length === 0) return null

  return (
    <aside className="recommendations mt-2 md:hidden" role="complementary">
      <DraggableSliderCards title="한번에 구매 시 할인이 늘어나요">
        {products.map((product) => {
          const isSoldOut = product.manageInventory && product.available <= 0
          return (
            <div
              key={product.id}
              className="recommendation-item w-[40%] flex-shrink-0 pr-3 sm:w-[calc(100%/3.2)]"
            >
              <Link href={`/${countryCode}/products/${product.handle}`}>
                <ProductCard>
                  <ProductCard.Thumbnail
                    src={product.imageSrc}
                    alt={product.title}
                    isSoldOut={isSoldOut}
                  />
                  <ProductCard.Info {...product} />
                </ProductCard>
              </Link>
            </div>
          )
        })}
      </DraggableSliderCards>
    </aside>
  )
}
