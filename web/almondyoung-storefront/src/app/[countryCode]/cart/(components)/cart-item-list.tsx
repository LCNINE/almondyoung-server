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
      <section className="cart-items" role="region" aria-label="장바구니 상품 목록">
        <div className="items-container">
          {items.map((item) => (
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
                  : "옵션 없음"
              }
              brand={item.product.brand || ""}
              badge={item.product.isMembershipOnly ? "멤버십" : ""}
              originalPrice={item.product.basePrice || 0}
              discountedPrice={
                item.product.membershipPrice || item.product.basePrice || 0
              }
              discountRate={
                item.product.membershipPrice && item.product.basePrice
                  ? Math.round(
                      ((item.product.basePrice - item.product.membershipPrice) /
                        item.product.basePrice) *
                        100
                    )
                  : 0
              }
              isMembership={item.product.isMembershipOnly || false}
              quantity={item.quantity}
              onQuantityChange={(qty) => onQuantityChange(item.id, qty)}
            />
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="divide-y divide-gray-200">
      {items.map((item) => (
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
              : "옵션 없음"
          }
          brand={item.product.brand || ""}
          badge={item.product.isMembershipOnly ? "멤버십" : ""}
          originalPrice={item.product.basePrice || 0}
          discountedPrice={
            item.product.membershipPrice || item.product.basePrice || 0
          }
          discountRate={
            item.product.membershipPrice && item.product.basePrice
              ? Math.round(
                  ((item.product.basePrice - item.product.membershipPrice) /
                    item.product.basePrice) *
                    100
                )
              : 0
          }
          isMembership={item.product.isMembershipOnly || false}
          quantity={item.quantity}
          onQuantityChange={(qty) => onQuantityChange(item.id, qty)}
        />
      ))}
    </div>
  )
}

