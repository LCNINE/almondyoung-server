"use client"

import React from "react"
import { CartCard } from "@components/cart/cart-cards"
import type { CartItem } from "@lib/types/ui/cart"
import { useMembership } from "@/contexts/membership-context"

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
  const { status } = useMembership()
  const isMember = status === "membership"

  if (variant === "mobile") {
    return (
      <section
        className="cart-items"
        role="region"
        aria-label="장바구니 상품 목록"
      >
        <div className="items-container">
          {items.map((item) => {
            const basePrice =
              item.product.basePrice || item.product.unitPrice || 0
            const membershipPrice = item.product.membershipPrice
            const unitPrice = item.product.unitPrice || basePrice
            const quantity = item.quantity || 1
            const hasMembershipPrice =
              typeof membershipPrice === "number" &&
              membershipPrice > 0 &&
              membershipPrice < basePrice
            const isMembershipApplied =
              isMember && unitPrice > 0 && unitPrice < basePrice
            const discountRate = isMembershipApplied
              ? Math.round(((basePrice - unitPrice) / basePrice) * 100)
              : 0
            const showMembershipHint = !isMember && hasMembershipPrice

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
                  isMembershipApplied ? basePrice * quantity : undefined
                }
                discountedPrice={
                  unitPrice * quantity
                }
                actualPrice={unitPrice * quantity}
                discountRate={discountRate}
                isMembership={isMembershipApplied}
                showMembershipHint={showMembershipHint}
                quantity={item.quantity}
                onQuantityChange={(qty) => onQuantityChange(item.id, qty)}
                productId={item.productId}
                countryCode={countryCode}
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
        const basePrice = item.product.basePrice || item.product.unitPrice || 0
        const membershipPrice = item.product.membershipPrice
        const unitPrice = item.product.unitPrice || basePrice
        const quantity = item.quantity || 1
        const hasMembershipPrice =
          typeof membershipPrice === "number" &&
          membershipPrice > 0 &&
          membershipPrice < basePrice
        const isMembershipApplied =
          isMember && unitPrice > 0 && unitPrice < basePrice
        const discountRate = isMembershipApplied
          ? Math.round(((basePrice - unitPrice) / basePrice) * 100)
          : 0
        const showMembershipHint = !isMember && hasMembershipPrice

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
            originalPrice={isMembershipApplied ? basePrice * quantity : undefined}
            discountedPrice={
              unitPrice * quantity
            }
            discountRate={discountRate}
            isMembership={isMembershipApplied}
            actualPrice={unitPrice * quantity}
            showMembershipHint={showMembershipHint}
            quantity={item.quantity}
            onQuantityChange={(qty) => onQuantityChange(item.id, qty)}
            productId={item.productId}
            countryCode={countryCode}
          />
        )
      })}
    </div>
  )
}
