"use client"

import {
  ProductListCard,
  ProductListCardSkeleton,
} from "@/components/products/product-list-card"
import type { ProductCardProps } from "@lib/types/ui/product"
import { Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import Link from "next/link"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import { useState } from "react"

interface RecentContainerProps {
  products: ProductCardProps[]
  countryCode: string
}

export function RecentContainer({ products, countryCode }: RecentContainerProps) {
  const { addToCart, isLoading: isAddingToCart } = useAddToCart()
  const [addingToCartIds, setAddingToCartIds] = useState<Set<string>>(new Set())
  const [excludeSoldOut, setExcludeSoldOut] = useState(false)

  const handleAddToCart = async (product: ProductCardProps) => {
    if (!product.optionMeta?.isSingle || !product.optionMeta?.defaultVariantId) {
      window.location.href = `/${countryCode}/products/${product.id}`
      return
    }

    setAddingToCartIds((prev) => new Set(prev).add(product.id))

    try {
      await addToCart({
        variantId: product.optionMeta.defaultVariantId,
        quantity: 1,
      })
      toast.success("장바구니에 담았습니다.")
    } catch {
      toast.error("장바구니 담기에 실패했습니다.")
    } finally {
      setAddingToCartIds((prev) => {
        const next = new Set(prev)
        next.delete(product.id)
        return next
      })
    }
  }

  // 품절상품 필터링
  const filteredProducts = excludeSoldOut
    ? products.filter((p) => !p.manageInventory || p.available > 0)
    : products

  if (products.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
        <Eye className="h-12 w-12 text-gray-300" />
        <div>
          <p className="text-lg font-medium text-gray-600">
            최근 본 상품이 없습니다
          </p>
          <p className="mt-1 text-sm text-gray-400">
            상품을 둘러보고 나만의 취향을 찾아보세요
          </p>
        </div>
        <Link href={`/${countryCode}`}>
          <Button variant="outline">쇼핑하러 가기</Button>
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* 품절상품 제외 체크박스 */}
      <div className="mb-4 flex items-center gap-2">
        <Checkbox
          id="exclude-soldout"
          checked={excludeSoldOut}
          onCheckedChange={(checked) => setExcludeSoldOut(checked === true)}
        />
        <Label
          htmlFor="exclude-soldout"
          className="cursor-pointer text-sm text-gray-600"
        >
          품절상품 제외
        </Label>
      </div>

      {/* 상품 리스트 */}
      <div className="space-y-0">
        {filteredProducts.map((product) => (
          <ProductListCard
            key={product.id}
            id={product.id}
            title={product.title}
            imageSrc={product.imageSrc}
            price={product.price}
            originalPrice={product.originalPrice}
            discount={product.discount}
            membershipSavings={product.membershipSavings}
            available={product.available}
            manageInventory={product.manageInventory}
            countryCode={countryCode}
            optionMeta={product.optionMeta}
            showDeleteButton={false}
            onAddToCart={() => handleAddToCart(product)}
            isAddingToCart={addingToCartIds.has(product.id) || isAddingToCart}
          />
        ))}
      </div>

      {/* 필터링 후 빈 결과 */}
      {filteredProducts.length === 0 && products.length > 0 && (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-center">
          <p className="text-gray-500">품절된 상품만 있습니다</p>
          <Button
            variant="link"
            onClick={() => setExcludeSoldOut(false)}
            className="text-sm"
          >
            전체 상품 보기
          </Button>
        </div>
      )}
    </div>
  )
}

export function RecentContainerSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 4 }).map((_, i) => (
        <ProductListCardSkeleton key={i} />
      ))}
    </div>
  )
}
