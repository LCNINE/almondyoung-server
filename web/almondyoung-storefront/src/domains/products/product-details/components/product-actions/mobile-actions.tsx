"use client"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"
import { ShoppingCart } from "lucide-react"
import React, { useState } from "react"
import { useTranslations } from "next-intl"
import OptionSelect from "./option-select"
import SelectedItemRow from "./selected-item-row"
import { SelectedItem } from "./types"

type MobileActionsProps = {
  product: HttpTypes.StoreProduct
  options: Record<string, string | undefined>
  setOptionValue: (optionId: string, value: string) => void
  selectedItems: SelectedItem[]
  updateQuantity: (variantId: string, delta: number) => void
  removeItem: (variantId: string) => void
  selectedValuesMap: Record<string, Set<string>>
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
  selectedValuesMap,
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
  const t = useTranslations("productDetail.options")
  const [open, setOpen] = useState(false)

  const disabledLabel =
    selectedItems.length === 0
      ? t("selectPlaceholder")
      : !inStock
        ? t("soldOut")
        : null

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
          {/* TODO: 재입고 알림 기능 추가 후 활성화
          {isSimple && !inStock ? (
            <Button
              variant="default"
              className="w-full h-12 gap-2 text-base font-medium cursor-pointer"
              data-testid="restock-alert-button"
            >
              <Bell className="w-5 h-5" />
              재입고 알림 받기
            </Button>
          ) : ( ... )} */}

          {/* 재입고 알림기능추가되면 품절버튼 삭제 */}
          {isSimple && !inStock ? (
            <Button
              variant="default"
              disabled
              className="h-12 w-full cursor-pointer text-base font-medium"
              data-testid="sold-out-button"
            >
              {t("soldOut")}
            </Button>
          ) : (
            <>
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
                {t("addToCart")}
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
                {t("buyNow")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 옵션 선택 바텀시트 */}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerTitle className="sr-only">{t("sheetTitle")}</DrawerTitle>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-2">
            {/* 옵션 선택 */}
            {!isSimple && (
              <div className="flex flex-col gap-y-4 py-2">
                {(product.options || []).map((option) => (
                  <OptionSelect
                    key={option.id}
                    option={option}
                    current={options[option.id]}
                    updateOption={setOptionValue}
                    title={t("optionSelectTitle", {
                      title: option.title ?? "",
                    })}
                    variants={product.variants}
                    selectedOptions={options}
                    selectedValues={selectedValuesMap[option.id]}
                    disabled={isPending}
                  />
                ))}
              </div>
            )}

            {/* 선택된 항목 리스트 */}
            {!isSimple && selectedItems.length > 0 && (
              <div className="flex flex-col gap-2 py-3">
                <Separator />
                {selectedItems.map((item) => (
                  <SelectedItemRow
                    key={item.variantId}
                    item={item}
                    product={product}
                    size="sm"
                    directInputDisabled={isWelcomeMembership}
                    onDecrement={() => updateQuantity(item.variantId, -1)}
                    onIncrement={() => updateQuantity(item.variantId, 1)}
                    onQuantityChange={(val) =>
                      updateQuantity(item.variantId, val - item.quantity)
                    }
                    onInvalidBlur={() =>
                      updateQuantity(item.variantId, 1 - item.quantity)
                    }
                    onRemove={() => removeItem(item.variantId)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 요약 + 액션 버튼 */}
          <div className="border-t border-gray-200 px-4 pt-3 pb-4">
            <div className="flex items-center justify-between pb-3">
              <span className="text-sm font-medium">
                {t("totalQty", { count: totalQuantity })}
              </span>
              <span className="text-lg font-bold">
                {t("totalPrice", { amount: totalPrice.toLocaleString() })}
              </span>
            </div>
            <div className="flex gap-x-3">
              {/* TODO: 재입고 알림 기능 추가 후 활성화
              {!inStock && selectedItems.length > 0 ? (
                <Button
                  variant="default"
                  className="w-full h-12 gap-2 text-base font-medium cursor-pointer"
                  data-testid="restock-alert-button"
                >
                  <Bell className="w-5 h-5" />
                  재입고 알림 받기
                </Button>
              ) : ( ... )} */}

              {/* 재입고 알림기능추가되면 품절버튼 삭제 */}
              {!inStock && selectedItems.length > 0 ? (
                <Button
                  variant="default"
                  disabled
                  className="h-12 w-full cursor-pointer text-base font-medium"
                  data-testid="sold-out-button"
                >
                  {t("soldOut")}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      handleAddToCart()
                      setOpen(false)
                    }}
                    disabled={!!disabledLabel || isPending}
                    className="h-12 flex-1 gap-2 text-base"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    {disabledLabel ?? t("addToCart")}
                  </Button>
                  <Button
                    onClick={() => {
                      handleBuyNow()
                      setOpen(false)
                    }}
                    disabled={!!disabledLabel || isPending}
                    className="h-12 flex-1 text-base"
                  >
                    {disabledLabel ?? t("buyNowMobile")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

export default MobileActions
