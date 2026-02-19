"use client"

import { SingleOptionQuantitySelector } from "@/app/[countryCode]/(main)/products/components/single-option-quantity-selector"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
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
import { useMembershipPricing } from "@/hooks/use-membership-pricing"
import type { ProductDetail } from "@lib/types/ui/product"
import { Heart, MessageCircle } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { ProductOptionSelector } from "./product-option-selector"
import { ProductPriceDisplay } from "./product-price-display"
import { ProductRatingDisplay } from "./product-rating-display"
import { ProductShippingInfo } from "./product-shipping-info"

type SelectedCartOption = {
  id: string
  variantId?: string
  name: string
  quantity: number
  price: number
  image: string
  stock?: number
}

type OptionWithSoldOut = {
  label: string
  type: string
  values: Array<{
    id: string
    name: string
    isSoldOut?: boolean
  }>
}

type Props = {
  product: ProductDetail
  isWishlisted: boolean
  isWishlistPending: boolean
  onWishlistToggle: (productId: string) => void
  countryCode: string
  // isUser: boolean
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
  rating?: number
  reviewCount?: number
  optionsWithSoldOut?: OptionWithSoldOut[]
  isSoldOut?: boolean
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
  // isUser,
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
  rating,
  reviewCount,
  optionsWithSoldOut,
  isSoldOut = false,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [showLoginDialog, setShowLoginDialog] = useState(false)
  const { isMembershipPricing } = useMembershipPricing()
  const isMember = isMembershipPricing

  const isSingleOption = !product.options || product.options.length === 0
  const isOutOfStock = product.status !== "active"
  const resolvePrice = (base?: number, actual?: number) => {
    const basePrice = base ?? 0
    const actualPrice = actual ?? basePrice
    if (!isMembershipPricing) {
      return basePrice
    }

    if (actualPrice > 0 && actualPrice < basePrice) {
      return actualPrice
    }

    const fallbackMembershipPrice = product.membershipPrice
    if (
      typeof fallbackMembershipPrice === "number" &&
      fallbackMembershipPrice > 0 &&
      fallbackMembershipPrice < basePrice
    ) {
      return fallbackMembershipPrice
    }

    return actualPrice
  }
  const getVariantPrice = (variantId?: string) => {
    if (variantId && variantId === product.defaultVariantId) {
      return resolvePrice(product.basePrice, product.actualPrice)
    }
    if (variantId && product.variantPriceMap?.[variantId]) {
      const price = product.variantPriceMap[variantId]
      return resolvePrice(price.basePrice, price.actualPrice)
    }
    return resolvePrice(product.basePrice, product.actualPrice)
  }
  const defaultVariantId = product.defaultVariantId
  const getPrice = () => getVariantPrice(defaultVariantId)
  const getDiscountRate = () => {
    const base = product.basePrice || 0
    const actual = product.actualPrice ?? base
    if (isMembershipPricing && base > 0 && actual > 0 && actual < base) {
      return Math.round(((base - actual) / base) * 100)
    }
    return 0
  }
  const hasMembershipPrice =
    typeof product.membershipPrice === "number" &&
    typeof product.basePrice === "number" &&
    product.membershipPrice > 0 &&
    product.basePrice > product.membershipPrice

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
                    isWishlisted
                      ? "fill-red-500 text-red-500"
                      : "text-gray-300"
                  }`}
                />
              </CustomButton>
              <CustomButton
                variant="outline"
                color="secondary"
                size="md"
                aria-label="챗봇"
              >
                <MessageCircle className="h-7 w-7" />
              </CustomButton>
            </div>
          </header>

          {/* 평점 */}
          <ProductRatingDisplay
            rating={rating ?? product.rating ?? 0}
            reviewCount={reviewCount ?? product.reviewCount ?? 0}
          />

          {/* 가격 */}
          {product.basePrice !== undefined && (
            <ProductPriceDisplay
              basePrice={product.basePrice}
              membershipPrice={product.membershipPrice}
              isMember={isMember}
              isMembershipOnly={product.isMembershipOnly || false}
              discountRate={getDiscountRate()}
              memberPrices={product.memberPrices}
              actualPrice={product.actualPrice}
              showMembershipHint={
                !isMember &&
                hasMembershipPrice &&
                typeof product.actualPrice === "number" &&
                Math.abs(
                  product.actualPrice - (product.membershipPrice ?? 0)
                ) >= 1
              }
              membershipSavings={
                hasMembershipPrice
                  ? product.basePrice - (product.membershipPrice ?? 0)
                  : undefined
              }
            />
          )}

          {/* 배송 정보 */}
          {product.shipping && (
            <ProductShippingInfo shipping={product.shipping} />
          )}

          {/* 옵션 선택 (단일 옵션 품절 시 숨김) */}
          {!(isSingleOption && isSoldOut) && (
            <section className="border-gray-20 mb-4 border-t pt-4">
              {isSingleOption ? (
                <SingleOptionQuantitySelector
                  productName={product.name}
                  quantity={quantity}
                  onQuantityChange={onQuantityChange}
                  price={getPrice()}
                  stock={product.manageInventory ? product.available : null}
                  showTitle={true}
                />
              ) : (
                <ProductOptionSelector
                  options={optionsWithSoldOut || product.options || []}
                  selectedOptions={selectedOptions}
                  selectedCartOptions={selectedCartOptions}
                  onOptionChange={onOptionChange}
                  onQuantityUpdate={onQuantityUpdate}
                  onOptionRemove={onOptionRemove}
                />
              )}
            </section>
          )}

          {/* 총 상품 금액 (단일 옵션 품절 시 숨김) */}
          {!(isSingleOption && isSoldOut) && (
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
          )}

          {/* 액션 버튼 */}
          <footer className="flex gap-2">
            {isOutOfStock || (isSingleOption && isSoldOut) ? (
              <>
                {/* todo: 미연결 액션 임시 비활성화 */}
                {/* <CustomButton
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
                </CustomButton> */}
                <CustomButton
                  variant="outline"
                  color="secondary"
                  size="lg"
                  className="flex-1 cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                  disabled
                >
                  현재 품절된 상품이에요
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
