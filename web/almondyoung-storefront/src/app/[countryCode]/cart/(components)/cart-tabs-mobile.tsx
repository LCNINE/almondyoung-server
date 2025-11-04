"use client"

import React from "react"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@components/common/components/tabs"
import { CartItem } from "../../../data/__mocks__/user-cart-mock"
import { ShippingNotice } from "./shipping-notice"
import { CartControls } from "./cart-controls"
import { CartItemList } from "./cart-item-list"

interface CartTabsMobileProps {
  cartItems: CartItem[]
  checkedItems: string[]
  remainingForFreeShipping: number
  freeShippingProgress: number
  onCheckAll: (checked: boolean) => void
  onDeleteSelected: () => void
  onCheckItem: (id: string, checked: boolean) => void
  onDeleteItem: (id: string) => void
  onQuantityChange: (id: string, quantity: number) => void
}

export function CartTabsMobile({
  cartItems,
  checkedItems,
  remainingForFreeShipping,
  freeShippingProgress,
  onCheckAll,
  onDeleteSelected,
  onCheckItem,
  onDeleteItem,
  onQuantityChange,
}: CartTabsMobileProps) {
  const isAllChecked =
    cartItems.length > 0 && checkedItems.length === cartItems.length

  return (
    <nav
      className="tab-navigation md:hidden"
      role="navigation"
      aria-label="장바구니 탭"
    >
      <Tabs defaultValue="purchase">
        <div className="tab-header bg-white">
          <TabsList className="tab-list">
            <TabsTrigger value="purchase">
              구매({cartItems.length})
            </TabsTrigger>
            <TabsTrigger value="regular">자주산상품</TabsTrigger>
            <TabsTrigger value="wishlist">찜한상품(24)</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="purchase" className="tab-content bg-white">
          <section className="cart-section">
            <div className="cart-container p-4">
              <div className="cart-inner space-y-4">
                {/* 무료배송 안내 - 모바일 */}
                <ShippingNotice
                  remainingForFreeShipping={remainingForFreeShipping}
                  freeShippingProgress={freeShippingProgress}
                  variant="mobile"
                />

                {/* 선택 컨트롤 - 모바일 */}
                <CartControls
                  isAllChecked={isAllChecked}
                  onCheckAll={onCheckAll}
                  onDeleteSelected={onDeleteSelected}
                  variant="mobile"
                />

                {/* 장바구니 아이템 리스트 - 모바일 */}
                <CartItemList
                  items={cartItems}
                  checkedItems={checkedItems}
                  onCheckChange={onCheckItem}
                  onDelete={onDeleteItem}
                  onQuantityChange={onQuantityChange}
                  variant="mobile"
                />
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="regular" className="tab-content bg-white p-4">
          <section className="regular-section">
            <div className="regular-container">자주산상품 탭 내용입니다.</div>
          </section>
        </TabsContent>

        <TabsContent value="wishlist" className="tab-content bg-white p-4">
          <section className="wishlist-section">
            <div className="wishlist-container">찜한상품 탭 내용입니다.</div>
          </section>
        </TabsContent>
      </Tabs>
    </nav>
  )
}

