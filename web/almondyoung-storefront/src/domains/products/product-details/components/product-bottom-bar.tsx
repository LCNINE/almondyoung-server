"use client"

import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { Heart } from "lucide-react"

type Props = {
  isInWishlist: boolean
  wishlistLoading: boolean
  hasOptions: boolean
  onWishlistToggle: () => void
  onCartClick: () => void
  onBuyClick: () => void
}

/**
 * @description 모바일 하단 고정 액션 바
 * 시맨틱: <nav> 사용 (주요 액션 네비게이션)
 */
export function ProductBottomBar({
  isInWishlist,
  wishlistLoading,
  hasOptions,
  onWishlistToggle,
  onCartClick,
  onBuyClick,
}: Props) {
  return (
    <nav
      className="border-gray-20 fixed right-0 bottom-0 left-0 z-50 border-t bg-white p-4 lg:hidden"
      aria-label="상품 액션"
    >
      <div className="flex gap-2">
        <CustomButton
          variant="outline"
          size="lg"
          onClick={onWishlistToggle}
          disabled={wishlistLoading}
          aria-label="찜하기"
        >
          <Heart
            className={`h-6 w-6 ${
              isInWishlist ? "fill-red-500 text-red-500" : "text-gray-400"
            }`}
          />
        </CustomButton>

        <CustomButton
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={onCartClick}
        >
          장바구니
        </CustomButton>

        <CustomButton
          variant="fill"
          size="lg"
          className="flex-1"
          onClick={onBuyClick}
        >
          바로구매
        </CustomButton>
      </div>
    </nav>
  )
}
