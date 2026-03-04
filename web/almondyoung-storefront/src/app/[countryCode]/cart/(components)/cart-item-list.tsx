"use client"

import React from "react"
import { CartCard } from "@components/cart/cart-cards"
import type { CartItem } from "@lib/types/ui/cart"
import { useMembershipPricing } from "@/hooks/use-membership-pricing"
import { deriveCartItemPricing } from "./cart-pricing"

interface CartItemListProps {
  items: CartItem[]
  checkedItems: string[]
  onCheckChange: (id: string, checked: boolean) => void
  onDelete: (id: string) => void
  onQuantityChange: (id: string, quantity: number) => void
  variant?: "mobile" | "desktop"
  countryCode?: string
}

export function CartItemList({
  items,
  checkedItems,
  onCheckChange,
  onDelete,
  onQuantityChange,
  variant = "mobile",
  countryCode = "kr",
}: CartItemListProps) {
  const { isMembershipPricing } = useMembershipPricing()
  const isMember = isMembershipPricing

  if (variant === "mobile") {
    return (
      <section
        className="cart-items"
        role="region"
        aria-label="장바구니 상품 목록"
      >
        <div className="items-container">
          {items.map((item) => {
            const {
              baseUnitPrice,
              hasMembershipPrice,
              displayUnitPrice,
              quantity,
              isMembershipApplied,
              discountRate,
            } = deriveCartItemPricing(item, isMember)
            const showMembershipHint = !isMember && hasMembershipPrice

            return (
              <CartCard
                key={item.id}
                checked={checkedItems.includes(item.id)}
                onCheckChange={(checked) => onCheckChange(item.id, checked)}
                onDelete={() => onDelete(item.id)}
                thumbnail={item.product.thumbnail || ""}
                title={item.product.name}
                option={item.selectedOptionText}
                brand={item.product.brand || ""}
                badge="4시 이전 주문 시 당일 출고 보장"
                originalPrice={
                  isMembershipApplied || showMembershipHint
                    ? baseUnitPrice * quantity
                    : undefined
                }
                discountedPrice={displayUnitPrice * quantity}
                actualPrice={displayUnitPrice * quantity}
                discountRate={discountRate}
                isMembership={isMembershipApplied}
                showMembershipHint={showMembershipHint}
                quantity={item.quantity}
                onQuantityChange={(qty) => onQuantityChange(item.id, qty)}
                productId={item.productId}
                countryCode={countryCode}
                manageInventory={item.manageInventory}
                inventoryQuantity={item.inventoryQuantity}
              />
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className="divide-y divide-gray-200">
      {items.map((item) => {
        const {
          baseUnitPrice,
          hasMembershipPrice,
          displayUnitPrice,
          quantity,
          isMembershipApplied,
          discountRate,
        } = deriveCartItemPricing(item, isMember)
        const showMembershipHint = !isMember && hasMembershipPrice

        return (
          <CartCard
            key={item.id}
            checked={checkedItems.includes(item.id)}
            onCheckChange={(checked) => onCheckChange(item.id, checked)}
            onDelete={() => onDelete(item.id)}
            thumbnail={item.product.thumbnail || ""}
            title={item.product.name}
            option={item.selectedOptionText}
            brand={item.product.brand || ""}
            badge="4시 이전 주문 시 당일 출고 보장"
            originalPrice={
              isMembershipApplied || showMembershipHint
                ? baseUnitPrice * quantity
                : undefined
            }
            discountedPrice={displayUnitPrice * quantity}
            discountRate={discountRate}
            isMembership={isMembershipApplied}
            actualPrice={displayUnitPrice * quantity}
            showMembershipHint={showMembershipHint}
            quantity={item.quantity}
            onQuantityChange={(qty) => onQuantityChange(item.id, qty)}
            productId={item.productId}
            countryCode={countryCode}
            manageInventory={item.manageInventory}
            inventoryQuantity={item.inventoryQuantity}
          />
        )
      })}
    </div>
  )
}
