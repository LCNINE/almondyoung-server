"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { useEarliestSaleEnd } from "@/components/providers/time-sale-provider"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"
import { refreshCartPrices } from "@/lib/api/medusa/cart"

/**
 * 카트·체크아웃에 타임세일 상품이 있을 때의 마감 안내.
 *
 * 종료 순간 가격 재계산을 건 뒤 `router.refresh()` 로 다시 받는다. 다시 받기만 하면 안 된다 —
 * 카트 라인엔 담을 때의 세일가가 박혀 있고, 페이지가 부르는 `refreshCartPricesDuringRender` 는
 * (스코프, 멤버십, 세일 상태) 키로 10분 스로틀이다. 재계산 없이는 세일이 끝나도 옛 세일가로
 * 결제된다.
 *
 * 그리고 종료 뒤에도 안내를 계속 그린다. 재계산이 끝나면 서버가 세일 목록을 비워 `endsAt` 이
 * null 이 되는데, 그때 컴포넌트가 사라져 버리면 **금액만 조용히 오른다** — 결제 버튼 숫자가
 * 눈앞에서 바뀌는 게 유일한 신호가 되어 "9,000원이라며" CS 가 된다. 그래서 종료 사실을 로컬
 * state 로 붙잡고, 아마존처럼 **바뀌기 전 금액과 바뀐 금액을 함께** 보여준다.
 *
 * 카트 라인에서 타임세일 여부를 직접 읽을 수는 없다 — `compare_at_unit_price` 는 멤버십가·수량
 * 할인도 똑같이 채우기 때문이다. 그래서 세일 상품 id 집합과 교차한다.
 *
 * 세일이 여럿이면 가장 먼저 끝나는 마감을 쓴다. 담긴 상품마다 카운터를 다는 것보다, 다음에
 * 가격이 바뀌는 시점 하나를 보여주는 편이 읽힌다 — 그 시점에 새로고침이 걸려 나머지도 함께 맞는다.
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

  // 배송비는 세일과 무관하게 움직이므로 상품 금액만 본다.
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (item.unit_price ?? 0) * (item.quantity ?? 0), 0),
    [items]
  )
  // 종료 순간의 금액을 붙잡아야 하는데, 그 시점은 렌더가 아니라 타이머 콜백이다.
  const subtotalRef = useRef(subtotal)
  subtotalRef.current = subtotal

  // 종료 직전의 라인별 단가. 어떤 상품이 올랐는지 이름으로 말해야 손님이 납득한다.
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
    const message =
      changed.length === 1
        ? t("timeSaleEndedOne", {
            name,
            from: `${(snapshot?.get(first.id) ?? 0).toLocaleString()}원`,
            to: `${(first.unit_price ?? 0).toLocaleString()}원`,
          })
        : t("timeSaleEndedMany", {
            name,
            count: changed.length - 1,
            from: `${priceBeforeEnd.toLocaleString()}원`,
            to: `${subtotal.toLocaleString()}원`,
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
