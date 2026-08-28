"use server"

import { sdk } from "@/lib/config/medusa"
import { TIME_SALE_TAG } from "@lib/data/cache-tags"

export type TimeSale = {
  title: string
  startsAt: string | null
  endsAt: string | null
  /** 카드가 "이 가격이 타임세일에서 나왔는가" 를 판별할 때 쓴다. */
  priceListIds: string[]
  productIds: string[]
}

/**
 * 진행 중인 타임세일. 없으면 null.
 *
 * 태그 무효화(Medusa 경계 크론)가 1차 신호이고, `revalidate` 는 크론이 죽었을 때의 안전망이다.
 * 남은 시간 계산은 화면이 `endsAt` 으로 직접 하므로 이 응답이 낡아도 카운트다운은 정확하다.
 */
export const getActiveTimeSale = async (): Promise<TimeSale | null> => {
  return sdk.client
    .fetch<{ timeSale: TimeSale | null }>("/store/time-sale", {
      method: "GET",
      next: { tags: [TIME_SALE_TAG], revalidate: 60 },
    })
    .then((response) => response.timeSale)
    .catch(() => null)
}
