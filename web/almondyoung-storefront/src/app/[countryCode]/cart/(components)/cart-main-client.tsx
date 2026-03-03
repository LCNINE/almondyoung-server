"use client"

import React, { useState, useMemo, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
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
  createCheckoutCartFromLineItems,
  listCartShippingMethods,
  updateLineItem,
  deleteLineItem,
} from "@lib/api/medusa/cart"
import { getProductDetail } from "@lib/api/medusa/products"
import { transferCart } from "@lib/api/medusa/customer"
import type { HttpTypes } from "@medusajs/types"
import { toast } from "sonner"
import { CartPageSkeleton } from "@/components/skeletons/page-skeletons"
import { useMembershipPricing } from "@/hooks/use-membership-pricing"
import { deriveCartItemPricing } from "./cart-pricing"

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
  const selectedOptionText =
    Object.keys(selectedOptions).length > 0
      ? Object.entries(selectedOptions)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ")
      : typeof variant?.title === "string" &&
          variant.title.trim() &&
          variant.title !== "Default Variant"
        ? variant.title
        : undefined

  // 가격 정보
  const compareAtUnitPrice = item.compare_at_unit_price ?? null
  const originalTotal = item.original_total
  const derivedBasePrice =
    typeof originalTotal === "number" && item.quantity > 0
      ? Math.round(originalTotal / item.quantity)
      : item.unit_price || 0
  const basePrice =
    typeof compareAtUnitPrice === "number" && compareAtUnitPrice > 0
      ? compareAtUnitPrice
      : derivedBasePrice
  const rawMembershipPrice = (variant?.metadata as any)?.membershipPrice
  const parsedMembershipPrice =
    typeof rawMembershipPrice === "string" ? Number(rawMembershipPrice) : null
  const membershipPrice =
    typeof rawMembershipPrice === "number"
      ? rawMembershipPrice
      : Number.isFinite(parsedMembershipPrice)
        ? parsedMembershipPrice
        : null
  const normalizedMembershipPrice =
    membershipPrice != null && basePrice > membershipPrice
      ? membershipPrice
      : null
  const unitPrice = item.unit_price || basePrice
  const isMembershipOnly = (product?.metadata as any)?.isMembershipOnly || false

  // 재고 정보 추출
  const manageInventory = variant?.manage_inventory ?? false
  const inventoryQuantity = variant?.inventory_quantity ?? 0

  return {
    id: item.id,
    productId: product?.id || "",
    variantId: variant?.id || undefined,
    product: {
      name: item.title || product?.title || "상품명 없음",
      thumbnail: item.thumbnail || product?.thumbnail || "",
      basePrice,
      membershipPrice: normalizedMembershipPrice || undefined,
      unitPrice,
      brand: product?.subtitle || (product?.metadata as any)?.brand || "",
      isMembershipOnly,
    },
    selectedOptions,
    selectedOptionText,
    quantity: item.quantity,
    isSelected: true,
    manageInventory,
    inventoryQuantity,
  }
}

export function CartMainClient() {
  const router = useRouter()
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [checkedItems, setCheckedItems] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [recommendedProducts, setRecommendedProducts] = useState<any[]>([])
  const [shippingTotal, setShippingTotal] = useState<number>(0)
  const [cartId, setCartId] = useState<string | null>(null)
  const { isMembershipPricing } = useMembershipPricing()

  const getItemDisplayLabel = useCallback((item: CartItem) => {
    return item.selectedOptionText
      ? `${item.product.name} (${item.selectedOptionText})`
      : item.product.name
  }, [])

  const getEstimatedShippingTotal = useCallback(
    async (id: string) => {
      const options = await listCartShippingMethods(id, "no-store")
      const standard =
        options?.find((option) => option.type?.code === "standard") ??
        options?.[0]
      return standard?.amount ?? 0
    },
    [listCartShippingMethods]
  )

  // 장바구니 데이터 로드
  const loadCart = useCallback(async () => {
    // console.log("[장바구니] 로드 시작...")
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

      // console.log("[장바구니] API 응답:", cart)

      // 카트가 있지만 고객에게 연결되지 않은 경우 연결 시도
      if (cart && !cart.customer_id) {
        try {
          await transferCart()
          // console.log("[장바구니] 카트를 고객에게 연결 완료")
        } catch (error) {
          // 로그인 안 된 상태면 실패할 수 있음 - 무시
          // console.log("[장바구니] 카트 연결 스킵 (로그인 필요)")
        }
      }

      const updatedCart = cart

      if (updatedCart?.items && updatedCart.items.length > 0) {
        const items = updatedCart.items.map(mapMedusaItemToCartItem)

        // 상세와 동일 기준으로 variant 재고를 보정
        const productIds = Array.from(
          new Set(items.map((item) => item.productId).filter(Boolean))
        )
        const stockEntries = await Promise.all(
          productIds.map(async (productId) => {
            try {
              const detail = await getProductDetail(productId, updatedCart.region_id)
              const stockMap = new Map<
                string,
                { manageInventory: boolean; inventoryQuantity: number }
              >()
              for (const variant of detail.variants ?? []) {
                if (!variant?.id) continue
                const manageInventory = variant.manage_inventory ?? false
                const inventoryQuantity =
                  variant.manage_inventory === false
                    ? Number.POSITIVE_INFINITY
                    : (variant.inventory_quantity ?? 0)
                stockMap.set(variant.id, { manageInventory, inventoryQuantity })
              }
              return [productId, stockMap] as const
            } catch {
              return [productId, null] as const
            }
          })
        )
        const stockByProductId = new Map(stockEntries)
        const normalizedItems = items.map((item) => {
          const variantStock = item.variantId
            ? stockByProductId.get(item.productId)?.get(item.variantId)
            : undefined
          if (!variantStock) return item
          return {
            ...item,
            manageInventory: variantStock.manageInventory,
            inventoryQuantity: variantStock.inventoryQuantity,
          }
        })
        // 재고 초과 수량은 재고 수량으로 자동 조정
        const quantityAdjustments = normalizedItems
          .filter(
            (item) =>
              item.manageInventory &&
              Number.isFinite(item.inventoryQuantity) &&
              (item.inventoryQuantity ?? 0) > 0 &&
              item.quantity > (item.inventoryQuantity ?? 0)
          )
          .map((item) => ({
            lineId: item.id,
            quantity: item.inventoryQuantity as number,
          }))

        if (quantityAdjustments.length > 0) {
          await Promise.all(
            quantityAdjustments.map(({ lineId, quantity }) =>
              updateLineItem({ lineId, quantity }).catch(() => null)
            )
          )
        }

        const adjustedItems = normalizedItems.map((item) => {
          if (
            item.manageInventory &&
            Number.isFinite(item.inventoryQuantity) &&
            (item.inventoryQuantity ?? 0) > 0 &&
            item.quantity > (item.inventoryQuantity ?? 0)
          ) {
            return {
              ...item,
              quantity: item.inventoryQuantity as number,
            }
          }
          return item
        })

        if (quantityAdjustments.length > 0) {
          toast.info("재고를 반영해 장바구니 수량을 자동 조정했어요.")
        }

        // console.log("[장바구니] 매핑된 아이템:", adjustedItems)
        setCartItems(adjustedItems)
        
        // 품절되지 않은 아이템만 선택
        const availableItems = adjustedItems.filter((item) => {
          const isSoldOut = item.manageInventory && (item.inventoryQuantity ?? 0) <= 0
          return !isSoldOut
        })
        setCheckedItems(availableItems.map((item) => item.id))
        
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
        // console.log("[장바구니] 아이템 없음")
        setCartItems([])
        setCheckedItems([])
        setShippingTotal(updatedCart?.shipping_total ?? 0)
        setCartId(updatedCart?.id ?? null)
      }
    } catch (error) {
      // console.error("[장바구니] 로드 실패:", error)
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
        // console.error("추천 제품 로드 실패:", error)
        setRecommendedProducts([])
      }
    }

    loadRecommendedProducts()
  }, [])

  const handleCheckItem = (id: string, checked: boolean) => {
    const item = cartItems.find((item) => item.id === id)
    if (!item) return
    
    // 품절 상품은 체크할 수 없음
    const isSoldOut = item.manageInventory && (item.inventoryQuantity ?? 0) <= 0
    if (checked && isSoldOut) {
      toast.error("품절된 상품은 선택할 수 없습니다.")
      return
    }
    
    setCheckedItems((prev) =>
      checked ? [...prev, id] : prev.filter((itemId) => itemId !== id)
    )
  }

  const handleCheckAll = (checked: boolean) => {
    if (checked) {
      // 품절되지 않은 아이템만 선택
      const availableItems = cartItems.filter((item) => {
        const isSoldOut = item.manageInventory && (item.inventoryQuantity ?? 0) <= 0
        return !isSoldOut
      })
      setCheckedItems(availableItems.map((item) => item.id))
    } else {
      setCheckedItems([])
    }
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
      // console.error("상품 삭제 실패:", error)
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
      // console.error("선택 상품 삭제 실패:", error)
      toast.error("상품 삭제에 실패했습니다.")
      // 실패 시 다시 로드
      await loadCart()
    }
  }

  const handleQuantityChange = async (id: string, newQuantity: number) => {
    const targetItem = cartItems.find((item) => item.id === id)
    if (!targetItem) return

    let quantity = Math.max(1, newQuantity)
    if (
      targetItem.manageInventory &&
      Number.isFinite(targetItem.inventoryQuantity)
    ) {
      const maxQuantity = Math.max(
        0,
        Math.floor(targetItem.inventoryQuantity ?? 0)
      )
      if (maxQuantity <= 0) {
        toast.error("품절된 상품입니다.")
        return
      }
      if (quantity > maxQuantity) {
        quantity = maxQuantity
        toast.error(
          `${getItemDisplayLabel(targetItem)}은 ${maxQuantity}개 이하로 구매해주세요.`
        )
      }
    }

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
      const rawMessage = error instanceof Error ? error.message : ""

      let errorMessage = "수량 변경에 실패했습니다."
      if (rawMessage.includes("inventory")) {
        errorMessage = "재고가 부족합니다"
      } else if (rawMessage.includes("not found")) {
        errorMessage = "상품을 찾을 수 없습니다"
      }

      toast.error(errorMessage)

      // 실패 시 다시 로드
      await loadCart()
    }
  }

  const handleCheckout = useCallback(async () => {
    const selectedItems = cartItems.filter((item) => checkedItems.includes(item.id))

    if (selectedItems.length === 0) {
      toast.error("구매할 상품을 선택해주세요.")
      return false
    }

    const invalidItem = selectedItems.find(
      (item) =>
        item.manageInventory &&
        Number.isFinite(item.inventoryQuantity) &&
        item.quantity > (item.inventoryQuantity ?? 0)
    )

    if (invalidItem) {
      const maxQuantity = Math.max(
        0,
        Math.floor(invalidItem.inventoryQuantity ?? 0)
      )
      toast.error(
        `${getItemDisplayLabel(invalidItem)}은 ${maxQuantity}개 이하로 구매해주세요.`
      )
      return false
    }

    try {
      const result = await createCheckoutCartFromLineItems({
        countryCode,
        lineItemIds: selectedItems.map((item) => item.id),
      })

      if (!result?.cartId) {
        throw new Error("Checkout cart was not created")
      }

      router.push(`/${countryCode}/checkout?cartId=${result.cartId}`)
      return true
    } catch (error) {
      // console.error("체크아웃 처리 실패:", error)
      toast.error("체크아웃 처리 중 오류가 발생했습니다.")
      return false
    }
  }, [cartItems, checkedItems, countryCode, getItemDisplayLabel, router])

  // 가격 계산
  const {
    totalOriginalPrice,
    finalPrice,
    totalDiscount,
    membershipDiscount,
    membershipPreviewPrice,
    membershipPreviewSavings,
    selectedCount,
  } =
    useMemo(() => {
      const selected = cartItems.filter((item) =>
        checkedItems.includes(item.id)
      )

      let totalOriginalPrice = 0
      let finalPrice = 0
      let membershipPreviewPrice = 0
      let membershipDiscount = 0

      for (const item of selected) {
        const { quantity, baseUnitPrice, memberUnitPrice, displayUnitPrice } =
          deriveCartItemPricing(item, isMembershipPricing)

        totalOriginalPrice += baseUnitPrice * quantity
        finalPrice += displayUnitPrice * quantity
        membershipPreviewPrice += memberUnitPrice * quantity
        membershipDiscount += Math.max(
          0,
          (baseUnitPrice - memberUnitPrice) * quantity
        )
      }

      const membershipPreviewSavings = Math.max(
        0,
        totalOriginalPrice - membershipPreviewPrice
      )

      return {
        totalOriginalPrice,
        finalPrice,
        totalDiscount: 0,
        membershipDiscount: isMembershipPricing ? membershipDiscount : 0,
        membershipPreviewPrice,
        membershipPreviewSavings,
        selectedCount: selected.length,
      }
    }, [cartItems, checkedItems, isMembershipPricing])

  // 로딩 상태
  if (isLoading && cartItems.length === 0) {
    return <CartPageSkeleton />
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
                selectedTotal={finalPrice}
                onCheckAll={handleCheckAll}
                onDeleteSelected={handleDeleteSelected}
                onCheckItem={handleCheckItem}
                onDeleteItem={handleDeleteItem}
                onQuantityChange={handleQuantityChange}
                countryCode={countryCode}
              />

              {/* PC 버전 컨텐츠 */}
              <CartDesktopContent
                cartItems={cartItems}
                checkedItems={checkedItems}
                shippingTotal={shippingTotal}
                selectedTotal={finalPrice}
                onCheckAll={handleCheckAll}
                onDeleteSelected={handleDeleteSelected}
                onCheckItem={handleCheckItem}
                onDeleteItem={handleDeleteItem}
                onQuantityChange={handleQuantityChange}
                countryCode={countryCode}
              />
            </div>

            {/* PC 오른쪽 결제 정보 영역 */}
            <CartSummary
              totalOriginalPrice={totalOriginalPrice}
              totalDiscount={totalDiscount}
              membershipDiscount={membershipDiscount}
              membershipPreviewPrice={membershipPreviewPrice}
              membershipPreviewSavings={membershipPreviewSavings}
              shippingFee={shippingTotal}
              finalPrice={finalPrice}
              onCheckout={handleCheckout}
            />
          </div>

          {/* 추천 상품 영역 - 모바일에서만 표시 */}
          <RecommendedProducts products={recommendedProducts} />

          {/* 하단 고정 결제 영역 - 모바일에서만 표시 */}
          <CartFooter
            totalOriginalPrice={totalOriginalPrice}
            totalDiscount={totalDiscount}
            membershipDiscount={membershipDiscount}
            membershipPreviewPrice={membershipPreviewPrice}
            membershipPreviewSavings={membershipPreviewSavings}
            finalPrice={finalPrice}
            selectedCount={selectedCount}
            shippingFee={shippingTotal}
            onCheckout={handleCheckout}
          />
        </div>
      </main>
    </div>
  )
}
