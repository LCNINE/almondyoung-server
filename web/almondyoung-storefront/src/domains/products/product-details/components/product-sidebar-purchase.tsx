"use client"

import { SingleOptionQuantitySelector } from "@/app/[countryCode]/(main)/products/components/single-option-quantity-selector"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import type { ProductDetail } from "@lib/types/ui/product"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Bell, Heart, MessageCircle, Zap } from "lucide-react"
import { useState } from "react"
import { ProductOptionSelector } from "./product-option-selector"
import { ProductPriceDisplay } from "./product-price-display"
import { ProductRatingDisplay } from "./product-rating-display"
import { ProductShippingInfo } from "./product-shipping-info"
import { usePathname, useRouter } from "next/navigation"

type SelectedCartOption = {
  id: string
  variantId?: string
  name: string
  quantity: number
  price: number
  image: string
  stock?: number
}

type Props = {
  product: ProductDetail
  isWishlisted: boolean
  isWishlistPending: boolean
  onWishlistToggle: (productId: string) => void
  countryCode: string
  isUser: boolean
  quantity: number
  onQuantityChange: (value: number) => void
  selectedOptions: Record<string, string>
  selectedCartOptions: SelectedCartOption[]
  onOptionChange: (optionLabel: string, value: string) => void
  onQuantityUpdate: (id: string, newQuantity: number) => void
  onOptionRemove: (id: string) => void
  onAddToCart: () => void | Promise<boolean>
  onBuyNow: () => void | Promise<void>
  isAddToCartLoading?: boolean
}

/**
 * @description 데스크탑 사이드바 구매 패널
 * - 모든 구매 관련 로직을 내부에서 관리
 * - 액션 완결성: 장바구니 담기, 구매하기 모두 여기서 처리
 */
export function ProductSidebarPurchase({
  product,
  isWishlisted,
  isWishlistPending,
  onWishlistToggle,
  countryCode,
  isUser,
  quantity,
  onQuantityChange,
  selectedOptions,
  selectedCartOptions,
  onOptionChange,
  onQuantityUpdate,
  onOptionRemove,
  onAddToCart,
  onBuyNow,
  isAddToCartLoading = false,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [showLoginDialog, setShowLoginDialog] = useState(false)

  const isSingleOption = !product.options || product.options.length === 0
  const isOutOfStock = product.status !== "active"
  const getVariantPrice = (variantId?: string) => {
    if (variantId && variantId === product.defaultVariantId) {
      return product.membershipPrice || product.basePrice || 0
    }
    if (variantId && product.variantPriceMap?.[variantId]) {
      const price = product.variantPriceMap[variantId]
      return price.membershipPrice || price.basePrice || 0
    }
    return product.membershipPrice || product.basePrice || 0
  }
  const defaultVariantId = product.defaultVariantId
  const getPrice = () => getVariantPrice(defaultVariantId)
  const getDiscountRate = () => {
    const base = product.basePrice || 0
    const member = product.membershipPrice || 0
    if (base > 0 && member > 0 && member < base) {
      return Math.round(((base - member) / base) * 100)
    }
    return 0
  }

  const getTotalQuantity = () => {
    if (isSingleOption) return quantity
    return selectedCartOptions.reduce((sum, opt) => sum + opt.quantity, 0)
  }

  const getTotalPrice = () => {
    if (isSingleOption) return quantity * getPrice()
    return selectedCartOptions.reduce(
      (sum, opt) => sum + opt.price * opt.quantity,
      0
    )
  }

  const handleLoginConfirm = () => {
    setShowLoginDialog(false)
    router.push(
      `/${countryCode}/login?redirect_to=${encodeURIComponent(pathname)}`
    )
  }
  return (
    <>
      <aside className="hidden w-full min-w-[383px] overflow-y-auto md:sticky md:top-0 md:block md:max-h-screen md:max-w-[383px] lg:max-w-[480px]">
        <div className="h-full bg-white p-6">
          {/* 헤더: 브랜드, 상품명, 액션 버튼 */}
          <header className="flex justify-between gap-4">
            <div className="mb-4">
              {product.brand && (
                <p className="text-sm text-gray-600">{product.brand}</p>
              )}
              <h2 className="text-xl font-bold">{product.name}</h2>
            </div>

            <div className="flex gap-2">
              <CustomButton
                variant="outline"
                color="secondary"
                size="md"
                onClick={() => onWishlistToggle(product.id)}
                disabled={isWishlistPending}
                aria-label="찜하기"
              >
                <Heart
                  className={`h-7 w-7 ${
                    isWishlisted ? "text-red-500" : "text-gray-300"
                  }`}
                />
                찜
              </CustomButton>
              <CustomButton
                variant="outline"
                color="secondary"
                size="md"
                aria-label="챗봇"
              >
                <MessageCircle className="h-7 w-7" />
                챗봇
              </CustomButton>
            </div>
          </header>

          {/* 평점 */}
          <ProductRatingDisplay
            rating={product.rating || 0}
            reviewCount={product.reviewCount || 0}
          />

          {/* 가격 */}
          {product.basePrice !== undefined && (
              <ProductPriceDisplay
                basePrice={product.basePrice}
                membershipPrice={product.membershipPrice}
                isMembershipOnly={product.isMembershipOnly || false}
                discountRate={getDiscountRate()}
                memberPrices={product.memberPrices}
                actualPrice={product.actualPrice}
                showMembershipHint={
                  typeof product.membershipPrice === "number" &&
                  typeof product.basePrice === "number" &&
                  typeof product.actualPrice === "number" &&
                  product.basePrice > product.membershipPrice &&
                  Math.abs(product.actualPrice - product.membershipPrice) >= 1
                }
                membershipSavings={
                  typeof product.membershipPrice === "number" &&
                  typeof product.basePrice === "number" &&
                  product.basePrice > product.membershipPrice
                    ? product.basePrice - product.membershipPrice
                    : undefined
                }
              />
          )}

          {/* 배송 정보 */}
          {product.shipping && (
            <ProductShippingInfo shipping={product.shipping} />
          )}

          {/* 옵션 선택 */}
          <section className="border-gray-20 mb-4 border-t pt-4">
            {isSingleOption ? (
              <SingleOptionQuantitySelector
                productName={product.name}
                thumbnail={
                  product.thumbnails?.[0]
                    ? getThumbnailUrl(product.thumbnails?.[0])
                    : "https://placehold.co/80x80?text=No+Image"
                }
                quantity={quantity}
                onQuantityChange={onQuantityChange}
                price={getPrice()}
                stock={0}
                showTitle={true}
              />
            ) : (
              <ProductOptionSelector
                options={product.options || []}
                selectedOptions={selectedOptions}
                selectedCartOptions={selectedCartOptions}
                onOptionChange={onOptionChange}
                onQuantityUpdate={onQuantityUpdate}
                onOptionRemove={onOptionRemove}
              />
            )}
          </section>

          {/* 총 상품 금액 */}
          <section className="border-gray-20 mb-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">총 상품 금액</span>
              <div className="flex items-center gap-4 text-right">
                <p className="text-sm text-gray-500">
                  총 수량 {getTotalQuantity()}개
                </p>
                <output className="text-xl font-bold">
                  {getTotalPrice().toLocaleString()}원
                </output>
              </div>
            </div>
          </section>

          {/* 액션 버튼 */}
          <footer className="flex gap-2">
            {isOutOfStock ? (
              <>
                <CustomButton
                  variant="outline"
                  color="secondary"
                  size="lg"
                  className="flex-1"
                >
                  <Bell className="h-4 w-4" />
                  <span>재입고알림 신청하기</span>
                </CustomButton>
                <CustomButton
                  variant="fill"
                  color="primary"
                  size="lg"
                  className="flex-1 bg-green-600"
                >
                  <Zap className="h-4 w-4" />
                  <span>미리구매하기</span>
                </CustomButton>
              </>
            ) : (
              <>
                <CustomButton
                  variant="outline"
                  size="lg"
                  className="hover:text-primary flex-1 cursor-pointer hover:bg-transparent"
                  onClick={onAddToCart}
                  disabled={isAddToCartLoading}
                  spinnerColor="blue"
                  isLoading={isAddToCartLoading}
                >
                  장바구니
                </CustomButton>
                <CustomButton
                  variant="fill"
                  color="primary"
                  size="lg"
                  className="flex-1 cursor-pointer"
                  onClick={onBuyNow}
                  disabled={isAddToCartLoading}
                  spinnerColor="blue"
                  isLoading={isAddToCartLoading}
                >
                  바로구매
                </CustomButton>
              </>
            )}
          </footer>
        </div>
      </aside>

      {/* 로그인 필요 확인 모달 */}
      <AlertDialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>로그인이 필요합니다</AlertDialogTitle>
            <AlertDialogDescription>
              로그인이 필요한 기능입니다. 로그인 화면으로 이동하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleLoginConfirm}>
              로그인하기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
