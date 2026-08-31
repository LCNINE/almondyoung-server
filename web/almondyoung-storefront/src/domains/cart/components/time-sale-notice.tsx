"use client"

import { useCallback, useMemo } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useEarliestSaleEnd } from "@/components/providers/time-sale-provider"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"
import { refreshCartPrices } from "@/lib/api/medusa/cart"

/**
 * 카트·체크아웃에 타임세일 상품이 있을 때의 마감 안내.
 *
 * 종료 순간 가격 재계산을 건 뒤 `router.refresh()` 로 다시 받는다. 다시 받기만 하면 안 된다 —
 * 카트 라인엔 담을 때의 세일가가 박혀 있고, 페이지가 부르는 `refreshCartPricesDuringRender` 는
 * (카트id, 멤버십) 키로 10분 스로틀이라 세일 종료로는 깨지지 않는다. 재계산 없이는 세일이
 * 끝나도 옛 세일가로 결제된다.
 *
 * 가격이 **조용히** 오르면 "9,000원이라며" CS 가 된다. 카운터가 0 을 지났다는 사실 자체가 곧
 * "가격이 바뀌었다" 신호라, 담을 때 가격을 따로 저장할 필요가 없다.
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
  const productIds = useMemo(
    () => items.map((item) => item.product_id).filter((id): id is string => Boolean(id)),
    [items]
  )
  const endsAt = useEarliestSaleEnd(productIds)

  // 다시 받기만 해서는 소용없다 — 카트 라인엔 담을 때의 세일가가 박혀 있어서, 재계산을 걸어야
  // 정가로 돌아온다. 이걸 빼면 세일이 끝난 뒤에도 옛 세일가로 결제가 된다.
  const reprice = useCallback(async () => {
    await refreshCartPrices().catch(() => null)
  }, [])

  if (!endsAt) return null

  return (
    <div className="mb-4">
      <TimeSaleCountdown
        endsAt={endsAt}
        refreshOnEnd
        onEnd={reprice}
        endedLabel="타임세일이 종료되어 가격이 변경되었습니다."
        className="text-red-30 text-[14px] font-bold"
      />
    </div>
  )
}
