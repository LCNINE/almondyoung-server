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
import { AlmondDesignNotice } from "./almond-design-notice"
import SelectedItemRow from "./selected-item-row"
import { RestockNotice, hasStockNotice } from "./restock-notice"
import { SelectedItem } from "./types"
import {
  productQuantitySummary,
  variantTierRows,
  type ItemQuantityPricing,
  type QuantityPricingContext,
} from "./quantity-pricing"
import QuantityDiscountOffer from "../quantity-discount-offer"
import {
  CustomOrderNotice,
  CustomOrderNoticeLine,
  CUSTOM_ORDER_NOTICE_PAGE_ID,
} from "@/domains/almond-template/components/custom-order-notice"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import type { AttachedPrintFile } from "@/domains/almond-template/components/print-file-order-dialog"
import { PrintFileNotice, PrintSourceButtons } from "./print-source"

type MobileActionsProps = {
  paperPreview?: React.ReactNode
  product: HttpTypes.StoreProduct
  options: Record<string, string | undefined>
  setOptionValue: (optionId: string, value: string) => void
  selectedItems: SelectedItem[]
  updateQuantity: (variantId: string, delta: number) => void
  removeItem: (variantId: string) => void
  selectedValuesMap: Record<string, Set<string>>
  totalQuantity: number
  totalPrice: number
  pricingOf: (item: SelectedItem) => ItemQuantityPricing
  pricingContext: QuantityPricingContext
  isSimple: boolean
  isWelcomeMembership: boolean
  membersOnlyPurchase: boolean
  inStock: boolean
  handleAddToCart: () => void
  handleBuyNow: () => void
  isPending: boolean
  show: boolean
  templateHref?: string
  onFileOrder?: () => void
  printFile?: AttachedPrintFile | null
  // 주문제작 상품인데 시안도 고객 파일도 없으면 담기·구매를 감춘다
  purchaseHidden?: boolean
  designAttached?: boolean
  almondDesignId?: string
  almondDesignHint?: string
  blockedLabel?: string
  showCustomOrderNotice?: boolean
}

const SHEET_NOTICE_ID = "custom-order-notice-sheet"

const MobileActions: React.FC<MobileActionsProps> = ({
  paperPreview,
  product,
  options,
  setOptionValue,
  selectedItems,
  updateQuantity,
  removeItem,
  selectedValuesMap,
  totalQuantity,
  totalPrice,
  pricingOf,
  pricingContext,
  isSimple,
  isWelcomeMembership,
  membersOnlyPurchase,
  inStock,
  handleAddToCart,
  handleBuyNow,
  isPending,
  show,
  templateHref,
  onFileOrder,
  printFile,
  purchaseHidden = false,
  designAttached,
  almondDesignId,
  almondDesignHint,
  blockedLabel,
  showCustomOrderNotice = false,
}) => {
  const t = useTranslations("productDetail.options")
  const tPrint = useTranslations("productDetail.printFile")
  const tQuantity = useTranslations("productDetail.quantityDiscount")
  const [open, setOpen] = useState(false)

  // 묶음 할인이 있는 상품은 바로 담지 않고 시트를 열어 묶음을 고르게 한다(옵션이 하나여도).
  const focusItem = selectedItems[selectedItems.length - 1]
  const bundle = focusItem
    ? variantTierRows(focusItem.variant, product, pricingContext)
    : {
        rows: [],
        memberHints: [],
        currentPrice: null,
        hiddenMemberQuantity: null,
      }
  const hasBundles =
    (bundle.rows.length > 0 ||
      bundle.memberHints.length > 0 ||
      !!bundle.hiddenMemberQuantity) &&
    !isWelcomeMembership
  const summary = productQuantitySummary(product, pricingContext)
  const instantPurchase = isSimple && !hasBundles && !purchaseHidden
  // 시트 위에 업로드 창을 겹쳐 띄우면 포커스가 갈린다. 시트를 닫고 연다
  const fileOrderFromSheet = onFileOrder
    ? () => {
        setOpen(false)
        onFileOrder()
      }
    : undefined

  const disabledLabel =
    selectedItems.length === 0
      ? t("selectPlaceholder")
      : !inStock
        ? t("soldOut")
        : (blockedLabel ?? null)

  return (
    <>
      {/* 하단 고정 바 */}
      <div
        className={cn(
          "pb-safe fixed inset-x-0 bottom-0 z-999 transition-all duration-300 xl:hidden",
          show && !open
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-full opacity-0"
        )}
      >
        <div
          className="flex w-full flex-col gap-2 border-t border-gray-200 bg-white p-4"
          data-testid="mobile-actions"
        >
          {summary && !isWelcomeMembership && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="border-mint-deep/30 bg-mint-tint text-foreground flex min-h-11 w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-xl border px-3 py-2 text-left text-sm font-bold"
            >
              <span>
                {tQuantity(
                  summary.pricesHidden
                    ? "hiddenMemberOffer"
                    : summary.memberOnly
                      ? "stickyMember"
                      : "sticky",
                  { count: summary.minQuantity, percent: summary.percent }
                )}
              </span>
              <span className="text-mint-deep">{tQuantity("viewBundles")}</span>
            </button>
          )}
          <PrintSourceButtons
            templateHref={templateHref}
            onFileOrder={printFile ? undefined : onFileOrder}
          />
          {printFile && onFileOrder && (
            <PrintFileNotice file={printFile} onChange={onFileOrder} />
          )}
          {almondDesignId && (
            <AlmondDesignNotice
              designId={almondDesignId}
              attached={!!designAttached}
              hint={almondDesignHint}
            />
          )}
          {showCustomOrderNotice && (
            <CustomOrderNoticeLine targetId={CUSTOM_ORDER_NOTICE_PAGE_ID} />
          )}
          <div className="flex w-full gap-x-3">
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

            {membersOnlyPurchase ? (
              <LocalizedClientLink href="/mypage/membership" className="w-full">
                <Button
                  className="h-12 w-full cursor-pointer text-base font-medium"
                  data-testid="members-only-cta"
                >
                  {t("membersOnlyCta")}
                </Button>
              </LocalizedClientLink>
            ) : isSimple && !inStock ? (
              <div className="w-full">
                {hasStockNotice(selectedItems.map((i) => i.variant)) ? (
                  <RestockNotice
                    variants={selectedItems.map((i) => i.variant)}
                  />
                ) : (
                  <Button
                    variant="default"
                    disabled
                    className="h-12 w-full cursor-pointer text-base font-medium"
                    data-testid="sold-out-button"
                  >
                    {t("soldOut")}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (instantPurchase && selectedItems.length > 0) {
                      handleAddToCart()
                    } else {
                      setOpen(true)
                    }
                  }}
                  className="border-primary text-primary hover:text-primary/80 h-12 w-full flex-1 cursor-pointer text-base hover:bg-transparent"
                  data-testid="mobile-cart-button"
                >
                  {t("addToCart")}
                </Button>
                <Button
                  onClick={() => {
                    if (instantPurchase && selectedItems.length > 0) {
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

            {paperPreview}

            {!isWelcomeMembership && (
              <QuantityDiscountOffer
                product={product}
                context={pricingContext}
                focusVariant={focusItem?.variant}
                quantity={focusItem?.quantity}
                onSelect={
                  focusItem
                    ? (q) =>
                        updateQuantity(
                          focusItem.variantId,
                          q - focusItem.quantity
                        )
                    : undefined
                }
                className="py-3"
              />
            )}

            {/* 선택된 항목 리스트 */}
            {(!isSimple || hasBundles) && selectedItems.length > 0 && (
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
                    showRemove={!isSimple}
                    pricing={pricingOf(item)}
                    onAddQuantity={(count) =>
                      updateQuantity(item.variantId, count)
                    }
                  />
                ))}
              </div>
            )}

            {showCustomOrderNotice && (
              <CustomOrderNotice id={SHEET_NOTICE_ID} className="mb-3" />
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
            <PrintSourceButtons
              templateHref={templateHref}
              onFileOrder={printFile ? undefined : fileOrderFromSheet}
              className="mb-2"
            />
            {printFile && fileOrderFromSheet && (
              <div className="mb-2">
                <PrintFileNotice
                  file={printFile}
                  onChange={fileOrderFromSheet}
                />
              </div>
            )}
            {designAttached && (
              <p className="text-muted-foreground mb-2 text-center text-xs">
                {t("almondDesignAttached")}
              </p>
            )}
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

              {/* 품절 시: 입고예정 있으면 재입고 안내, 없으면 품절 버튼 */}
              {purchaseHidden ? (
                <p className="text-muted-foreground w-full text-center text-xs">
                  {tPrint("sourceRequired")}
                </p>
              ) : membersOnlyPurchase ? (
                <LocalizedClientLink
                  href="/mypage/membership"
                  className="w-full"
                >
                  <Button
                    className="h-12 w-full cursor-pointer text-base font-medium"
                    data-testid="members-only-cta"
                  >
                    {t("membersOnlyCta")}
                  </Button>
                </LocalizedClientLink>
              ) : !inStock && selectedItems.length > 0 ? (
                <div className="w-full">
                  {hasStockNotice(selectedItems.map((i) => i.variant)) ? (
                    <RestockNotice
                      variants={selectedItems.map((i) => i.variant)}
                    />
                  ) : (
                    <Button
                      variant="default"
                      disabled
                      className="h-12 w-full cursor-pointer text-base font-medium"
                      data-testid="sold-out-button"
                    >
                      {t("soldOut")}
                    </Button>
                  )}
                </div>
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
