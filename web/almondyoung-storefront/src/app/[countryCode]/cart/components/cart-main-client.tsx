"use client"

import React, { useState, useMemo, useEffect } from "react"
import type { CartItem } from "@lib/types/ui/cart"
import { getAllCategories } from "@lib/services/pim/category/getCategoryService"
import { ProductCard } from "@lib/types/ui/product"
import { CartHeader } from "./cart-header"
import { CartTabsMobile } from "./cart-tabs-mobile"
import { CartDesktopContent } from "./cart-desktop-content"
import { CartSummary } from "./cart-summary"
import { CartFooter } from "./cart-footer"
import { RecommendedProducts } from "./recommended-products"

interface CartMainClientProps {
  user: any
  isLoggedIn: boolean
}

export function CartMainClient({ user, isLoggedIn }: CartMainClientProps) {
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [checkedItems, setCheckedItems] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [recommendedProducts, setRecommendedProducts] = useState<any[]>([])

  // 사용자 장바구니 데이터 로드
  useEffect(() => {
    const loadUserCart = async () => {
      setIsLoading(true)
      try {
        if (isLoggedIn && user) {
          console.log("사용자 장바구니 로드:", user.name)
          // TODO: 실제 장바구니 API 연동 필요
          setCartItems([])
        } else {
          // 비로그인 상태에서는 빈 장바구니
          console.log("비로그인 상태, 빈 장바구니")
          setCartItems([])
        }
      } catch (error) {
        console.error("장바구니 로드 실패:", error)
        setCartItems([])
      } finally {
        setIsLoading(false)
      }
    }

    loadUserCart()
  }, [isLoggedIn, user])

  // 사용자 전문 분야에 맞는 추천 제품들
  useEffect(() => {
    const loadRecommendedProducts = async () => {
      if (!user?.shop?.categories?.length) {
        setRecommendedProducts([])
        return
      }

      try {
        // 실제 카테고리 목록에서 속눈썹 카테고리 ID 찾기
        const categoriesResponse = await getAllCategories()

        const findEyelashCategory = (categories: any[]): string => {
          for (const category of categories) {
            if (
              category.name?.toLowerCase().includes("속눈썹") ||
              category.name?.toLowerCase().includes("eyelash") ||
              category.name?.toLowerCase().includes("lash")
            ) {
              return category.id
            }
            if (category.children) {
              const found = findEyelashCategory(category.children)
              if (found) return found
            }
          }
          return ""
        }

        const specialtyCategoryId =
          findEyelashCategory(
            Array.isArray(categoriesResponse)
              ? categoriesResponse
              : (categoriesResponse as any).categories || []
          ) || "01999bee-bf43-704d-a367-2b49c14c38f2"

        // 실제 API에서 추천 제품들 가져오기 (장바구니에 없는 제품들)
        const products: ProductCard[] = [] // 임시로 빈 배열

        // PimProduct를 추천 제품 형식으로 변환
        const recommendations = products.map((product: ProductCard) => ({
          id: product.id,
          image: product.thumbnail || "",
          name: product.name,
          price: product.basePrice || 0,
          membershipPrice: product.membershipPrice || 0,
          discountRate: product.basePrice || 0, // todo: 정확한 타입 확인해봐야함
          rating: 4.5,
          reviewCount: Math.floor(Math.random() * 200) + 50,
          isSoldOut: false,
        }))

        setRecommendedProducts(recommendations)
      } catch (error) {
        console.error("추천 제품 로드 실패:", error)
        setRecommendedProducts([])
      }
    }

    loadRecommendedProducts()
  }, [user?.shop?.categories])

  const handleCheckItem = (id: string, checked: boolean) => {
    console.log("체크박스 변경:", id, checked)
    setCheckedItems((prev) => {
      if (checked) {
        const newChecked = prev.includes(id) ? prev : [...prev, id]
        console.log("새로운 선택된 아이템들:", newChecked)
        return newChecked
      } else {
        const newChecked = prev.filter((itemId) => itemId !== id)
        console.log("새로운 선택된 아이템들:", newChecked)
        return newChecked
      }
    })
  }

  const handleCheckAll = (checked: boolean) => {
    if (checked) {
      setCheckedItems(cartItems.map((item) => item.id))
    } else {
      setCheckedItems([])
    }
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
    console.log("수량 변경:", id, "새 수량:", newQuantity)
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const updatedItem = { ...item, quantity: Math.max(1, newQuantity) }
          console.log("업데이트된 아이템:", updatedItem)
          return updatedItem
        }
        return item
      })
    )
  }

  // --- 계산 ---
  const {
    totalOriginalPrice,
    finalPrice,
    totalDiscount,
    selectedCount,
    shippingFee,
  } = useMemo(() => {
    const selected = cartItems.filter((item) => checkedItems.includes(item.id))

    console.log("=== 장바구니 계산 디버깅 ===")
    console.log("전체 장바구니 아이템:", cartItems.length)
    console.log("선택된 아이템 ID들:", checkedItems)
    console.log("선택된 아이템들:", selected.length)

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
    // 50,000원 이상 무료배송
    const shippingFee = finalPrice >= 50000 ? 0 : 3000

    console.log("원가 총합:", totalOriginalPrice)
    console.log("최종 가격:", finalPrice)
    console.log("배송비:", shippingFee)
    console.log("선택된 아이템 수:", selected.length)

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
