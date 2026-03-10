"use client"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { VariantPrice } from "@/lib/types/common/price"
import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"
import { Minus, Plus, ShoppingCart, X } from "lucide-react"
import React, { useState } from "react"
import ProductPrice from "../product-price"

type SelectedItem = {
  variantId: string
  quantity: number
  variant: HttpTypes.StoreProductVariant
  price: VariantPrice
  label: string
}

type MobileActionsProps = {
  product: HttpTypes.StoreProduct
  options: Record<string, string | undefined>
  setOptionValue: (optionId: string, value: string) => void
  selectedItems: SelectedItem[]
  updateQuantity: (variantId: string, delta: number) => void
  removeItem: (variantId: string) => void
  disabledValuesMap: Record<string, Set<string>>
  totalQuantity: number
  totalPrice: number
  isSimple: boolean
  isWelcomeMembership: boolean
  inStock: boolean
  handleAddToCart: () => void
  handleBuyNow: () => void
  isPending: boolean
  show: boolean
}

const MobileActions: React.FC<MobileActionsProps> = ({
  product,
  options,
  setOptionValue,
  selectedItems,
  updateQuantity,
  removeItem,
  disabledValuesMap,
  totalQuantity,
  totalPrice,
  isSimple,
  isWelcomeMembership,
  inStock,
  handleAddToCart,
  handleBuyNow,
  isPending,
  show,
}) => {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* 하단 고정 바 */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-999 transition-all duration-300 lg:hidden",
          show && !open
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-full opacity-0"
        )}
      >
        <div
          className="flex w-full gap-x-3 border-t border-gray-200 bg-white p-4"
          data-testid="mobile-actions"
        >
          <Button
            variant="outline"
            onClick={() => {
              if (isSimple && selectedItems.length > 0) {
                handleAddToCart()
              } else {
                setOpen(true)
              }
            }}
            className="border-yellow-30 text-yellow-30 hover:text-primary h-12 w-full flex-1 cursor-pointer text-base hover:bg-transparent"
            data-testid="mobile-cart-button"
          >
            장바구니 담기
          </Button>
          <Button
            onClick={() => {
              if (isSimple && selectedItems.length > 0) {
                handleBuyNow()
              } else {
                setOpen(true)
              }
            }}
            disabled={isPending}
            className="h-12 flex-1 cursor-pointer text-base"
            data-testid="mobile-buy-button"
          >
            바로구매
          </Button>
        </div>
      </div>

      {/* 옵션 선택 바텀시트 */}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerTitle className="sr-only">옵션 선택</DrawerTitle>

          <div className="overflow-y-auto px-4 pt-2 pb-2">
            {/* 옵션 선택 */}
            {!isSimple && (
              <div className="flex flex-col gap-y-4 py-2">
                {(product.options || []).map((option) => (
                  <div key={option.id} className="flex flex-col gap-y-3">
                    <span className="text-sm font-medium">
                      {option.title} 선택
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {(option.values ?? []).map((optValue) => {
                        const isUnavailable = disabledValuesMap[option.id]?.has(
                          optValue.value
                        )
                        const isSelected = options[option.id] === optValue.value
                        return (
                          <button
                            key={optValue.value}
                            onClick={() =>
                              setOptionValue(option.id, optValue.value)
                            }
                            disabled={isUnavailable || isPending}
                            className={cn(
                              "rounded-full border px-4 py-2 text-sm transition-colors",
                              {
                                "border-primary bg-primary text-primary-foreground":
                                  isSelected && !isUnavailable,
                                "border-gray-200 hover:border-gray-400":
                                  !isSelected && !isUnavailable,
                                "border-gray-100 text-gray-400": isUnavailable,
                              }
                            )}
                          >
                            {optValue.value}
                            {isUnavailable && (
                              <span className="ml-1 text-xs text-gray-300">
                                (품절)
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 선택된 항목 리스트 */}
            {!isSimple && selectedItems.length > 0 && (
              <div className="flex flex-col gap-2 py-3">
                <Separator />
                {selectedItems.map((item) => (
                  <div
                    key={item.variantId}
                    className="flex items-center justify-between rounded-lg px-3 py-2"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-sm">{item.label}</span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => updateQuantity(item.variantId, -1)}
                            className="h-7 w-7 rounded-r-none"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <input
                            ref={(el) => {
                              if (el) {
                                (el as any)._variantId = item.variantId
                              }
                            }}
                            type="text"
                            inputMode="numeric"
                            value={item.quantity}
                            onChange={(e) => {
                              const raw = e.target.value
                              if (raw === "") return
                              const val = parseInt(raw, 10)
                              if (!isNaN(val)) {
                                const delta = val - item.quantity
                                updateQuantity(item.variantId, delta)
                              }
                            }}
                            onBlur={(e) => {
                              const val = parseInt(e.target.value, 10)
                              if (isNaN(val) || val < 1) {
                                const delta = 1 - item.quantity
                                updateQuantity(item.variantId, delta)
                              }
                            }}
                            onFocus={(e) => e.target.select()}
                            className="flex h-7 w-10 items-center justify-center border-y text-center text-sm outline-none"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => updateQuantity(item.variantId, 1)}
                            className="h-7 w-7 rounded-l-none"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const input = document.querySelector(
                              `input[type="text"][inputmode="numeric"]`
                            ) as HTMLInputElement & { _variantId?: string }
                            if (input && input._variantId === item.variantId) {
                              input.focus()
                            }
                          }}
                          disabled={isWelcomeMembership}
                          className="h-7 px-2 text-[11px] text-gray-600"
                        >
                          직접입력
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProductPrice
                        product={product}
                        variant={item.variant}
                        quantity={item.quantity}
                      />
                      <button
                        onClick={() => removeItem(item.variantId)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 요약 + 액션 버튼 */}
          <div className="border-t border-gray-200 px-4 pt-3 pb-4">
            <div className="flex items-center justify-between pb-3">
              <span className="text-sm font-medium">
                구매수량 {totalQuantity}개
              </span>
              <span className="text-lg font-bold">
                총 {totalPrice.toLocaleString()}원
              </span>
            </div>
            <div className="flex gap-x-3">
              <Button
                variant="outline"
                onClick={() => {
                  handleAddToCart()
                  setOpen(false)
                }}
                disabled={selectedItems.length === 0 || !inStock || isPending}
                className="h-12 flex-1 gap-2 text-base"
              >
                <ShoppingCart className="h-4 w-4" />
                장바구니 담기
              </Button>
              <Button
                onClick={() => {
                  handleBuyNow()
                  setOpen(false)
                }}
                disabled={selectedItems.length === 0 || !inStock || isPending}
                className="h-12 flex-1 text-base"
              >
                바로 구매
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

export default MobileActions
