"use client"

import { Button } from "@/components/ui/button"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import { toggleWishlist } from "@lib/api/users/wishlist"
import { cn } from "@/lib/utils"
import { Heart, Minus, Plus, ShoppingCart, Check } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

interface ProductQuickActionsProps {
  productId: string
  variantId?: string
  isSingleOption: boolean
  isWishlisted?: boolean
  isLoggedIn?: boolean
  countryCode?: string
  onWishlistChange?: (isWishlisted: boolean) => void
}

/**
 * 상품 카드 퀵 액션 버튼 (찜하기 + 장바구니)
 * - 찜하기: 토글
 * - 장바구니: 단일 옵션이면 인라인 수량 선택, 다중 옵션이면 상세페이지로
 */
export function ProductQuickActions({
  productId,
  variantId,
  isSingleOption,
  isWishlisted: initialWishlisted = false,
  isLoggedIn = false,
  countryCode = "kr",
  onWishlistChange,
}: ProductQuickActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { addToCart, isLoading: isCartLoading } = useAddToCart()

  const [isWishlisted, setIsWishlisted] = useState(initialWishlisted)
  const [showQuantitySelector, setShowQuantitySelector] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [isAddedToCart, setIsAddedToCart] = useState(false)

  // 찜하기 토글
  const handleWishlistToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!isLoggedIn) {
      toast.error("로그인이 필요합니다.")
      return
    }

    const previousState = isWishlisted
    setIsWishlisted(!isWishlisted)
    onWishlistChange?.(!isWishlisted)

    startTransition(async () => {
      try {
        await toggleWishlist(productId)
        toast.success(
          isWishlisted
            ? "찜 목록에서 삭제되었습니다."
            : "찜 목록에 추가되었습니다."
        )
      } catch {
        setIsWishlisted(previousState)
        onWishlistChange?.(previousState)
        toast.error("처리 중 오류가 발생했습니다.")
      }
    })
  }

  // 장바구니 버튼 클릭
  const handleCartClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!isSingleOption) {
      // 다중 옵션: 상세페이지로 이동
      router.push(`/${countryCode}/products/${productId}`)
      return
    }

    // 단일 옵션: 수량 선택 UI 표시
    setShowQuantitySelector(true)
  }

  // 수량 변경
  const handleQuantityChange = (delta: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setQuantity((prev) => Math.max(1, prev + delta))
  }

  // 장바구니 담기
  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!variantId) {
      toast.error("상품 정보를 찾을 수 없습니다.")
      return
    }

    const result = await addToCart({ variantId, quantity })
    if (result?.success) {
      setIsAddedToCart(true)
      toast.success("장바구니에 담았습니다.")
      // 2초 후 초기화
      setTimeout(() => {
        setShowQuantitySelector(false)
        setIsAddedToCart(false)
        setQuantity(1)
      }, 2000)
    }
  }

  // 수량 선택 닫기
  const handleClose = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setShowQuantitySelector(false)
    setQuantity(1)
  }

  return (
    <div className="absolute right-2 bottom-2 flex flex-col items-end gap-1.5">
      {/* 찜하기 버튼 - 모바일에서는 항상 표시, 데스크탑에서는 호버 시 표시 */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-8 w-8 rounded-full border border-white/20 bg-white/80 shadow-sm backdrop-blur-sm",
          "transition-all duration-200 hover:scale-105 hover:bg-white active:scale-95",
          "md:opacity-0 md:group-hover:opacity-100",
          isPending && "pointer-events-none opacity-50"
        )}
        onClick={handleWishlistToggle}
        disabled={isPending}
      >
        <Heart
          className={cn(
            "h-4 w-4 transition-colors",
            isWishlisted ? "fill-red-500 text-red-500" : "text-gray-600"
          )}
        />
      </Button>

      {/* 장바구니 버튼 / 수량 선택 UI - 모바일에서는 항상 표시, 데스크탑에서는 호버 시 표시 */}
      {!showQuantitySelector ? (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8 rounded-full border border-white/20 bg-white/80 shadow-sm backdrop-blur-sm",
            "transition-all duration-200 hover:scale-105 hover:bg-white active:scale-95",
            "md:opacity-0 md:group-hover:opacity-100"
          )}
          onClick={handleCartClick}
        >
          <ShoppingCart className="h-4 w-4 text-gray-600" />
        </Button>
      ) : (
        <div
          className="flex items-center gap-1 rounded-full border border-white/20 bg-white/95 px-2 py-1 shadow-md backdrop-blur-sm"
          onClick={(e) => e.preventDefault()}
        >
          {isAddedToCart ? (
            <div className="flex items-center gap-1 px-2">
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-xs font-medium text-green-600">담김</span>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full p-0 hover:bg-gray-100"
                onClick={(e) => handleQuantityChange(-1, e)}
                disabled={quantity <= 1}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="min-w-[20px] text-center text-sm font-medium">
                {quantity}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full p-0 hover:bg-gray-100"
                onClick={(e) => handleQuantityChange(1, e)}
              >
                <Plus className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="bg-yellow-30 hover:bg-yellow-40 ml-1 h-6 rounded-full px-2 text-xs text-white hover:text-white"
                onClick={handleAddToCart}
                disabled={isCartLoading}
              >
                {isCartLoading ? "..." : "담기"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 rounded-full p-0 text-gray-400 hover:bg-gray-100"
                onClick={handleClose}
              >
                <span className="text-xs">X</span>
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
