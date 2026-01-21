"use client"

import React, { useState, useMemo, useEffect, useCallback } from "react"
import type { CartItem } from "@lib/types/ui/cart"
import { CartHeader } from "./cart-header"
import { CartTabsMobile } from "./cart-tabs-mobile"
import { CartDesktopContent } from "./cart-desktop-content"
import { CartSummary } from "./cart-summary"
import { CartFooter } from "./cart-footer"
import { RecommendedProducts } from "./recommended-products"
import {
  retrieveCart,
  updateLineItem,
  deleteLineItem,
} from "@lib/api/medusa/cart"
import type { HttpTypes } from "@medusajs/types"
import { toast } from "sonner"

/**
 * 메두사 장바구니 아이템을 UI용 CartItem으로 변환
 */
function mapMedusaItemToCartItem(item: HttpTypes.StoreCartLineItem): CartItem {
  const variant = item.variant as any
  const product = item.product as any

  // 옵션 정보 추출
  const selectedOptions: Record<string, string> = {}
  if (variant?.options) {
    for (const opt of variant.options) {
      const optionTitle = opt.option?.title || opt.option_id || "옵션"
      selectedOptions[optionTitle] = opt.value
    }
  }

  // 가격 정보
  const basePrice = item.unit_price || 0
  const membershipPrice = (variant?.metadata as any)?.membershipPrice || basePrice

  return {
    id: item.id,
    productId: product?.id || "",
    product: {
      name: item.title || product?.title || "상품명 없음",
      thumbnail: item.thumbnail || product?.thumbnail || "",
      basePrice,
      membershipPrice,
      brand: product?.subtitle || (product?.metadata as any)?.brand || "",
      isMembershipOnly: false,
    },
    selectedOptions,
    quantity: item.quantity,
    isSelected: true,
  }
}

export function CartMainClient() {
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [checkedItems, setCheckedItems] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const [recommendedProducts, setRecommendedProducts] = useState<any[]>([])

  // 장바구니 데이터 로드
  const loadCart = useCallback(async () => {
    setIsLoading(true)
    try {
      const cart = await retrieveCart()
      if (cart?.items && cart.items.length > 0) {
        const items = cart.items.map(mapMedusaItemToCartItem)
        setCartItems(items)
        // 기본으로 모든 아이템 선택
        setCheckedItems(items.map((item) => item.id))
      } else {
        setCartItems([])
        setCheckedItems([])
      }
    } catch (error) {
      console.error("장바구니 로드 실패:", error)
      setCartItems([])
      setCheckedItems([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCart()
  }, [loadCart])

  // 추천 제품 로드
  useEffect(() => {
    const loadRecommendedProducts = async () => {
      try {
        // TODO: 실제 추천 제품 API 호출로 교체 필요
        setRecommendedProducts([])
      } catch (error) {
        console.error("추천 제품 로드 실패:", error)
        setRecommendedProducts([])
      }
    }

    loadRecommendedProducts()
  }, [])

  const handleCheckItem = (id: string, checked: boolean) => {
    setCheckedItems((prev) =>
      checked ? [...prev, id] : prev.filter((itemId) => itemId !== id)
    )
  }

  const handleCheckAll = (checked: boolean) => {
    setCheckedItems(checked ? cartItems.map((item) => item.id) : [])
  }

  const handleDeleteItem = async (id: string) => {
    setIsUpdating(true)
    try {
      await deleteLineItem(id)
      setCartItems((prev) => prev.filter((item) => item.id !== id))
      setCheckedItems((prev) => prev.filter((itemId) => itemId !== id))
      toast.success("상품이 삭제되었습니다.")
    } catch (error) {
      console.error("상품 삭제 실패:", error)
      toast.error("상품 삭제에 실패했습니다.")
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDeleteSelected = async () => {
    if (checkedItems.length === 0) return
    setIsUpdating(true)
    try {
      // 선택된 아이템들 순차 삭제
      await Promise.all(checkedItems.map((id) => deleteLineItem(id)))
      setCartItems((prev) =>
        prev.filter((item) => !checkedItems.includes(item.id))
      )
      setCheckedItems([])
      toast.success("선택한 상품이 삭제되었습니다.")
    } catch (error) {
      console.error("선택 상품 삭제 실패:", error)
      toast.error("상품 삭제에 실패했습니다.")
      // 실패 시 다시 로드
      await loadCart()
    } finally {
      setIsUpdating(false)
    }
  }

  const handleQuantityChange = async (id: string, newQuantity: number) => {
    const quantity = Math.max(1, newQuantity)

    // 낙관적 업데이트
    setCartItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity } : item))
    )

    try {
      await updateLineItem({ lineId: id, quantity })
    } catch (error) {
      console.error("수량 변경 실패:", error)
      toast.error("수량 변경에 실패했습니다.")
      // 실패 시 다시 로드
      await loadCart()
    }
  }

  // 가격 계산
  const {
    totalOriginalPrice,
    finalPrice,
    totalDiscount,
    selectedCount,
    shippingFee,
  } = useMemo(() => {
    const selected = cartItems.filter((item) => checkedItems.includes(item.id))

    const totalOriginalPrice = selected.reduce(
      (sum, item) => sum + (item.product.basePrice || 0) * item.quantity,
      0
    )
    const finalPrice = selected.reduce(
      (sum, item) =>
        sum +
        (item.product.membershipPrice || item.product.basePrice || 0) *
          item.quantity,
      0
    )
    const shippingFee = finalPrice >= 50000 ? 0 : 3000

    return {
      totalOriginalPrice,
      finalPrice,
      totalDiscount: totalOriginalPrice - finalPrice,
      selectedCount: selected.length,
      shippingFee,
    }
  }, [cartItems, checkedItems])

  // 무료배송까지 남은 금액 계산
  const remainingForFreeShipping = Math.max(0, 50000 - finalPrice)
  const freeShippingProgress = Math.min(100, (finalPrice / 50000) * 100)

  // 로딩 상태
  if (isLoading) {
    return (
      <div className="page-wrapper">
        <main className="main-container min-h-screen w-full bg-white lg:bg-white">
          <div className="main-inner md:mx-auto md:max-w-[1280px] md:px-8">
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-orange-500"></div>
                <p className="text-gray-600">장바구니를 불러오는 중...</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="page-wrapper">
      <main className="main-container min-h-screen w-full bg-white lg:bg-white">
        <div className="main-inner md:mx-auto md:max-w-[1280px] md:px-8">
          {/* PC 헤더 영역 */}
          <CartHeader />

          <div className="md:flex md:gap-6">
            {/* 메인 컨텐츠 영역 */}
            <div className="md:flex-1">
              {/* 탭 네비게이션 영역 - 모바일에서만 표시 */}
              <CartTabsMobile
                cartItems={cartItems}
                checkedItems={checkedItems}
                remainingForFreeShipping={remainingForFreeShipping}
                freeShippingProgress={freeShippingProgress}
                onCheckAll={handleCheckAll}
                onDeleteSelected={handleDeleteSelected}
                onCheckItem={handleCheckItem}
                onDeleteItem={handleDeleteItem}
                onQuantityChange={handleQuantityChange}
              />

              {/* PC 버전 컨텐츠 */}
              <CartDesktopContent
                cartItems={cartItems}
                checkedItems={checkedItems}
                remainingForFreeShipping={remainingForFreeShipping}
                freeShippingProgress={freeShippingProgress}
                onCheckAll={handleCheckAll}
                onDeleteSelected={handleDeleteSelected}
                onCheckItem={handleCheckItem}
                onDeleteItem={handleDeleteItem}
                onQuantityChange={handleQuantityChange}
              />
            </div>

            {/* PC 오른쪽 결제 정보 영역 */}
            <CartSummary
              totalOriginalPrice={totalOriginalPrice}
              totalDiscount={totalDiscount}
              shippingFee={shippingFee}
              finalPrice={finalPrice}
              selectedCount={selectedCount}
            />
          </div>

          {/* 추천 상품 영역 - 모바일에서만 표시 */}
          <RecommendedProducts products={recommendedProducts} />

          {/* 하단 고정 결제 영역 - 모바일에서만 표시 */}
          <CartFooter
            totalOriginalPrice={totalOriginalPrice}
            totalDiscount={totalDiscount}
            finalPrice={finalPrice}
            selectedCount={selectedCount}
          />
        </div>
      </main>
    </div>
  )
}
