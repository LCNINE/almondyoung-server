"use client"

import { Card, CardContent } from "@/components/ui/card"
import { CartHeader } from "@/domains/cart/components/header"
import {
  createCheckoutCartFromLineItems,
  refreshCartPrices,
} from "@/lib/api/medusa/cart"
import { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"

import Items from "./items"
import MobileCheckoutBar from "../components/mobile-checkout-bar"
import Summary from "./summary"

type Props = {
  cart: HttpTypes.StoreCart | null
  /** 판매중단(draft/미게시)으로 결제를 막는 variant id 목록 */
  unavailableVariantIds?: string[]
}

export default function CartTemplate({
  cart,
  unavailableVariantIds = [],
}: Props) {
  const router = useRouter()
  const params = useParams()
  const countryCode = (params.countryCode as string) || "kr"
  const t = useTranslations("cart.summary")

  const unavailableVariantIdSet = useMemo(
    () => new Set(unavailableVariantIds),
    [unavailableVariantIds]
  )

  const cartItems = cart?.items
  const sortedItems = useMemo(
    () =>
      [...(cartItems ?? [])].sort((a, b) =>
        (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
      ),
    [cartItems]
  )

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    return new Set(sortedItems.map((item) => item.id))
  })
  const [isPendingCheckout, startCheckoutTransition] = useTransition()

  const allSelected =
    sortedItems.length > 0 &&
    sortedItems.every((item) => selectedIds.has(item.id)) &&
    selectedIds.size === sortedItems.length

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(sortedItems.map((item) => item.id)))
      } else {
        setSelectedIds(new Set())
      }
    },
    [sortedItems]
  )

  const handleSelectItem = useCallback((itemId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(itemId)
      } else {
        next.delete(itemId)
      }
      return next
    })
  }, [])

  const goToCheckout = useCallback(() => {
    if (selectedIds.size === 0) return

    // 판매중단(draft/미게시)된 상품이 선택돼 있으면 결제로 못 넘어가게 막는다.
    const unavailableSelected = sortedItems.filter(
      (item) =>
        selectedIds.has(item.id) &&
        !!item.variant_id &&
        unavailableVariantIdSet.has(item.variant_id)
    )
    if (unavailableSelected.length > 0) {
      const names = unavailableSelected
        .map((item) => item.product_title || item.title || "")
        .filter(Boolean)
      import("sonner").then(({ toast }) =>
        toast.error(
          names.length > 0
            ? t("itemsUnavailable", { items: names.join(", ") })
            : t("checkoutFailed")
        )
      )
      return
    }

    const isEveryLineSelected =
      sortedItems.length > 0 &&
      sortedItems.every((item) => selectedIds.has(item.id)) &&
      selectedIds.size === sortedItems.length

    // 현재 카트의 모든 라인이 정확히 선택된 경우에만 기존 카트로 이동
    if (isEveryLineSelected) {
      router.push(`/${countryCode}/checkout`)
      return
    }

    // 일부 선택 → 새 체크아웃 카트 생성
    startCheckoutTransition(async () => {
      try {
        const result = await createCheckoutCartFromLineItems({
          countryCode,
          lineItemIds: Array.from(selectedIds),
        })

        // 미게시/판매중지 등으로 담을 수 없는 상품이 있으면 어떤 상품인지 안내
        if ("error" in result) {
          const names = result.unavailableNames.filter(Boolean)
          const { toast } = await import("sonner")
          toast.error(
            names.length > 0
              ? t("itemsUnavailable", { items: names.join(", ") })
              : t("checkoutFailed")
          )
          return
        }

        router.push(`/${countryCode}/checkout?cartId=${result.cartId}`)
      } catch (error) {
        console.error("Failed to create checkout cart:", error)
        const { toast } = await import("sonner")
        toast.error(t("checkoutFailed"))
      }
    })
  }, [
    selectedIds,
    sortedItems,
    countryCode,
    router,
    t,
    unavailableVariantIdSet,
  ])

  useEffect(() => {
    refreshCartPrices()
      .then(() => router.refresh())
      .catch(() => {})
  }, [])

  // 아이템이 변경되면 (삭제 등) 선택 상태 동기화
  useEffect(() => {
    const itemIds = new Set(sortedItems.map((item) => item.id))
    setSelectedIds((prev) => {
      const next = new Set<string>()
      Array.from(prev).forEach((id) => {
        if (itemIds.has(id)) {
          next.add(id)
        }
      })
      return next
    })
  }, [sortedItems])

  return (
    <>
      <main className="bg-background container mx-auto max-w-[1360px] px-4 py-8">
        <CartHeader />

        <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardContent className="pt-6">
              <Items
                items={sortedItems}
                selectedIds={selectedIds}
                allSelected={allSelected}
                onSelectAll={handleSelectAll}
                onSelectItem={handleSelectItem}
                unavailableVariantIds={unavailableVariantIdSet}
              />
            </CardContent>
          </Card>

          {/* 데스크탑: 오른쪽 사이드바 */}
          <div className="hidden lg:sticky lg:top-5 lg:block lg:self-start">
            <Card>
              <CardContent>
                {cart && cart.region && (
                  <div className="py-6">
                    <Summary
                      cart={
                        cart as HttpTypes.StoreCart & {
                          promotions: HttpTypes.StorePromotion[]
                        }
                      }
                      selectedIds={selectedIds}
                      onCheckout={goToCheckout}
                      isPendingCheckout={isPendingCheckout}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* 모바일: 하단 고정 바 */}
      {cart && cart.region && (
        <MobileCheckoutBar
          cart={
            cart as HttpTypes.StoreCart & {
              promotions: HttpTypes.StorePromotion[]
            }
          }
          selectedIds={selectedIds}
          onCheckout={goToCheckout}
          isPendingCheckout={isPendingCheckout}
        />
      )}
    </>
  )
}
