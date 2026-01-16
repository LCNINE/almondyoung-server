"use client"

import { Button } from "@/components/ui/button"
import { ShoppingCart } from "lucide-react"
import testImage from "@/assets/images/test.png"
import Image from "next/image"
import { ProductCarousel } from "../../shared/product-carousel"
import Link from "next/link"
import { cn } from "@/lib/utils"

export function StockAlertContent() {
  const stockItems = [
    { id: 1, count: 4 },
    { id: 2, count: 2 },
    { id: 3, count: 1 },
  ]

  return (
    <div className="w-full">
      <ProductCarousel className="w-full">
        <ProductCarousel.List className="ml-0 gap-3">
          {stockItems.map(function (item) {
            return (
              <ProductCarousel.Item
                key={item.id}
                className={cn(
                  `basis-[calc(50%-6px)] pl-0 ${stockItems.length > 2 && "ml-2"}`
                )}
              >
                <div className="flex flex-col gap-2">
                  <Link
                    className="relative block aspect-square w-full overflow-hidden rounded-[20px] bg-[#F5F5F5]"
                    href={`/products/${item.id}`}
                  >
                    <Image
                      src={testImage}
                      alt="product"
                      fill
                      className="object-cover"
                    />
                    <Button
                      size="icon"
                      className="absolute right-2 bottom-2 h-8 w-8 rounded-full border-none bg-white shadow-md hover:bg-gray-50"
                    >
                      <ShoppingCart className="h-4 w-4 text-black" />
                    </Button>
                  </Link>

                  <p className="flex items-center gap-1.5 text-[12px] font-bold text-[#F24E1E]">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#F24E1E] text-[10px] text-white">
                      !
                    </span>
                    잔여수량 {item.count}개
                  </p>
                </div>
              </ProductCarousel.Item>
            )
          })}
        </ProductCarousel.List>
      </ProductCarousel>
    </div>
  )
}
