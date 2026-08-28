"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"

type TimeSaleContextValue = {
  endsAt: string | null
  /** 이 id 로 계산된 가격이면 타임세일가다. */
  priceListIds: Set<string>
}

const TimeSaleContext = createContext<TimeSaleContextValue>({
  endsAt: null,
  priceListIds: new Set(),
})

/**
 * 진행 중인 타임세일을 카드·상세·카트가 함께 본다.
 *
 * 컨텍스트로 두는 이유: 카드는 목록마다 다른 경로로 렌더되는데(홈 섹션·카테고리·검색·위시리스트
 * ·최근본상품 …), prop 으로 내리면 호출부 여덟 곳에 같은 값을 꽂아야 하고 하나만 빠뜨려도
 * 그 화면에서만 뱃지가 사라진다.
 *
 * `price_list_type` 으로는 판별할 수 없다 — 멤버십가·수량 할인도 전부 sale 타입이라 같은 흔적을
 * 남긴다. 그래서 id 집합으로 가른다.
 */
export function TimeSaleProvider({
  endsAt,
  priceListIds,
  children,
}: {
  endsAt: string | null
  priceListIds: string[]
  children: ReactNode
}) {
  const value = useMemo(
    () => ({ endsAt, priceListIds: new Set(priceListIds) }),
    [endsAt, priceListIds]
  )

  return <TimeSaleContext.Provider value={value}>{children}</TimeSaleContext.Provider>
}

export function useTimeSale() {
  return useContext(TimeSaleContext)
}

type VariantLike =
  | {
      // price_list_id 는 한 겹 더 안쪽이다 — 바깥 calculated_price 는 금액,
      // 안쪽 calculated_price 가 그 금액이 어느 price list 에서 나왔는지를 담는다.
      calculated_price?: {
        calculated_price?: { price_list_id?: string | null } | null
      } | null
    }
  | null
  | undefined

/** 이 variant 의 현재 가격이 타임세일에서 나왔는지. */
export function useIsTimeSalePrice(variant: VariantLike): boolean {
  const { priceListIds } = useTimeSale()
  const priceListId = variant?.calculated_price?.calculated_price?.price_list_id
  return Boolean(priceListId && priceListIds.has(priceListId))
}
