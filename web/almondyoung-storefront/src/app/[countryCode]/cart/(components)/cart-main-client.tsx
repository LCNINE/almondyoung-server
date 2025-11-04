"use client"

import React, { useState, useMemo, useEffect } from "react"
import { CartItem, mockCartItems } from "../../../data/__mocks__/user-cart-mock"
import { CartHeader } from "./cart-header"
import { CartTabsMobile } from "./cart-tabs-mobile"
import { CartDesktopContent } from "./cart-desktop-content"
import { CartSummary } from "./cart-summary"
import { CartFooter } from "./cart-footer"
import { RecommendedProducts } from "./recommended-products"

export function CartMainClient() {
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [checkedItems, setCheckedItems] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [recommendedProducts, setRecommendedProducts] = useState<any[]>([])

  // 장바구니 데이터 로드
  useEffect(() => {
    const loadCart = async () => {
      setIsLoading(true)
      try {
        // TODO: 실제 API 호출로 교체 필요
        const items = mockCartItems.map((item: CartItem) => ({
          ...item,
          isSelected: false,
        }))
        setCartItems(items)
      } catch (error) {
        console.error("장바구니 로드 실패:", error)
        setCartItems([])
      } finally {
        setIsLoading(false)
      }
    }

    loadCart()
  }, [])

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

  const handleDeleteItem = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id))
    setCheckedItems((prev) => prev.filter((itemId) => itemId !== id))
  }

  const handleDeleteSelected = () => {
    if (checkedItems.length === 0) return
    setCartItems((prev) =>
      prev.filter((item) => !checkedItems.includes(item.id))
    )
    setCheckedItems([])
  }

  const handleQuantityChange = (id: string, newQuantity: number) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(1, newQuantity) } : item
      )
    )
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
