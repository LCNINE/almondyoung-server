"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useIntersection } from "@/hooks/use-intersection"
import { addToCart, createBuyNowCart } from "@/lib/api/medusa/cart"
import { getPricesForVariant } from "@/lib/utils/get-product-price"
import { getRequiresMembershipToPurchase } from "@/lib/utils/product-card"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  CustomerGroupRef,
  isMembershipGroup,
} from "@/lib/utils/membership-group"
import { toGaCurrency, trackEvent } from "@/lib/analytics/gtag"
import { HttpTypes } from "@medusajs/types"
import { isEqual } from "lodash"
import { Loader2 } from "lucide-react"
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import ProductPreviewPrice from "../product-preview-price"
import { ProductShippingNotice } from "../product-shipping-notice"
import CartAddedModal from "./cart-added-modal"
import MobileActions from "./mobile-actions"
import OptionSelect from "./option-select"
import SelectedItemRow from "./selected-item-row"
import { SelectedItem } from "./types"
import { RestockNotice, hasStockNotice } from "./restock-notice"
import { isWelcomeMembershipProduct } from "@/lib/utils/welcome-membership"
import {
  describeStockShortage,
  getAvailableQuantity,
  isInsufficientInventoryError,
} from "@/lib/utils/cart-availability"

type ProductActionsProps = {
  customer: (HttpTypes.StoreCustomer & { groups: CustomerGroupRef[] }) | null
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
}

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"]
) => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt: any) => {
    acc[varopt.option_id] = varopt.value
    return acc
  }, {})
}

const getVariantLabel = (
  variant: HttpTypes.StoreProductVariant,
  fallback: string
) => {
  return (
    variant.options?.map((o: any) => o.value).join(" / ") ||
    variant.title ||
    fallback
  )
}

// 재고 확인
const isInStock = (v: HttpTypes.StoreProductVariant) => {
  if (!v.manage_inventory) return true // 재고관리를 안하는 상품은 장바구니에 추가 가능
  if (v.allow_backorder) return true // 백오더 가능한 상품은 장바구니에 추가 가능
  return (v.inventory_quantity || 0) > 0 // 재고가 있는 상품은 장바구니에 추가 가능
}

export default function ProductActions({
  product,
  disabled,
  customer,
}: ProductActionsProps) {
  const t = useTranslations("productDetail.options")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const countryCode = useParams().countryCode as string

  const [options, setOptions] = useState<Record<string, string | undefined>>({})
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])
  const [showCartModal, setShowCartModal] = useState(false)

  const isSimple = (product.variants?.length ?? 0) <= 1

  // 변형이 1개뿐이면 자동으로 선택 리스트에 추가
  useEffect(() => {
    if (isSimple && product.variants?.length === 1) {
      const variant = product.variants[0]
      const price = getPricesForVariant(variant)
      if (price) {
        setSelectedItems([
          {
            variantId: variant.id,
            quantity: 1,
            variant,
            price,
            label: getVariantLabel(variant, t("defaultLabel")),
          },
        ])
      }
    }
  }, [product.variants, isSimple])

  const allInStock = selectedItems.every((item) => isInStock(item.variant))

  // 이미 선택된 항목들의 옵션 값 (장바구니에 담긴 variant의 옵션 표시용)
  const selectedValuesMap = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    if (!product.options) return map

    for (const option of product.options) {
      const selectedSet = new Set<string>()
      for (const item of selectedItems) {
        const variantOptions = optionsAsKeymap(item.variant.options)
        const value = variantOptions?.[option.id]
        if (value) {
          selectedSet.add(value)
        }
      }
      map[option.id] = selectedSet
    }
    return map
  }, [product.options, selectedItems])

  // 옵션으로 매칭되는 variant 찾기
  const matchedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return undefined

    // 복합 옵션 상품에서 options가 비어있으면 매칭하지 않음
    // (setOptions({}) 후 빈 옵션의 "기본 품목" variant가 자동 추가되는 것 방지)
    if (!isSimple && Object.keys(options).length === 0) return undefined

    return product.variants.find((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options, isSimple])

  // 옵션 선택 시: 매칭된 variant를 선택 리스트에 추가
  useEffect(() => {
    if (!matchedVariant || isSimple) return

    const alreadySelected = selectedItems.some(
      (item) => item.variantId === matchedVariant.id
    )
    if (alreadySelected) {
      // 이미 선택된 항목이면 옵션만 초기화
      setOptions({})
      return
    }

    const price = getPricesForVariant(matchedVariant)
    if (!price) return

    setSelectedItems((prev) => [
      ...prev,
      {
        variantId: matchedVariant.id,
        quantity: 1,
        variant: matchedVariant,
        price,
        label: getVariantLabel(matchedVariant, t("defaultLabel")),
      },
    ])
    setOptions({})
  }, [matchedVariant, isSimple, selectedItems, t])

  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => ({
      ...prev,
      [optionId]: value,
    }))
  }

  const isWelcomeMembership = isWelcomeMembershipProduct(product.tags)

  // 재고 상한 안내. 옵션이 여러 개면 어느 옵션인지 같이 알려준다.
  const stockLimitMessage = useCallback(
    (label: string, max: number) => {
      // 재고가 0이면 "0개 이하로 담아주세요" 가 되어버리므로 품절 문구를 쓴다.
      if (max <= 0) {
        return isSimple
          ? t("soldOutToast")
          : t("soldOutToastNamed", { option: label })
      }
      return isSimple
        ? t("stockLimitToast", { max })
        : t("stockLimitToastNamed", { option: label, max })
    },
    [isSimple, t]
  )

  // 수량 변경 (1에서 -1 누르면 삭제, 단 옵션이 하나뿐이면 삭제하지 않음)
  const updateQuantity = useCallback(
    (variantId: string, delta: number) => {
      if (isWelcomeMembership && delta > 0) {
        toast.error(t("welcomeMembershipLimit"))
        return
      }
      setSelectedItems((prev) => {
        const item = prev.find((i) => i.variantId === variantId)
        // 재고 상한을 넘겨 담으려 하면 "품절" 이 아니라 남은 수량을 알려준다.
        // (여기서 막지 않으면 담기 버튼을 눌러야 비로소 실패해 혼란스럽다)
        if (item && delta > 0) {
          const max = getAvailableQuantity(item.variant)
          if (max !== null && item.quantity + delta > max) {
            toast.error(stockLimitMessage(item.label, max))
            return prev
          }
        }
        if (item && item.quantity + delta < 1) {
          // isSimple(옵션 1개)이면 삭제하지 않고 수량 1 유지
          if (isSimple) {
            return prev
          }
          return prev.filter((i) => i.variantId !== variantId)
        }
        return prev.map((i) =>
          i.variantId === variantId ? { ...i, quantity: i.quantity + delta } : i
        )
      })
    },
    [isSimple, isWelcomeMembership, stockLimitMessage, t]
  )

  // 항목 삭제
  const removeItem = useCallback((variantId: string) => {
    setSelectedItems((prev) =>
      prev.filter((item) => item.variantId !== variantId)
    )
  }, [])

  // 특정 항목의 수량을 직접 지정 (input 직접 입력용)
  const setItemQuantity = useCallback(
    (variantId: string, quantity: number) => {
      setSelectedItems((prev) =>
        prev.map((item) => {
          if (item.variantId !== variantId) return item
          // 직접입력으로 재고를 넘기면 상한까지만 반영하고 남은 수량을 안내한다.
          // 재고 0(품절)이면 수량 0 으로 만들지 않고 1 로 둔다 — 담기 시도에서 품절로 안내된다.
          const max = getAvailableQuantity(item.variant)
          if (max !== null && quantity > max) {
            toast.error(stockLimitMessage(item.label, max))
            return { ...item, quantity: Math.max(1, max) }
          }
          return { ...item, quantity }
        })
      )
    },
    [stockLimitMessage]
  )

  // 총 수량 & 총 가격
  const totalQuantity = selectedItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  )
  const totalPrice = selectedItems.reduce(
    (sum, item) => sum + item.price.calculated_price_number * item.quantity,
    0
  )

  // URL에 첫 번째 선택 variant ID 동기화
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const value = selectedItems.length > 0 ? selectedItems[0].variantId : null

    if (params.get("v_id") === value) return

    if (value) {
      params.set("v_id", value)
    } else {
      params.delete("v_id")
    }

    window.history.replaceState(null, "", pathname + "?" + params.toString())
  }, [selectedItems, pathname, searchParams])

  const actionsRef = useRef<HTMLDivElement>(null)
  const inView = useIntersection(actionsRef, "0px")

  const membersOnlyPurchase =
    !isMembershipGroup(customer?.groups) &&
    getRequiresMembershipToPurchase(product)

  const disabledLabel =
    selectedItems.length === 0
      ? t("selectPlaceholder")
      : !allInStock
        ? t("soldOut")
        : null

  // 재고부족 응답을 사람 말로 바꾼다. 요청 수량이 이미 남은 재고를 넘었으면 남은 수량을 알려주고,
  // 재고 안인데도 실패했으면 장바구니에 담긴 수량과 합쳐 넘긴 경우이므로 그렇게 안내한다.
  const stockError = (
    variant: HttpTypes.StoreProductVariant | undefined,
    label: string,
    quantity: number
  ) => {
    const max = getAvailableQuantity(variant)
    switch (describeStockShortage({ available: max, quantity })) {
      case "sold-out":
      case "exceeds-stock":
        return stockLimitMessage(label, max!)
      case "cart-sum":
        return t("stockConflictToast")
      default:
        return t("stockShortToast")
    }
  }

  const trackAddToCart = (items: SelectedItem[]) => {
    trackEvent("add_to_cart", {
      currency: toGaCurrency(items[0]?.price.currency_code),
      value: items.reduce(
        (sum, i) => sum + i.price.calculated_price_number * i.quantity,
        0
      ),
      items: items.map((i) => ({
        item_id: product.id,
        item_name: product.title,
        item_variant: i.label,
        price: i.price.calculated_price_number,
        quantity: i.quantity,
      })),
    })
  }

  // 장바구니 담기
  const handleAddToCart = () => {
    if (selectedItems.length === 0) return

    setShowCartModal(true)

    startTransition(async () => {
      try {
        for (const item of selectedItems) {
          const result = await addToCart({
            variantId: item.variantId,
            quantity: item.quantity,
            countryCode,
          })
          if (result.error) {
            setShowCartModal(false)
            // 담기 직전에 상한을 이미 걸러주므로, 여기까지 온 재고부족은 "이 옵션이 품절" 이 아니라
            // 장바구니에 이미 담긴 수량과 합쳐 재고를 넘긴 경우다(또는 방금 재고가 줄었거나).
            toast.error(
              isInsufficientInventoryError(result.error)
                ? stockError(item.variant, item.label, item.quantity)
                : result.error
            )
            return
          }
        }
        trackAddToCart(selectedItems)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        setShowCartModal(false)
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("addCartFail"))
      }
    })
  }

  // 바로구매
  const handleBuyNow = () => {
    if (selectedItems.length === 0) return

    startTransition(async () => {
      try {
        if (!customer) throw new Error("UNAUTHORIZED")

        const result = await createBuyNowCart({
          countryCode,
          items: selectedItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        })
        if (result.error) {
          const offending = selectedItems[0]
          toast.error(
            isInsufficientInventoryError(result.error)
              ? stockError(
                  offending?.variant,
                  offending?.label ?? "",
                  offending?.quantity ?? 1
                )
              : result.error
          )
          return
        }
        router.push(`/${countryCode}/checkout?cartId=${result.cartId}`)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
      }
    })
  }

  return (
    <>
      <div
        className="hidden xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
        ref={actionsRef}
      >
        {/* 스크롤 영역: 옵션/선택목록이 길어져도 구매 버튼은 하단에 고정됨 */}
        <div className="flex min-h-0 flex-1 flex-col gap-y-2 overflow-y-auto pb-2">
          <ProductPreviewPrice
            hasMembership={isMembershipGroup(customer?.groups)}
            product={product}
          />
          <ProductShippingNotice product={product} className="pb-2" />

          <Separator />

          {/* 옵션 선택 - variant가 2개 이상일 때만 표시 */}
          {!isSimple && (
            <div className="flex flex-col gap-y-4 py-2">
              {(product.options || []).map((option) => (
                <div key={option.id}>
                  <OptionSelect
                    option={option}
                    current={options[option.id]}
                    updateOption={setOptionValue}
                    title={option.title ?? ""}
                    variants={product.variants}
                    selectedOptions={options}
                    selectedValues={selectedValuesMap[option.id]}
                    disabled={!!disabled || isPending}
                  />
                </div>
              ))}
            </div>
          )}

          {/* 선택된 항목 리스트 */}
          {selectedItems.length > 0 && (
            <>
              {!isSimple && <Separator />}
              <div className="flex flex-col gap-3 py-2">
                {selectedItems.map((item) => (
                  <SelectedItemRow
                    key={item.variantId}
                    item={item}
                    product={product}
                    size="md"
                    showLabel={!isSimple}
                    showRemove={!isSimple}
                    incrementDisabled={
                      isWelcomeMembership && item.quantity >= 1
                    }
                    directInputDisabled={isWelcomeMembership}
                    onDecrement={() => updateQuantity(item.variantId, -1)}
                    onIncrement={() => updateQuantity(item.variantId, 1)}
                    onQuantityChange={(val) =>
                      setItemQuantity(item.variantId, val)
                    }
                    onEmptyInput={() => setItemQuantity(item.variantId, 0)}
                    onInvalidBlur={() => {
                      setItemQuantity(item.variantId, 1)
                      toast.info(t("minQtyOne"))
                    }}
                    onRemove={() => removeItem(item.variantId)}
                  />
                ))}
              </div>
            </>
          )}

          {/* 구매수량 / 총 가격 */}
          {selectedItems.length > 0 && (
            <>
              <Separator />
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-bold">
                  {t("totalQty", { count: totalQuantity })}
                </span>
                <span className="text-xl font-bold">
                  {t("totalPrice", { amount: totalPrice.toLocaleString() })}
                </span>
              </div>
            </>
          )}
        </div>

        {/* 하단 고정 액션 버튼 (스크롤 영역 밖) */}
        <div
          className="flex w-full gap-x-3 border-t border-gray-200 bg-white p-4"
          data-testid="mobile-actions"
        >
          {/* TODO: 재입고 알림 기능 추가 후 활성화
          {!allInStock && selectedItems.length > 0 ? (
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
          ) : !allInStock && selectedItems.length > 0 ? (
            <div className="w-full">
              {hasStockNotice(selectedItems.map((i) => i.variant)) ? (
                <RestockNotice variants={selectedItems.map((i) => i.variant)} />
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
                onClick={handleAddToCart}
                disabled={!!disabledLabel || !!disabled || isPending}
                className="border-yellow-30 text-yellow-30 hover:text-primary h-12 w-full flex-1 cursor-pointer text-base hover:bg-transparent"
                data-testid="add-product-button"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  (disabledLabel ?? t("addToCart"))
                )}
              </Button>

              <Button
                onClick={handleBuyNow}
                disabled={!!disabledLabel || !!disabled || isPending}
                className="h-12 w-full flex-1 cursor-pointer text-base"
                data-testid="buy-now-button"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  (disabledLabel ?? t("buyNow"))
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      <MobileActions
        product={product}
        options={options}
        setOptionValue={setOptionValue}
        selectedItems={selectedItems}
        updateQuantity={updateQuantity}
        removeItem={removeItem}
        selectedValuesMap={selectedValuesMap}
        totalQuantity={totalQuantity}
        totalPrice={totalPrice}
        isSimple={isSimple}
        isWelcomeMembership={isWelcomeMembership}
        membersOnlyPurchase={membersOnlyPurchase}
        inStock={allInStock}
        handleAddToCart={handleAddToCart}
        handleBuyNow={handleBuyNow}
        isPending={isPending}
        show={!inView}
      />

      <CartAddedModal
        open={showCartModal}
        onOpenChange={setShowCartModal}
        isPending={isPending}
        product={product}
      />
    </>
  )
}
