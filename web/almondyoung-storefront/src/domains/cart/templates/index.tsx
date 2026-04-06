"use client"

import { Card, CardContent } from "@/components/ui/card"
import { CartHeader } from "@/domains/cart/components/header"
import { createCheckoutCartFromLineItems } from "@/lib/api/medusa/cart"
import { HttpTypes } from "@medusajs/types"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useState, useTransition } from "react"

import Items from "./items"
import MobileCheckoutBar from "../components/mobile-checkout-bar"
import Summary from "./summary"

type Props = {
  cart: HttpTypes.StoreCart | null
}

export default function CartTemplate({ cart }: Props) {
  const router = useRouter()
  const params = useParams()
  const countryCode = (params.countryCode as string) || "kr"

  const items = cart?.items ?? []
  const sortedItems = [...items].sort((a, b) => {
    return (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
  })

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    return new Set(sortedItems.map((item) => item.id))
  })
  const [isPendingCheckout, startCheckoutTransition] = useTransition()

  const allSelected =
    sortedItems.length > 0 && selectedIds.size === sortedItems.length

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

    // 전체 선택 → 기존 카트로 바로 이동
    if (selectedIds.size === sortedItems.length) {
      router.push(`/${countryCode}/checkout`)
      return
    }

    // 일부 선택 → 새 체크아웃 카트 생성
    startCheckoutTransition(async () => {
      try {
        const { cartId } = await createCheckoutCartFromLineItems({
          countryCode,
          lineItemIds: Array.from(selectedIds),
        })
        router.push(`/${countryCode}/checkout?cartId=${cartId}`)
      } catch (error) {
        console.error("Failed to create checkout cart:", error)
        const { toast } = await import("sonner")
        toast.error("주문 진행에 실패했습니다. 다시 시도해주세요.")
      }
    })
  }, [selectedIds, sortedItems.length, countryCode, router])

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
  }, [sortedItems.length])

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
                      selectedCount={selectedIds.size}
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
