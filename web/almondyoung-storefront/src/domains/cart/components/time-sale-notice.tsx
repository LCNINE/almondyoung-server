"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { useEarliestSaleEnd } from "@/components/providers/time-sale-provider"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"
import { refreshCartPrices } from "@/lib/api/medusa/cart"
import { formatPrice } from "@/lib/utils/price-utils"

/**
 * 카트·체크아웃의 타임세일 마감 안내. 종료되면 가격 재계산을 건 뒤 변경 안내로 바뀐다.
 *
 * 라인엔 담을 때의 세일가가 박혀 있어 재계산 없이는 옛 가격으로 결제된다. 종료 후에도 안내를
 * 남기는 건 `endsAt` 이 null 이 되는 순간 컴포넌트가 사라져 금액만 조용히 오르기 때문이다.
 * 세일이 여럿이면 가장 먼저 끝나는 마감을 쓴다.
 */
export function TimeSaleNotice({
  items,
}: {
  items: HttpTypes.StoreCartLineItem[]
}) {
  const t = useTranslations("cart")
  const productIds = useMemo(
    () => items.map((item) => item.product_id).filter((id): id is string => Boolean(id)),
    [items]
  )
  const endsAt = useEarliestSaleEnd(productIds)

  // 배송비는 세일과 무관하다.
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (item.unit_price ?? 0) * (item.quantity ?? 0), 0),
    [items]
  )
  // 종료 시점은 렌더가 아니라 타이머 콜백이라 ref 로 붙잡는다.
  const subtotalRef = useRef(subtotal)
  subtotalRef.current = subtotal

  // 종료 직전 라인별 단가. 달라진 상품만 이름으로 알린다.
  const linesRef = useRef(items)
  linesRef.current = items
  const [snapshot, setSnapshot] = useState<Map<string, number> | null>(null)
  const [priceBeforeEnd, setPriceBeforeEnd] = useState<number | null>(null)

  const handleEnd = useCallback(async () => {
    setPriceBeforeEnd(subtotalRef.current)
    setSnapshot(
      new Map(linesRef.current.map((item) => [item.id, item.unit_price ?? 0]))
    )
    await refreshCartPrices().catch(() => null)
  }, [])

  const changed = useMemo(() => {
    if (!snapshot) return []
    return items.filter((item) => {
      const before = snapshot.get(item.id)
      return before !== undefined && before !== (item.unit_price ?? 0)
    })
  }, [items, snapshot])

  if (priceBeforeEnd !== null && changed.length > 0) {
    const first = changed[0]
    const name = first.product_title ?? first.title ?? ""
    const won = (value: number) => `${formatPrice(value)}${t("won")}`
    const message =
      changed.length === 1
        ? t("timeSaleEndedOne", {
            name,
            from: won(snapshot?.get(first.id) ?? 0),
            to: won(first.unit_price ?? 0),
          })
        : t("timeSaleEndedMany", {
            name,
            count: changed.length - 1,
            from: won(priceBeforeEnd),
            to: won(subtotal),
          })

    return <p className="text-red-30 mb-4 text-[14px] font-bold">{message}</p>
  }

  if (!endsAt) return null

  return (
    <div className="mb-4">
      <TimeSaleCountdown
        endsAt={endsAt}
        refreshOnEnd
        onEnd={handleEnd}
        className="text-red-30 text-[14px] font-bold"
      />
    </div>
  )
}
