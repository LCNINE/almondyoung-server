"use client"

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react"
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
  createShippingPreviewCartFromLineItems,
  syncShippingPreviewCartLineItems,
  getCartPricingForPreview,
  deleteShippingPreviewCart,
  updateLineItem,
  deleteLineItem,
} from "@lib/api/medusa/cart"
import { getProductDetail } from "@lib/api/medusa/products"
import { transferCart } from "@lib/api/medusa/customer"
import type { HttpTypes } from "@medusajs/types"
import { toast } from "sonner"
import { CartPageSkeleton } from "@/components/skeletons/page-skeletons"
import { isWelcomeMembershipProduct } from "@/lib/utils/welcome-membership"

function mapMedusaItemToCartItem(item: HttpTypes.StoreCartLineItem): CartItem {
  const variant = item.variant as any
  const product = item.product as any

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

  const unitPrice = item.unit_price || basePrice
  const isMembershipOnly = (product?.metadata as any)?.isMembershipOnly || false
  const isWelcomeMembership = isWelcomeMembershipProduct((product as any)?.tags)

  const manageInventory = variant?.manage_inventory ?? false
  const inventoryQuantity = variant?.inventory_quantity ?? 0

  return {
    id: item.id,
    productId: product?.id || "",
    productHandle: product?.handle || undefined,
    variantId: variant?.id || undefined,
    product: {
      name: item.title || product?.title || "상품명 없음",
      thumbnail: item.thumbnail || product?.thumbnail || "",
      basePrice,
      membershipPrice: undefined,
      unitPrice,
      brand: product?.subtitle || (product?.metadata as any)?.brand || "",
      isMembershipOnly,
      isWelcomeMembership,
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
  const [selectedPricing, setSelectedPricing] = useState({
    originalItemSubtotal: 0,
    itemSubtotal: 0,
    total: 0,
    membershipDiscount: 0,
    nonMembershipDiscount: 0,
  })

  const previewCartIdRef = useRef<string | null>(null)
  const previewRequestSeqRef = useRef(0)

  const getItemDisplayLabel = useCallback((item: CartItem) => {
    return item.selectedOptionText
      ? `${item.product.name} (${item.selectedOptionText})`
      : item.product.name
  }, [])

  const getLocalPricingFromItems = useCallback((items: CartItem[]) => {
    const originalItemSubtotal = items.reduce((sum, item) => {
      const quantity = item.quantity || 1
      const baseUnitPrice =
        item.product.basePrice || item.product.unitPrice || 0
      return sum + baseUnitPrice * quantity
    }, 0)

    const itemSubtotal = items.reduce((sum, item) => {
      const quantity = item.quantity || 1
      const displayUnitPrice =
        item.product.unitPrice || item.product.basePrice || 0
      return sum + displayUnitPrice * quantity
    }, 0)

    const membershipDiscount = Math.max(0, originalItemSubtotal - itemSubtotal)

    return {
      originalItemSubtotal,
      itemSubtotal,
      total: itemSubtotal,
      membershipDiscount,
      nonMembershipDiscount: 0,
    }
  }, [])

  const loadCart = useCallback(async () => {
    setIsLoading(true)

    try {
      const CART_FIELDS =
        "*items, *region, *items.product, *items.product.tags, *items.variant, +items.variant.inventory_quantity, +items.variant.manage_inventory, *items.thumbnail, *items.metadata, +items.total, +items.original_total, +items.compare_at_unit_price, *promotions, +shipping_methods, *customer, *customer.groups, customer_id, +payment_collection.id, +currency_code, +item_subtotal, +shipping_total, +total, +discount_subtotal, +original_item_subtotal, +original_item_total"

      let cart = await retrieveCart(undefined, CART_FIELDS, "no-store")

      if (!cart) {
        const ensuredCart = await getOrSetCart(countryCode)
        if (ensuredCart?.id) {
          cart = await retrieveCart(ensuredCart.id, CART_FIELDS, "no-store")
        }
      }

      if (cart && !cart.customer_id) {
        try {
          await transferCart()
          if (cart.id) {
            const transferredCart = await retrieveCart(
              cart.id,
              CART_FIELDS,
              "no-store"
            )
            if (transferredCart) {
              cart = transferredCart
            }
          }
        } catch {
          // unauthenticated users can fail here safely
        }
      }

      const updatedCart = cart

      if (updatedCart?.items && updatedCart.items.length > 0) {
        const items = updatedCart.items.map(mapMedusaItemToCartItem)

        const productIds = Array.from(
          new Set(items.map((item) => item.productId).filter(Boolean))
        )

        const stockEntries = await Promise.all(
          productIds.map(async (productId) => {
            try {
              const detail = await getProductDetail(
                productId,
                updatedCart.region_id
              )
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

        setCartItems(adjustedItems)

        const availableItems = adjustedItems.filter((item) => {
          const isSoldOut =
            item.manageInventory && (item.inventoryQuantity ?? 0) <= 0
          return !isSoldOut
        })
        setCheckedItems(availableItems.map((item) => item.id))
      } else {
        setCartItems([])
        setCheckedItems([])
        setShippingTotal(0)
        setSelectedPricing({
          originalItemSubtotal: 0,
          itemSubtotal: 0,
          total: 0,
          membershipDiscount: 0,
          nonMembershipDiscount: 0,
        })
      }
    } catch {
      setCartItems([])
      setCheckedItems([])
      setShippingTotal(0)
      setSelectedPricing({
        originalItemSubtotal: 0,
        itemSubtotal: 0,
        total: 0,
        membershipDiscount: 0,
        nonMembershipDiscount: 0,
      })
    } finally {
      setIsLoading(false)
    }
  }, [countryCode])

  useEffect(() => {
    loadCart()
  }, [loadCart])

  useEffect(() => {
    const loadRecommendedProducts = async () => {
      try {
        setRecommendedProducts([])
      } catch {
        setRecommendedProducts([])
      }
    }

    loadRecommendedProducts()
  }, [])

  useEffect(() => {
    const selected = cartItems.filter((item) => checkedItems.includes(item.id))

    if (!selected.length) {
      setShippingTotal(0)
      setSelectedPricing({
        originalItemSubtotal: 0,
        itemSubtotal: 0,
        total: 0,
        membershipDiscount: 0,
        nonMembershipDiscount: 0,
      })
      return
    }

    // 프리뷰 카트 API 응답 전에도 로컬 계산값을 즉시 반영
    // 메두사 주문예상금액이 너무 늦게 반영돼서 일단 로컬 계산값 보여주고 나중에 업데이트하게
    const localPricing = getLocalPricingFromItems(selected)
    setSelectedPricing(localPricing)

    const selectedLineItemIds = selected.map((item) => item.id)
    const selectedPreviewItems = selected
      .filter((item) => item.variantId)
      .map((item) => ({
        sourceLineItemId: item.id,
        variantId: item.variantId as string,
        quantity: item.quantity,
      }))

    if (!selectedPreviewItems.length) {
      setShippingTotal(0)
      setSelectedPricing({
        originalItemSubtotal: 0,
        itemSubtotal: 0,
        total: 0,
        membershipDiscount: 0,
        nonMembershipDiscount: 0,
      })
      return
    }

    const requestSeq = ++previewRequestSeqRef.current
    const timer = setTimeout(async () => {
      try {
        let previewCartId = previewCartIdRef.current

        const createPreviewCart = async () => {
          const created = await createShippingPreviewCartFromLineItems({
            countryCode,
            lineItemIds: selectedLineItemIds,
          })
          previewCartId = created.cartId
          previewCartIdRef.current = previewCartId
        }

        try {
          if (!previewCartId) {
            await createPreviewCart()
          } else {
            await syncShippingPreviewCartLineItems({
              previewCartId,
              items: selectedPreviewItems,
            })
          }
        } catch {
          previewCartIdRef.current = null
          await createPreviewCart()
        }

        const pricing = await getCartPricingForPreview(previewCartId!)

        if (previewRequestSeqRef.current === requestSeq) {
          setShippingTotal(pricing.shippingTotal)
          setSelectedPricing({
            originalItemSubtotal: pricing.originalItemSubtotal,
            itemSubtotal: pricing.itemSubtotal,
            total: pricing.total,
            membershipDiscount: pricing.membershipDiscount,
            nonMembershipDiscount: pricing.nonMembershipDiscount,
          })
        }
      } catch {
        previewCartIdRef.current = null
        // 실패 시에도 직전 로컬 계산값은 유지
      }
    }, 80)

    return () => {
      clearTimeout(timer)
    }
  }, [cartItems, checkedItems, countryCode, getLocalPricingFromItems])

  useEffect(() => {
    return () => {
      const previewCartId = previewCartIdRef.current
      if (!previewCartId) return
      void deleteShippingPreviewCart(previewCartId)
      previewCartIdRef.current = null
    }
  }, [])

  const handleCheckItem = (id: string, checked: boolean) => {
    const item = cartItems.find((row) => row.id === id)
    if (!item) return

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
      const availableItems = cartItems.filter((item) => {
        const isSoldOut =
          item.manageInventory && (item.inventoryQuantity ?? 0) <= 0
        return !isSoldOut
      })
      setCheckedItems(availableItems.map((item) => item.id))
      return
    }

    setCheckedItems([])
  }

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteLineItem(id)
      setCartItems((prev) => prev.filter((item) => item.id !== id))
      setCheckedItems((prev) => prev.filter((itemId) => itemId !== id))
      toast.success("상품이 삭제되었습니다.")
    } catch {
      toast.error("상품 삭제에 실패했습니다.")
    }
  }

  const handleDeleteSelected = async () => {
    if (checkedItems.length === 0) return

    try {
      await Promise.all(checkedItems.map((id) => deleteLineItem(id)))
      setCartItems((prev) =>
        prev.filter((item) => !checkedItems.includes(item.id))
      )
      setCheckedItems([])
      toast.success("선택한 상품이 삭제되었습니다.")
    } catch {
      toast.error("상품 삭제에 실패했습니다.")
      await loadCart()
    }
  }

  const handleQuantityChange = async (id: string, newQuantity: number) => {
    const targetItem = cartItems.find((item) => item.id === id)
    if (!targetItem) return

    if (targetItem.product.isWelcomeMembership && newQuantity > 1) {
      toast.error("웰컴 멤버십 상품은 1개만 구매 가능합니다")
      return
    }

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

    setCartItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity } : item))
    )

    try {
      await updateLineItem({ lineId: id, quantity })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : ""

      let errorMessage = "수량 변경에 실패했습니다."
      if (rawMessage.includes("inventory")) {
        errorMessage = "재고가 부족합니다"
      } else if (rawMessage.includes("not found")) {
        errorMessage = "상품을 찾을 수 없습니다"
      }

      toast.error(errorMessage)
      await loadCart()
    }
  }

  const handleCheckout = useCallback(async () => {
    const selectedItems = cartItems.filter((item) =>
      checkedItems.includes(item.id)
    )

    if (selectedItems.length === 0) {
      toast.error("구매할 상품을 선택해주세요.")
      return false
    }

    // 웰컴 멤버십 상품은 1개만 주문 가능
    const welcomeMembershipTotal = selectedItems
      .filter((item) => item.product.isWelcomeMembership)
      .reduce((sum, item) => sum + item.quantity, 0)

    if (welcomeMembershipTotal > 1) {
      toast.error("웰컴 멤버십 상품은 1개만 구매 가능합니다")
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

      if (previewCartIdRef.current) {
        void deleteShippingPreviewCart(previewCartIdRef.current)
        previewCartIdRef.current = null
      }

      router.push(`/${countryCode}/checkout?cartId=${result.cartId}`)
      return true
    } catch {
      toast.error("체크아웃 처리 중 오류가 발생했습니다.")
      return false
    }
  }, [cartItems, checkedItems, countryCode, getItemDisplayLabel, router])

  const {
    totalOriginalPrice,
    finalPrice,
    totalDiscount,
    membershipDiscount,
    selectedCount,
  } = useMemo(() => {
    const selected = cartItems.filter((item) => checkedItems.includes(item.id))
    const fallbackMembershipDiscount = selected.reduce((sum, item) => {
      const quantity = item.quantity || 1
      const baseUnitPrice =
        item.product.basePrice || item.product.unitPrice || 0
      const displayUnitPrice = item.product.unitPrice || baseUnitPrice
      return sum + Math.max(0, (baseUnitPrice - displayUnitPrice) * quantity)
    }, 0)

    const membershipDiscount = Math.max(
      selectedPricing.membershipDiscount,
      fallbackMembershipDiscount
    )
    const totalOriginalPrice = Math.max(
      selectedPricing.originalItemSubtotal,
      selectedPricing.itemSubtotal + membershipDiscount
    )
    const totalDiscountAll = Math.max(
      0,
      totalOriginalPrice + shippingTotal - selectedPricing.total
    )
    const nonMembershipDiscount = Math.max(
      0,
      totalDiscountAll - membershipDiscount
    )

    return {
      totalOriginalPrice,
      finalPrice: Math.max(0, selectedPricing.total - shippingTotal),
      totalDiscount: nonMembershipDiscount,
      membershipDiscount,
      selectedCount: checkedItems.length,
    }
  }, [cartItems, checkedItems, selectedPricing, shippingTotal])

  if (isLoading && cartItems.length === 0) {
    return <CartPageSkeleton />
  }

  return (
    <div className="page-wrapper">
      <main className="main-container min-h-screen w-full bg-white lg:bg-white">
        <div className="main-inner md:mx-auto md:max-w-[1280px] md:px-8">
          <CartHeader />

          <div className="md:flex md:gap-6">
            <div className="md:flex-1">
              <CartTabsMobile
                cartItems={cartItems}
                checkedItems={checkedItems}
                shippingTotal={shippingTotal}
                selectedTotal={selectedPricing.itemSubtotal}
                onCheckAll={handleCheckAll}
                onDeleteSelected={handleDeleteSelected}
                onCheckItem={handleCheckItem}
                onDeleteItem={handleDeleteItem}
                onQuantityChange={handleQuantityChange}
                countryCode={countryCode}
              />

              <CartDesktopContent
                cartItems={cartItems}
                checkedItems={checkedItems}
                shippingTotal={shippingTotal}
                selectedTotal={selectedPricing.itemSubtotal}
                onCheckAll={handleCheckAll}
                onDeleteSelected={handleDeleteSelected}
                onCheckItem={handleCheckItem}
                onDeleteItem={handleDeleteItem}
                onQuantityChange={handleQuantityChange}
                countryCode={countryCode}
              />
            </div>

            <CartSummary
              totalOriginalPrice={totalOriginalPrice}
              totalDiscount={totalDiscount}
              membershipDiscount={membershipDiscount}
              shippingFee={shippingTotal}
              finalPrice={finalPrice}
              onCheckout={handleCheckout}
            />
          </div>

          <RecommendedProducts products={recommendedProducts} />

          <CartFooter
            totalOriginalPrice={totalOriginalPrice}
            totalDiscount={totalDiscount}
            membershipDiscount={membershipDiscount}
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
