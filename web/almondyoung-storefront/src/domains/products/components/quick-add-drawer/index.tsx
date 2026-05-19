"use client"

import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { getProductForQuickAdd } from "@/lib/api/medusa/products"
import { addToCart } from "@/lib/api/medusa/cart"
import { getPricesForVariant } from "@/lib/utils/get-product-price"
import { convertToLocale } from "@/lib/utils/price-utils"
import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"
import { isEqual } from "lodash"
import { Minus, Plus, ShoppingCart, X } from "lucide-react"
import Image from "next/image"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { showActionToast } from "@/components/shared/action-toast"
import { toast } from "sonner"
import OptionSelect from "@/domains/products/product-details/components/product-actions/option-select"

interface QuickAddDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  productTitle: string
  productImage?: string
  countryCode: string
  isWelcomeMembership?: boolean
}

type SelectedItem = {
  variantId: string
  quantity: number
  variant: HttpTypes.StoreProductVariant
  label: string
  price: NonNullable<ReturnType<typeof getPricesForVariant>>
}

function optionsAsKeymap(
  variantOptions: HttpTypes.StoreProductVariant["options"]
): Record<string, string> {
  return (variantOptions ?? []).reduce(
    (acc: Record<string, string>, o: HttpTypes.StoreProductOptionValue) => {
      acc[o.option_id ?? ""] = o.value ?? ""
      return acc
    },
    {}
  )
}

function getVariantLabel(variant: HttpTypes.StoreProductVariant): string {
  return (
    variant.options?.map((o: HttpTypes.StoreProductOptionValue) => o.value).join(" / ") ||
    variant.title ||
    ""
  )
}

function isVariantInStock(v: HttpTypes.StoreProductVariant): boolean {
  if (!v.manage_inventory) return true
  if (v.allow_backorder) return true
  return (v.inventory_quantity ?? 0) > 0
}

// UUID 같은 파일 ID가 아닌 실제 URL인지 확인
function isValidImageSrc(src?: string): src is string {
  return Boolean(
    src &&
      (src.startsWith("http://") ||
        src.startsWith("https://") ||
        src.startsWith("/"))
  )
}

export function QuickAddDrawer({
  open,
  onOpenChange,
  productId,
  productTitle,
  productImage,
  countryCode,
  isWelcomeMembership = false,
}: QuickAddDrawerProps) {
  const t = useTranslations("productCard")
  const tOptions = useTranslations("productDetail.options")

  const [isPending, startTransition] = useTransition()
  const [isCartPending, startCartTransition] = useTransition()

  // DrawerContent는 open=false여도 DOM에 마운트되므로,
  // 최초 open 전까지 내부 콘텐츠 렌더를 막는다
  const [mounted, setMounted] = useState(false)

  const [product, setProduct] = useState<HttpTypes.StoreProduct | null>(null)
  const [options, setOptions] = useState<Record<string, string | undefined>>({})
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])

  // 첫 open 시 mount (이후 닫혀도 unmount 안 함 — 닫힘 애니메이션 유지)
  useEffect(() => {
    if (open && !mounted) setMounted(true)
  }, [open, mounted])

  // 열릴 때마다 상품 정보 fetch
  useEffect(() => {
    if (!open) return
    startTransition(async () => {
      try {
        const result = await getProductForQuickAdd(productId, countryCode)
        setProduct(result)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message?.includes("UNAUTHORIZED")) {
          throw error
        }
        setProduct(null)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId, countryCode])

  // 닫힐 때 상태 초기화
  useEffect(() => {
    if (!open) {
      setProduct(null)
      setOptions({})
      setSelectedItems([])
    }
  }, [open])

  const variants = product?.variants ?? []

  // 현재 옵션 조합에 매칭되는 variant
  const matchedVariant = useMemo(() => {
    if (variants.length === 0 || Object.keys(options).length === 0) return undefined
    return variants.find((v) => isEqual(optionsAsKeymap(v.options), options))
  }, [variants, options])

  // 옵션이 모두 선택되면 selectedItems에 자동 추가
  useEffect(() => {
    if (!matchedVariant) return
    const price = getPricesForVariant(matchedVariant)
    if (!price) return

    setSelectedItems((prev) => {
      if (prev.some((item) => item.variantId === matchedVariant.id)) return prev
      return [
        ...prev,
        {
          variantId: matchedVariant.id,
          quantity: 1,
          variant: matchedVariant,
          label: getVariantLabel(matchedVariant),
          price,
        },
      ]
    })
    setOptions({})
  }, [matchedVariant])

  // 이미 선택된 옵션 값 추적 (OptionSelect 강조 표시용)
  const selectedValuesMap = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    if (!product?.options) return map
    for (const option of product.options) {
      const set = new Set<string>()
      for (const item of selectedItems) {
        const val = optionsAsKeymap(item.variant.options)?.[option.id]
        if (val) set.add(val)
      }
      map[option.id] = set
    }
    return map
  }, [product?.options, selectedItems])

  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => ({ ...prev, [optionId]: value }))
  }

  const updateQuantity = useCallback(
    (variantId: string, delta: number) => {
      if (isWelcomeMembership && delta > 0) {
        toast.error(t("welcomeMembershipLimit"))
        return
      }
      setSelectedItems((prev) => {
        const item = prev.find((i) => i.variantId === variantId)
        if (item && item.quantity + delta < 1) {
          return prev.filter((i) => i.variantId !== variantId)
        }
        return prev.map((i) =>
          i.variantId === variantId ? { ...i, quantity: i.quantity + delta } : i
        )
      })
    },
    [isWelcomeMembership, t]
  )

  const removeItem = useCallback((variantId: string) => {
    setSelectedItems((prev) => prev.filter((item) => item.variantId !== variantId))
  }, [])

  const totalQuantity = selectedItems.reduce((s, i) => s + i.quantity, 0)
  const totalPrice = selectedItems.reduce(
    (s, i) => s + i.price.calculated_price_number * i.quantity,
    0
  )
  const currencyCode = selectedItems[0]?.price.currency_code ?? "krw"
  const formattedTotal = convertToLocale({ amount: totalPrice, currency_code: currencyCode })

  const handleAddToCart = () => {
    if (selectedItems.length === 0) return
    startCartTransition(async () => {
      try {
        const results = await Promise.all(
          selectedItems.map((item) =>
            addToCart({ variantId: item.variantId, quantity: item.quantity, countryCode })
          )
        )
        const failed = results.find((r) => r.error)
        if (failed) {
          toast.error(failed.error)
          return
        }
        showActionToast({
          icon: <ShoppingCart className="h-7 w-7" strokeWidth={2.5} />,
          label: t("addedToast"),
        })
        onOpenChange(false)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message?.includes("UNAUTHORIZED")) {
          throw error
        }
        toast.error(t("quickAddError"))
      }
    })
  }

  const isLoaderActive = isPending

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="flex max-h-[88vh] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <DrawerTitle className="sr-only">{t("quickAddTitle")}</DrawerTitle>

        {/* mounted 전까지 아무것도 렌더하지 않음 — Image invalid URL 크래시 방지 */}
        {mounted && (
          <>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-sm font-bold text-foreground">
            {t("quickAddTitle")}
          </span>
          <DrawerClose asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </DrawerClose>
        </div>

        <Separator />

        {/* 상품 정보 */}
        <div className="flex items-center gap-3 px-4 py-3">
          {isValidImageSrc(productImage) && (
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border">
              <Image
                src={productImage}
                alt={productTitle}
                fill
                className="object-cover"
                sizes="48px"
              />
            </div>
          )}
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {productTitle}
          </p>
        </div>

        <Separator />

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto">
          {isLoaderActive ? (
            <OptionSkeleton />
          ) : !product || !product.options?.length ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t("quickAddError")}
            </div>
          ) : (
            <div className="px-4 py-4 space-y-4">
              {/* 옵션 선택 버튼 */}
              {product.options.map((option) => (
                <OptionSelect
                  key={option.id}
                  option={option}
                  current={options[option.id]}
                  updateOption={setOptionValue}
                  title={tOptions("optionSelectTitle", {
                    title: option.title ?? "",
                  })}
                  variants={variants}
                  selectedOptions={options}
                  selectedValues={selectedValuesMap[option.id]}
                  disabled={isCartPending}
                />
              ))}

              {/* 선택된 항목 */}
              {selectedItems.length > 0 && (
                <div className="space-y-2 pt-1">
                  <Separator />
                  {selectedItems.map((item) => {
                    const inStock = isVariantInStock(item.variant)
                    const isDiscounted =
                      item.price.original_price_number > item.price.calculated_price_number
                    return (
                      <div
                        key={item.variantId}
                        className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 px-3 py-3"
                      >
                        {/* 왼쪽: 라벨 + 가격 + 수량 */}
                        <div className="min-w-0 space-y-2">
                          <p className="text-sm font-medium leading-tight text-foreground">
                            {item.label}
                          </p>
                          <div className="flex items-center gap-1.5">
                            {isDiscounted && (
                              <>
                                <span className="text-xs font-semibold text-primary">
                                  {item.price.percentage_diff}%
                                </span>
                                <span className="text-xs text-muted-foreground line-through">
                                  {item.price.original_price}
                                </span>
                              </>
                            )}
                            <span className="text-sm font-bold text-foreground">
                              {item.price.calculated_price}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.variantId, -1)}
                              disabled={!inStock || isCartPending}
                              className={cn(
                                "flex h-7 w-7 items-center justify-center rounded-full border border-border transition-colors",
                                item.quantity <= 1
                                  ? "text-muted-foreground/50"
                                  : "hover:border-primary hover:text-primary"
                              )}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-8 text-center text-sm font-medium tabular-nums">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.variantId, 1)}
                              disabled={
                                !inStock ||
                                isCartPending ||
                                (isWelcomeMembership && item.quantity >= 1)
                              }
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-border transition-colors hover:border-primary hover:text-primary disabled:text-muted-foreground/50"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        {/* 오른쪽: 금액 + 삭제 */}
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => removeItem(item.variantId)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <span className="text-sm font-bold text-foreground">
                            {convertToLocale({
                              amount: item.price.calculated_price_number * item.quantity,
                              currency_code: item.price.currency_code,
                            })}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="border-t border-border px-4 pb-6 pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {tOptions("totalQty", { count: totalQuantity })}
            </span>
            <span className="text-base font-bold text-foreground">
              {totalQuantity > 0 ? formattedTotal : "0원"}
            </span>
          </div>
          <Button
            className="h-12 w-full text-base font-medium"
            disabled={
              selectedItems.length === 0 || isCartPending || isLoaderActive
            }
            onClick={handleAddToCart}
          >
            {selectedItems.length === 0
              ? t("quickAddSelect")
              : t("quickAddToCartWithPrice", { price: formattedTotal })}
          </Button>
        </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function OptionSkeleton() {
  return (
    <div className="px-4 py-4 space-y-6">
      {[1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-9 w-16 rounded-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
