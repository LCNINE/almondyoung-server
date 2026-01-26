"use client"

import React, { useState, useMemo, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import type { CartItem } from "@lib/types/ui/cart"
import { CartHeader } from "./cart-header"
import { CartTabsMobile } from "./cart-tabs-mobile"
import { CartDesktopContent } from "./cart-desktop-content"
import { CartSummary } from "./cart-summary"
import { CartFooter } from "./cart-footer"
import { RecommendedProducts } from "./recommended-products"
import {
  retrieveCart,
  getOrSetCart,
  listCartShippingMethods,
  updateLineItem,
  deleteLineItem,
} from "@lib/api/medusa/cart"
import { transferCart } from "@lib/api/medusa/customer"
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
  const membershipPrice = (variant?.metadata as any)?.membershipPrice || null
  const isMembershipOnly = (product?.metadata as any)?.isMembershipOnly || false

  return {
    id: item.id,
    productId: product?.id || "",
    product: {
      name: item.title || product?.title || "상품명 없음",
      thumbnail: item.thumbnail || product?.thumbnail || "",
      basePrice,
      membershipPrice: membershipPrice || basePrice,
      brand: product?.subtitle || (product?.metadata as any)?.brand || "",
      isMembershipOnly,
    },
    selectedOptions,
    quantity: item.quantity,
    isSelected: true,
  }
}

export function CartMainClient() {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [checkedItems, setCheckedItems] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [recommendedProducts, setRecommendedProducts] = useState<any[]>([])
  const [shippingTotal, setShippingTotal] = useState<number>(0)
  const [cartId, setCartId] = useState<string | null>(null)

  const getEstimatedShippingTotal = useCallback(async (id: string) => {
    const options = await listCartShippingMethods(id, "no-store")
    const standard =
      options?.find((option) => option.type?.code === "standard") ??
      options?.[0]
    return standard?.amount ?? 0
  }, [listCartShippingMethods])

  // 장바구니 데이터 로드
  const loadCart = useCallback(async () => {
    console.log("[장바구니] 로드 시작...")
    setIsLoading(true)
    try {
      // customer_id도 함께 조회
      let cart = await retrieveCart(undefined, undefined, "no-store")

      if (!cart) {
        const ensuredCart = await getOrSetCart(countryCode)
        if (ensuredCart?.id) {
          cart = await retrieveCart(ensuredCart.id, undefined, "no-store")
        }
      }

      console.log("[장바구니] API 응답:", cart)

      // 카트가 있지만 고객에게 연결되지 않은 경우 연결 시도
      if (cart && !cart.customer_id) {
        try {
          await transferCart()
          console.log("[장바구니] 카트를 고객에게 연결 완료")
        } catch (error) {
          // 로그인 안 된 상태면 실패할 수 있음 - 무시
          console.log("[장바구니] 카트 연결 스킵 (로그인 필요)")
        }
      }

      const updatedCart = cart

      if (updatedCart?.items && updatedCart.items.length > 0) {
        const items = updatedCart.items.map(mapMedusaItemToCartItem)
        console.log("[장바구니] 매핑된 아이템:", items)
        setCartItems(items)
        // 기본으로 모든 아이템 선택
        setCheckedItems(items.map((item) => item.id))
        if (updatedCart.id) {
          const estimatedShipping = await getEstimatedShippingTotal(
            updatedCart.id
          )
          setShippingTotal(estimatedShipping)
        } else {
          setShippingTotal(updatedCart.shipping_total ?? 0)
        }
        setCartId(updatedCart.id)
      } else {
        console.log("[장바구니] 아이템 없음")
        setCartItems([])
        setCheckedItems([])
        setShippingTotal(updatedCart?.shipping_total ?? 0)
        setCartId(updatedCart?.id ?? null)
      }
    } catch (error) {
      console.error("[장바구니] 로드 실패:", error)
      setCartItems([])
      setCheckedItems([])
      setShippingTotal(0)
      setCartId(null)
    } finally {
      setIsLoading(false)
    }
  }, [countryCode, getEstimatedShippingTotal])

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
    try {
      await deleteLineItem(id)
      setCartItems((prev) => prev.filter((item) => item.id !== id))
      setCheckedItems((prev) => prev.filter((itemId) => itemId !== id))
      if (cartId) {
        const estimatedShipping = await getEstimatedShippingTotal(cartId)
        setShippingTotal(estimatedShipping)
      }
      toast.success("상품이 삭제되었습니다.")
    } catch (error) {
      console.error("상품 삭제 실패:", error)
      toast.error("상품 삭제에 실패했습니다.")
    }
  }

  const handleDeleteSelected = async () => {
    if (checkedItems.length === 0) return
    try {
      // 선택된 아이템들 순차 삭제
      await Promise.all(checkedItems.map((id) => deleteLineItem(id)))
      setCartItems((prev) =>
        prev.filter((item) => !checkedItems.includes(item.id))
      )
      setCheckedItems([])
      if (cartId) {
        const estimatedShipping = await getEstimatedShippingTotal(cartId)
        setShippingTotal(estimatedShipping)
      }
      toast.success("선택한 상품이 삭제되었습니다.")
    } catch (error) {
      console.error("선택 상품 삭제 실패:", error)
      toast.error("상품 삭제에 실패했습니다.")
      // 실패 시 다시 로드
      await loadCart()
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
      if (cartId) {
        const estimatedShipping = await getEstimatedShippingTotal(cartId)
        setShippingTotal(estimatedShipping)
      }
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
    return {
      totalOriginalPrice,
      finalPrice,
      totalDiscount: totalOriginalPrice - finalPrice,
      selectedCount: selected.length,
    }
  }, [cartItems, checkedItems])

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
                shippingTotal={shippingTotal}
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
                shippingTotal={shippingTotal}
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
              shippingFee={shippingTotal}
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
            shippingFee={shippingTotal}
          />
        </div>
      </main>
    </div>
  )
}
