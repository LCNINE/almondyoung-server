"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  defaultTimeSaleSettings,
  type TimeSaleSettings,
} from "@packages/domain-types/time-sale"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import {
  createSaleClock,
  earliestActiveSaleEnd,
  matchProductSale,
  type ProductSaleMatch,
} from "@/lib/utils/time-sale-product-period"

type TimeSaleContextValue = {
  settings: TimeSaleSettings
  sales: TimeSale[]
  /** price list id → 그 리스트를 만든 세일. */
  byPriceListId: Map<string, TimeSale>
  now: number
}

// Provider 밖에서 쓰일 때의 빈 값(세일 없음).
const EMPTY: TimeSaleContextValue = {
  settings: defaultTimeSaleSettings(),
  sales: [],
  byPriceListId: new Map(),
  now: 0,
}

const TimeSaleContext = createContext<TimeSaleContextValue>(EMPTY)

/**
 * 진행 중인 타임세일을 카드·상세·카트가 함께 본다.
 *
 * 컨텍스트로 두는 이유: 카드는 목록마다 다른 경로로 렌더되는데(홈 섹션·카테고리·검색·위시리스트
 * ·최근본상품 …), prop 으로 내리면 호출부 여덟 곳에 같은 값을 꽂아야 하고 하나만 빠뜨려도
 * 그 화면에서만 뱃지가 사라진다.
 *
 * `price_list_type` 으로는 판별할 수 없다 — 멤버십가·수량 할인도 전부 sale 타입이라 같은 흔적을
 * 남긴다. 그래서 id 로 가른다. 세일이 여럿이라 id → 세일 맵이어야 한다: 어느 세일에서 나온
 * 가격인지 알아야 그 상품에 **자기 세일의** 남은 시간을 붙일 수 있다.
 */
export function TimeSaleProvider({
  sales,
  settings = EMPTY.settings,
  children,
}: {
  sales: TimeSale[]
  settings?: TimeSaleSettings
  children: ReactNode
}) {
  // now 는 세일 경계마다만 갱신된다(createSaleClock).
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const clock = createSaleClock(setNow)
    clock.setSales(sales)

    return () => clock.dispose()
  }, [sales])

  const value = useMemo(
    () => ({
      sales,
      settings,
      now,
      byPriceListId: new Map(
        sales.flatMap((sale) =>
          sale.priceListIds.map((id) => [id, sale] as const)
        )
      ),
    }),
    [sales, settings, now]
  )

  return (
    <TimeSaleContext.Provider value={value}>
      {children}
    </TimeSaleContext.Provider>
  )
}

// 세일 목록·설정·현재 시각 컨텍스트 읽기.
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

/** 이 variant 의 현재 가격을 만든 타임세일. 세일가가 아니면 null. */
export function useTimeSaleForVariant(variant: VariantLike): TimeSale | null {
  const { byPriceListId } = useTimeSale()
  const priceListId = variant?.calculated_price?.calculated_price?.price_list_id
  return (priceListId && byPriceListId.get(priceListId)) || null
}

/** 이 variant 의 현재 가격이 타임세일에서 나왔는지. */
export function useIsTimeSalePrice(variant: VariantLike): boolean {
  return useTimeSaleForVariant(variant) !== null
}

/**
 * 이 상품이 걸린 타임세일. 없으면 null.
 * 카트 라인은 `price_list_id` 를 안 실어 오므로 variant 대신 상품 id 로 가른다.
 */
export function useTimeSaleForProduct(
  productId: string | null | undefined
): ProductSaleMatch | null {
  const { sales, now } = useTimeSale()

  return useMemo(
    () => (productId ? matchProductSale(sales, productId, now) : null),
    [sales, productId, now]
  )
}

/**
 * 이 상품들이 속한 세일 중 가장 먼저 끝나는 종료 시각. 없으면 null.
 *
 * 카트처럼 여러 상품을 한 번에 안내하는 자리에서 쓴다 — 가장 임박한 마감을 보여줘야 손님이
 * 늦게 알아차리지 않는다.
 */
export function useEarliestSaleEnd(productIds: string[]): string | null {
  const { sales, now } = useTimeSale()

  return useMemo(
    () => earliestActiveSaleEnd(sales, productIds, now),
    [sales, productIds, now]
  )
}
