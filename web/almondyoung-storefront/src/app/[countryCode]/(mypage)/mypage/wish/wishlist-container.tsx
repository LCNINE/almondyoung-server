"use client"

import { BasicProductCard, ProductCardSkeleton } from "@components/products/product-card"
import { useWishlist } from "@/contexts/wishlist-context"
import { getProductList } from "@lib/api/medusa/products"
import { mapMedusaProductsToCards } from "@lib/utils/map-medusa-product-card"
import { useEffect, useState, useTransition } from "react"
import type { ProductCard } from "@lib/types/ui/product"
import { Heart, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import Link from "next/link"

interface WishlistContainerProps {
  countryCode: string
}

export function WishlistContainer({ countryCode }: WishlistContainerProps) {
  const { ids, isLoaded, isLoading: isWishlistLoading, toggle, isPending } =
    useWishlist()
  const [products, setProducts] = useState<ProductCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [isTransitionPending, startTransition] = useTransition()

  useEffect(() => {
    if (!isLoaded) return

    const fetchWishlist = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const productIds = Array.from(ids)

        if (productIds.length === 0) {
          setProducts([])
          return
        }

        const productsResult = await getProductList({
          id: productIds,
          limit: productIds.length,
        })

        const mappedProducts = mapMedusaProductsToCards(productsResult.products)
        setProducts(mappedProducts)
      } catch (err) {
        console.error("위시리스트 로드 실패:", err)
        setError("위시리스트를 불러오는데 실패했습니다.")
      } finally {
        setIsLoading(false)
      }
    }

    fetchWishlist()
  }, [ids, isLoaded])

  const handleRemove = (productId: string) => {
    setRemovingIds((prev) => new Set(prev).add(productId))

    startTransition(async () => {
      try {
        const action = await toggle(productId)
        setProducts((prev) => prev.filter((p) => p.id !== productId))
        if (action === "removed") {
          toast.success("찜 목록에서 삭제되었습니다.")
        }
      } catch {
        toast.error("삭제에 실패했습니다.")
      } finally {
        setRemovingIds((prev) => {
          const next = new Set(prev)
          next.delete(productId)
          return next
        })
      }
    })
  }

  if (isLoading || isWishlistLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 text-center">
        <p className="text-gray-500">{error}</p>
        <Button
          variant="outline"
          onClick={() => window.location.reload()}
        >
          다시 시도
        </Button>
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
        <Heart className="h-12 w-12 text-gray-300" />
        <div>
          <p className="text-lg font-medium text-gray-600">
            찜한 상품이 없습니다
          </p>
          <p className="mt-1 text-sm text-gray-400">
            마음에 드는 상품을 찜해보세요
          </p>
        </div>
        <Link href={`/${countryCode}`}>
          <Button variant="outline">쇼핑하러 가기</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <div key={product.id} className="group relative">
          <BasicProductCard product={product} />
          {/* 삭제 버튼 */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 h-8 w-8 rounded-full bg-white/80 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
            onClick={() => handleRemove(product.id)}
            disabled={
              removingIds.has(product.id) ||
              isTransitionPending ||
              isPending(product.id)
            }
          >
            <Trash2 className="h-4 w-4 text-gray-500" />
          </Button>
        </div>
      ))}
    </div>
  )
}
