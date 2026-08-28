"use client"

import { useMemo } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useEarliestSaleEnd } from "@/components/providers/time-sale-provider"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"

/**
 * 카트에 타임세일 상품이 있을 때의 마감 안내.
 *
 * 종료 순간 `router.refresh()` 로 서버에서 카트를 다시 받는다. 카트는 이미 `force-dynamic` +
 * `refreshCartPricesDuringRender` 라 가격이 바로 원래대로 돌아오는데, 그게 **조용히** 오르면
 * "9,000원이라며" CS 가 된다. 카운터가 0 을 지났다는 사실 자체가 곧 "가격이 바뀌었다" 신호라,
 * 담을 때 가격을 따로 저장할 필요가 없다.
 *
 * 카트 라인에서 타임세일 여부를 직접 읽을 수는 없다 — `compare_at_unit_price` 는 멤버십가·수량
 * 할인도 똑같이 채우기 때문이다. 그래서 세일 상품 id 집합과 교차한다.
 *
 * 세일이 여럿이면 가장 먼저 끝나는 마감을 쓴다. 담긴 상품마다 카운터를 다는 것보다, 다음에
 * 가격이 바뀌는 시점 하나를 보여주는 편이 읽힌다 — 그 시점에 새로고침이 걸려 나머지도 함께 맞는다.
 */
export function CartTimeSaleNotice({
  items,
}: {
  items: HttpTypes.StoreCartLineItem[]
}) {
  const productIds = useMemo(
    () => items.map((item) => item.product_id).filter((id): id is string => Boolean(id)),
    [items]
  )
  const endsAt = useEarliestSaleEnd(productIds)

  if (!endsAt) return null

  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <TimeSaleCountdown
        endsAt={endsAt}
        refreshOnEnd
        endedLabel="타임세일이 종료되어 가격이 변경되었습니다."
        className="text-[14px] font-semibold text-primary"
      />
    </div>
  )
}
