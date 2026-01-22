"use client"

import React from "react"
import { CartCard } from "@components/cart/cart-cards"
import type { CartItem } from "@lib/types/ui/cart"

interface CartItemListProps {
  items: CartItem[]
  checkedItems: string[]
  onCheckChange: (id: string, checked: boolean) => void
  onDelete: (id: string) => void
  onQuantityChange: (id: string, quantity: number) => void
  variant?: "mobile" | "desktop"
}

export function CartItemList({
  items,
  checkedItems,
  onCheckChange,
  onDelete,
  onQuantityChange,
  variant = "mobile",
}: CartItemListProps) {
  if (variant === "mobile") {
    return (
      <section
        className="cart-items"
        role="region"
        aria-label="장바구니 상품 목록"
      >
        <div className="items-container">
          {items.map((item) => {
            const basePrice = item.product.basePrice || 0
            const membershipPrice = item.product.membershipPrice || basePrice
            const quantity = item.quantity || 1
            const hasMembershipPrice =
              membershipPrice > 0 && membershipPrice < basePrice
            const discountRate = hasMembershipPrice
              ? Math.round(((basePrice - membershipPrice) / basePrice) * 100)
              : 0

            return (
              <CartCard
                key={item.id}
                checked={checkedItems.includes(item.id)}
                onCheckChange={(checked) => onCheckChange(item.id, checked)}
                onDelete={() => onDelete(item.id)}
                thumbnail={item.product.thumbnail || ""}
                title={item.product.name}
                option={
                  Object.keys(item.selectedOptions).length > 0
                    ? Object.entries(item.selectedOptions)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(", ")
                    : undefined
                }
                brand={item.product.brand || ""}
                badge="4시 이전 주문 시 당일 출고 보장"
                originalPrice={
                  hasMembershipPrice ? basePrice * quantity : undefined
                }
                discountedPrice={
                  hasMembershipPrice
                    ? membershipPrice * quantity
                    : basePrice * quantity
                }
                discountRate={discountRate}
                isMembership={hasMembershipPrice}
                quantity={item.quantity}
                onQuantityChange={(qty) => onQuantityChange(item.id, qty)}
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
        const basePrice = item.product.basePrice || 0
        const membershipPrice = item.product.membershipPrice || basePrice
        const quantity = item.quantity || 1
        const hasMembershipPrice =
          membershipPrice > 0 && membershipPrice < basePrice
        const discountRate = hasMembershipPrice
          ? Math.round(((basePrice - membershipPrice) / basePrice) * 100)
          : 0

        return (
          <CartCard
            key={item.id}
            checked={checkedItems.includes(item.id)}
            onCheckChange={(checked) => onCheckChange(item.id, checked)}
            onDelete={() => onDelete(item.id)}
            thumbnail={item.product.thumbnail || ""}
            title={item.product.name}
            option={
              Object.keys(item.selectedOptions).length > 0
                ? Object.entries(item.selectedOptions)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(", ")
                : undefined
            }
            brand={item.product.brand || ""}
            badge="4시 이전 주문 시 당일 출고 보장"
            originalPrice={
              hasMembershipPrice ? basePrice * quantity : undefined
            }
            discountedPrice={
              hasMembershipPrice
                ? membershipPrice * quantity
                : basePrice * quantity
            }
            discountRate={discountRate}
            isMembership={hasMembershipPrice}
            quantity={item.quantity}
            onQuantityChange={(qty) => onQuantityChange(item.id, qty)}
          />
        )
      })}
    </div>
  )
}
