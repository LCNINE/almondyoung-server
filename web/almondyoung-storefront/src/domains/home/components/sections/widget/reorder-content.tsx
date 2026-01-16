"use client"

import Image from "next/image"
import { Button } from "@/components/ui/button"
import testImage from "@/assets/images/test.png"
import Link from "next/link"
import { ProductCarousel } from "../../shared/product-carousel"

/**
 * 최근 구매 제품
 */
export function ReorderContent({ onClose }: { onClose: () => void }) {
  const items = [1, 2, 3] // 예시 데이터

  return (
    <div className="space-y-4">
      <ProductCarousel opts={{ align: "start", containScroll: "trimSnaps" }}>
        <ProductCarousel.List className="ml-0 gap-3">
          {items.map((i) => (
            <ProductCarousel.Item key={i} className="basis-auto pl-0">
              <Link
                key={i}
                className="relative block h-11 w-11 overflow-hidden rounded-md"
                href={`/products/${i}`}
              >
                <Image
                  src={testImage}
                  alt="product"
                  className="object-cover"
                  fill
                />
              </Link>
            </ProductCarousel.Item>
          ))}
        </ProductCarousel.List>
      </ProductCarousel>
      <div className="flex gap-2">
        <Button className="bg-yellow-30 cursor-pointer text-white">
          장바구니 담기
        </Button>
        <Button
          onClick={onClose}
          variant="outline"
          className="cursor-pointer hover:bg-transparent hover:text-black"
        >
          필요하지 않아요
        </Button>
      </div>
    </div>
  )
}
