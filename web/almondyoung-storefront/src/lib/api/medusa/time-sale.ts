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
 * 진행 중인 타임세일 전부. 종료가 빠른 순.
 *
 * 세일은 동시에 여럿일 수 있다 — 카테고리마다 기간이 다른 세일을 거는 게 목적이다. 그래서
 * 종료 시각·상품 목록은 세일마다 따로 갖고, 화면은 상품이 속한 세일의 것을 쓴다.
 *
 * 태그 무효화(Medusa 경계 크론)가 1차 신호이고, `revalidate` 는 크론이 죽었을 때의 안전망이다.
 * 남은 시간 계산은 화면이 `endsAt` 으로 직접 하므로 이 응답이 낡아도 카운트다운은 정확하다.
 */
export const listActiveTimeSales = async (): Promise<TimeSale[]> => {
  return sdk.client
    .fetch<{ timeSales: TimeSale[] }>("/store/time-sale", {
      method: "GET",
      next: { tags: [TIME_SALE_TAG], revalidate: 60 },
    })
    .then((response) => response.timeSales ?? [])
    .catch(() => [])
}
