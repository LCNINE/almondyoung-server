"use server"

import { sdk } from "@/lib/config/medusa"
import { TIME_SALE_TAG } from "@lib/data/cache-tags"

export type TimeSale = {
  id: string
  startsAt: string | null
  endsAt: string | null
  /** 카드가 "이 가격이 타임세일에서 나왔는가" 를 판별할 때 쓴다. */
  priceListIds: string[]
  productIds: string[]
}

export type TimeSaleOverview = {
  sales: TimeSale[]
  /** 진행 중 세일 상품 전체(판매순 → 리뷰순 → 최신순). 옛 Medusa 응답이면 없다. */
  products?: Array<{ id: string; categoryIds: string[] }>
}

type Response = {
  timeSales?: TimeSale[]
  products?: Array<{ id: string; categoryIds: string[] }>
}

/**
 * 진행 중인 타임세일. 세일 이름은 오지 않는다 — 운영자 내부용이라 고객에게 보이지 않는다.
 *
 * 태그 무효화(Medusa 쓰기·경계 크론)가 1차 신호이고, `revalidate` 는 그게 죽었을 때의 안전망이다.
 * 남은 시간 계산은 화면이 `endsAt` 으로 직접 하므로 이 응답이 낡아도 카운트다운은 정확하다.
 */
export const getTimeSaleOverview = async (): Promise<TimeSaleOverview> => {
  return sdk.client
    .fetch<Response>("/store/time-sale", {
      method: "GET",
      next: { tags: [TIME_SALE_TAG], revalidate: 60 },
    })
    .then((response) => ({ sales: response.timeSales ?? [], products: response.products }))
    .catch(() => ({ sales: [] }))
}

export const listActiveTimeSales = async (): Promise<TimeSale[]> =>
  (await getTimeSaleOverview()).sales
