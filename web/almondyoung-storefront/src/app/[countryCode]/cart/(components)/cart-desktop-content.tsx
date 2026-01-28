"use client"

import React from "react"
import type { CartItem } from "@lib/types/ui/cart"
import { ShippingNotice } from "./shipping-notice"
import { CartControls } from "./cart-controls"
import { CartItemList } from "./cart-item-list"

interface CartDesktopContentProps {
  cartItems: CartItem[]
  checkedItems: string[]
  shippingTotal: number
  onCheckAll: (checked: boolean) => void
  onDeleteSelected: () => void
  onCheckItem: (id: string, checked: boolean) => void
  onDeleteItem: (id: string) => void
  onQuantityChange: (id: string, quantity: number) => void
  countryCode?: string
}

export function CartDesktopContent({
  cartItems,
  checkedItems,
  shippingTotal,
  onCheckAll,
  onDeleteSelected,
  onCheckItem,
  onDeleteItem,
  onQuantityChange,
  countryCode = "kr",
}: CartDesktopContentProps) {
  const isAllChecked =
    cartItems.length > 0 && checkedItems.length === cartItems.length

  return (
    <div className="hidden md:block">
      <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {/* PC 무료배송 안내 */}
        <ShippingNotice shippingTotal={shippingTotal} variant="desktop" />

        {/* PC 선택 컨트롤 */}
        <CartControls
          isAllChecked={isAllChecked}
          onCheckAll={onCheckAll}
          onDeleteSelected={onDeleteSelected}
          variant="desktop"
        />

        {/* PC 장바구니 아이템 리스트 */}
        <CartItemList
          items={cartItems}
          checkedItems={checkedItems}
          onCheckChange={onCheckItem}
          onDelete={onDeleteItem}
          onQuantityChange={onQuantityChange}
          variant="desktop"
          countryCode={countryCode}
        />
      </div>
    </div>
  )
}
