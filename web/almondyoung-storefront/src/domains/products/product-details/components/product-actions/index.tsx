"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useIntersection } from "@/hooks/use-intersection"
import { addToCart, createBuyNowCart } from "@/lib/api/medusa/cart"
import { VariantPrice } from "@/lib/types/common/price"
import { getPricesForVariant } from "@/lib/utils/get-product-price"
import {
  CustomerGroupRef,
  isMembershipGroup,
} from "@/lib/utils/membership-group"
import { HttpTypes } from "@medusajs/types"
import { isEqual } from "lodash"
import { Minus, Plus, X } from "lucide-react"
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
import ProductPreviewPrice from "../product-preview-price"
import CartAddedModal from "./cart-added-modal"
import MobileActions from "./mobile-actions"
import OptionSelect from "./option-select"
import ProductPrice from "../product-price"

type ProductActionsProps = {
  customer: (HttpTypes.StoreCustomer & { groups: CustomerGroupRef[] }) | null
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
}

type SelectedItem = {
  variantId: string
  quantity: number
  variant: HttpTypes.StoreProductVariant
  price: VariantPrice
  label: string
}

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"]
) => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt: any) => {
    acc[varopt.option_id] = varopt.value
    return acc
  }, {})
}

const getVariantLabel = (variant: HttpTypes.StoreProductVariant) => {
  return (
    variant.options?.map((o: any) => o.value).join(" / ") ||
    variant.title ||
    "기본 옵션값"
  )
}

export default function ProductActions({
  product,
  disabled,
  customer,
}: ProductActionsProps) {
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
            label: getVariantLabel(variant),
          },
        ])
      }
    }
  }, [product.variants, isSimple])

  // 현재 선택된 옵션 기준으로, 각 옵션별 선택 불가능한 값 계산
  const disabledValuesMap = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    if (!product.options || !product.variants) return map

    for (const option of product.options) {
      const disabledSet = new Set<string>()

      for (const optValue of option.values ?? []) {
        // 현재 선택된 다른 옵션 + 이 값의 조합으로 variant가 존재하는지 확인
        const testOptions = { ...options, [option.id]: optValue.value }

        const hasVariant = product.variants.some((v) => {
          const variantOptions = optionsAsKeymap(v.options)
          // testOptions에서 설정된 키만 비교 (아직 선택 안 된 옵션은 무시)
          return Object.entries(testOptions).every(
            ([key, val]) => val === undefined || variantOptions?.[key] === val
          )
        })

        if (!hasVariant) {
          disabledSet.add(optValue.value)
        }
      }

      map[option.id] = disabledSet
    }

    return map
  }, [product.options, product.variants, options])

  // 옵션으로 매칭되는 variant 찾기
  const matchedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return undefined

    return product.variants.find((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  // 옵션 선택 시: 매칭된 variant를 선택 리스트에 추가
  useEffect(() => {
    if (!matchedVariant || isSimple) return

    const alreadySelected = selectedItems.some(
      (item) => item.variantId === matchedVariant.id
    )
    if (alreadySelected) return

    const price = getPricesForVariant(matchedVariant)
    if (!price) return

    setSelectedItems((prev) => [
      ...prev,
      {
        variantId: matchedVariant.id,
        quantity: 1,
        variant: matchedVariant,
        price,
        label: getVariantLabel(matchedVariant),
      },
    ])
    setOptions({})
  }, [matchedVariant, isSimple, selectedItems])

  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => ({
      ...prev,
      [optionId]: value,
    }))
  }

  // 수량 변경 (1에서 -1 누르면 삭제)
  const updateQuantity = useCallback((variantId: string, delta: number) => {
    setSelectedItems((prev) => {
      const item = prev.find((i) => i.variantId === variantId)
      if (item && item.quantity + delta < 1) {
        return prev.filter((i) => i.variantId !== variantId)
      }
      return prev.map((i) =>
        i.variantId === variantId ? { ...i, quantity: i.quantity + delta } : i
      )
    })
  }, [])

  // 항목 삭제
  const removeItem = useCallback((variantId: string) => {
    setSelectedItems((prev) =>
      prev.filter((item) => item.variantId !== variantId)
    )
  }, [])

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

  // 재고 확인
  const allInStock = selectedItems.every((item) => {
    const v = item.variant

    if (!v.manage_inventory) return true
    if (v.allow_backorder) return true
    return (v.inventory_quantity || 0) > 0
  })

  // 장바구니 담기
  const handleAddToCart = () => {
    if (selectedItems.length === 0) return

    setShowCartModal(true)

    startTransition(async () => {
      try {
        for (const item of selectedItems) {
          await addToCart({
            variantId: item.variantId,
            quantity: item.quantity,
            countryCode,
          })
        }
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        setShowCartModal(false)
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("장바구니 담기에 실패했습니다.")
      }
    })
  }

  // 바로구매
  const handleBuyNow = () => {
    if (selectedItems.length === 0) return

    startTransition(async () => {
      try {
        if (!customer) throw new Error("UNAUTHORIZED")

        const { cartId } = await createBuyNowCart({
          countryCode,
          items: selectedItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        })
        router.push(`/${countryCode}/checkout?cartId=${cartId}`)
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
      <div className="hidden lg:flex lg:flex-col lg:gap-y-2" ref={actionsRef}>
        <ProductPreviewPrice
          hasMembership={isMembershipGroup(customer?.groups)}
          product={product}
        />

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
                  disabledValues={disabledValuesMap[option.id]}
                  data-testid="product-options"
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
                <div
                  key={item.variantId}
                  className="flex items-center justify-between gap-4 rounded-lg px-4 py-3"
                >
                  <div className="flex flex-col gap-2">
                    {!isSimple && (
                      <span className="text-sm font-medium">{item.label}</span>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => updateQuantity(item.variantId, -1)}
                          className="h-8 w-8 rounded-r-none"
                        >
                          <Minus className="h-3.5 w-3.5" />
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
                            if (raw === "") {
                              setSelectedItems((prev) =>
                                prev.map((si) =>
                                  si.variantId === item.variantId
                                    ? { ...si, quantity: 0 as any }
                                    : si
                                )
                              )
                              return
                            }
                            const val = parseInt(raw, 10)
                            if (!isNaN(val)) {
                              setSelectedItems((prev) =>
                                prev.map((si) =>
                                  si.variantId === item.variantId
                                    ? { ...si, quantity: val }
                                    : si
                                )
                              )
                            }
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10)
                            if (isNaN(val) || val < 1) {
                              setSelectedItems((prev) =>
                                prev.map((si) =>
                                  si.variantId === item.variantId
                                    ? { ...si, quantity: 1 }
                                    : si
                                )
                              )
                              toast.info("최소 수량은 1개입니다.")
                            }
                          }}
                          onFocus={(e) => e.target.select()}
                          className="h-8 w-12 border-y text-center text-sm outline-none"
                        />

                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => updateQuantity(item.variantId, 1)}
                          className="h-8 w-8 rounded-l-none"
                        >
                          <Plus className="h-3.5 w-3.5" />
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
                        className="h-8 px-3 text-xs text-gray-600"
                      >
                        직접입력
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <ProductPrice
                      product={product}
                      variant={item.variant}
                      quantity={item.quantity}
                    />

                    {!isSimple && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(item.variantId)}
                        className="h-6 w-6 text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
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
                구매수량 {totalQuantity}개
              </span>
              <span className="text-xl font-bold">
                총 {totalPrice.toLocaleString()}원
              </span>
            </div>
          </>
        )}

        <div
          className="flex w-full gap-x-3 border-t border-gray-200 bg-white p-4"
          data-testid="mobile-actions"
        >
          <Button
            variant="outline"
            onClick={handleAddToCart}
            disabled={selectedItems.length === 0 || !allInStock || !!disabled}
            className="border-yellow-30 text-yellow-30 hover:text-primary h-12 w-full flex-1 cursor-pointer text-base hover:bg-transparent"
            data-testid="add-product-button"
          >
            {(() => {
              if (selectedItems.length === 0) return "옵션을 선택해주세요"
              if (!allInStock) return "품절"
              return "장바구니 담기"
            })()}
          </Button>

          <Button
            onClick={handleBuyNow}
            disabled={selectedItems.length === 0 || !!disabled || isPending}
            className="h-12 w-full flex-1 cursor-pointer text-base"
            data-testid="buy-now-button"
          >
            바로구매
          </Button>
        </div>
      </div>

      <MobileActions
        product={product}
        options={options}
        setOptionValue={setOptionValue}
        selectedItems={selectedItems}
        updateQuantity={updateQuantity}
        removeItem={removeItem}
        disabledValuesMap={disabledValuesMap}
        totalQuantity={totalQuantity}
        totalPrice={totalPrice}
        isSimple={isSimple}
        inStock={allInStock}
        handleAddToCart={handleAddToCart}
        handleBuyNow={handleBuyNow}
        isPending={isPending}
        show={!inView}
      />

      <CartAddedModal
        open={showCartModal}
        onOpenChange={setShowCartModal}
        product={product}
      />
    </>
  )
}
