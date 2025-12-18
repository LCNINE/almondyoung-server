"use client"

import { CustomButton } from "@components/common/custom-buttons/custom-button"
import { Spinner } from "@components/common/spinner"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import type { ProductDetail } from "@lib/types/ui/product"
import { SingleOptionQuantitySelector } from "app/[countryCode]/(main)/products/components/single-option-quantity-selector"
import { Bell, Heart, MessageCircle, Zap } from "lucide-react"
import { useState } from "react"
import { ProductOptionSelector } from "./product-option-selector"
import { ProductPriceDisplay } from "./product-price-display"
import { ProductRatingDisplay } from "./product-rating-display"
import { ProductShippingInfo } from "./product-shipping-info"

type Props = {
  product: ProductDetail
  isWishlisted: boolean
  isWishlistPending: boolean
  onWishlistToggle: (productId: string) => void
  countryCode: string
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
}: Props) {
  // 내부 상태 관리
  const [quantity, setQuantity] = useState(1)
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({})
  const [selectedCartOptions, setSelectedCartOptions] = useState<
    Array<{
      id: string
      name: string
      quantity: number
      price: number
      image: string
    }>
  >([])

  const { isLoading, addToCart } = useAddToCart()

  // 유틸 함수
  const isSingleOption = !product.options || product.options.length === 0
  const isOutOfStock = product.status !== "active"
  const getPrice = () => product.membershipPrice || product.basePrice || 0
  const getDiscountRate = () => {
    const base = product.basePrice || 0
    const member = product.membershipPrice || 0
    if (base > 0 && member > 0 && member < base) {
      return Math.round(((base - member) / base) * 100)
    }
    return 0
  }

  const getTotalQuantity = () => {
    const cartQuantity = selectedCartOptions.reduce(
      (sum, opt) => sum + opt.quantity,
      0
    )
    return isSingleOption ? cartQuantity + quantity : cartQuantity
  }

  const getTotalPrice = () => getTotalQuantity() * getPrice()

  // 핸들러
  const handleOptionChange = (optionLabel: string, value: string) => {
    const next = { ...selectedOptions, [optionLabel]: value }
    setSelectedOptions(next)

    const allSelected = (product.options ?? []).every((o) => !!next[o.label])
    if (!allSelected) return

    const optionName = (product.options ?? [])
      .map((o) => next[o.label])
      .join(" / ")

    setSelectedCartOptions((prev) => {
      const exists = prev.find((p) => p.name === optionName)
      if (exists) {
        return prev.map((p) =>
          p.name === optionName ? { ...p, quantity: p.quantity + 1 } : p
        )
      }
      return [
        ...prev,
        {
          id: `${product.id}-${Date.now()}`,
          name: optionName,
          quantity: 1,
          price: getPrice(),
          image: product.thumbnails?.[0] || product.thumbnail,
        },
      ]
    })

    setSelectedOptions({})
  }

  const handleQuantityUpdate = (id: string, newQuantity: number) => {
    if (newQuantity < 1) {
      setSelectedCartOptions(selectedCartOptions.filter((opt) => opt.id !== id))
    } else {
      setSelectedCartOptions(
        selectedCartOptions.map((opt) =>
          opt.id === id ? { ...opt, quantity: newQuantity } : opt
        )
      )
    }
  }

  const handleOptionRemove = (id: string) => {
    setSelectedCartOptions(selectedCartOptions.filter((opt) => opt.id !== id))
  }

  const handleAddToCart = () => {
    if (isSingleOption) {
      addToCart({ variantId: product.id, quantity })
      return
    }
    selectedCartOptions.forEach((option) => {
      addToCart({ variantId: product.id, quantity: option.quantity })
    })
  }

  const handleBuyNow = () => {
    if (selectedOptions && Object.keys(selectedOptions).length > 0) {
      handleAddToCart()
    }
    window.location.href = `/${countryCode}/checkout`
  }
  return (
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
              thumbnail={product.thumbnails?.[0]}
              quantity={quantity}
              onQuantityChange={setQuantity}
              price={getPrice()}
              stock={0}
              showTitle={true}
            />
          ) : (
            <ProductOptionSelector
              options={product.options || []}
              selectedOptions={selectedOptions}
              selectedCartOptions={selectedCartOptions}
              onOptionChange={handleOptionChange}
              onQuantityUpdate={handleQuantityUpdate}
              onOptionRemove={handleOptionRemove}
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
                onClick={handleAddToCart}
                disabled={isLoading}
              >
                {isLoading ? <Spinner size="sm" color="blue" /> : "장바구니"}
              </CustomButton>
              <CustomButton
                variant="fill"
                color="primary"
                size="lg"
                className="flex-1 cursor-pointer"
                onClick={handleBuyNow}
              >
                바로구매
              </CustomButton>
            </>
          )}
        </footer>
      </div>
    </aside>
  )
}
