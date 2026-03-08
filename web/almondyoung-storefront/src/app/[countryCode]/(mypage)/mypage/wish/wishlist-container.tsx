"use client"

import {
  ProductListCard,
  ProductListCardSkeleton,
} from "@/components/products/product-list-card"
import { useWishlist } from "@/contexts/wishlist-context"
import { listProducts } from "@lib/api/medusa/products"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"
import { useEffect, useState, useTransition } from "react"
import type { ProductCardProps } from "@lib/types/ui/product"
import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import Link from "next/link"
import { useAddToCart } from "@hooks/api/use-add-to-cart"

interface WishlistContainerProps {
  countryCode: string
}

export function WishlistContainer({ countryCode }: WishlistContainerProps) {
  const { ids, isLoaded, isLoading: isWishlistLoading, toggle, isPending } =
    useWishlist()
  const { addToCart, isLoading: isAddingToCart } = useAddToCart()
  const [products, setProducts] = useState<ProductCardProps[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [addingToCartIds, setAddingToCartIds] = useState<Set<string>>(new Set())
  const [excludeSoldOut, setExcludeSoldOut] = useState(false)
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

        const productsResult = await listProducts({
          countryCode,
          queryParams: {
            id: productIds,
            limit: productIds.length,
          },
        })

        const mappedProducts = mapStoreProductsToCardProps(productsResult.response.products)
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

  const handleAddToCart = async (product: ProductCardProps) => {
    if (!product.optionMeta?.isSingle || !product.optionMeta?.defaultVariantId) {
      window.location.href = `/${countryCode}/products/${product.handle}`
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

  if (isLoading || isWishlistLoading) {
    return (
      <div className="space-y-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <ProductListCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 text-center">
        <p className="text-gray-500">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
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
            handle={product.handle}
            title={product.title}
            imageSrc={product.imageSrc}
            price={product.price}
            originalPrice={product.originalPrice}
            discount={product.discount}
            membershipSavings={product.membershipSavings}
            isMembershipOnly={product.isMembershipOnly}
            available={product.available}
            manageInventory={product.manageInventory}
            countryCode={countryCode}
            optionMeta={product.optionMeta}
            onDelete={() => handleRemove(product.id)}
            onAddToCart={() => handleAddToCart(product)}
            isDeleting={
              removingIds.has(product.id) ||
              isTransitionPending ||
              isPending(product.id)
            }
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

export function WishlistContainerSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 4 }).map((_, i) => (
        <ProductListCardSkeleton key={i} />
      ))}
    </div>
  )
}
