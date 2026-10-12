"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { TimeSale } from "@/lib/api/medusa/time-sale"

type TimeSaleContextValue = {
  sales: TimeSale[]
  /** price list id → 그 리스트를 만든 세일. */
  byPriceListId: Map<string, TimeSale>
}

const EMPTY: TimeSaleContextValue = { sales: [], byPriceListId: new Map() }

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
  children,
}: {
  sales: TimeSale[]
  children: ReactNode
}) {
  const value = useMemo(
    () => ({
      sales,
      byPriceListId: new Map(
        sales.flatMap((sale) =>
          sale.priceListIds.map((id) => [id, sale] as const)
        )
      ),
    }),
    [sales]
  )

  return (
    <TimeSaleContext.Provider value={value}>
      {children}
    </TimeSaleContext.Provider>
  )
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

/** 이 variant 의 현재 가격을 만든 타임세일. 세일가가 아니면 null. */
export function useTimeSaleForVariant(variant: VariantLike): TimeSale | null {
  const { byPriceListId } = useTimeSale()
  const priceListId = variant?.calculated_price?.calculated_price?.price_list_id
  return (priceListId && byPriceListId.get(priceListId)) || null
}

/**
 * 이 옵션이 멤버십 전용 특가(일반 세일가 없이 멤버십 세일가만)로 걸린 세일. 아니면 null.
 * 비회원은 세일가가 계산되지 않아 `useTimeSaleForVariant` 로는 못 찾으므로 id 목록으로 가른다.
 */
export function useMembershipOnlySale(
  variantId: string | null | undefined
): TimeSale | null {
  const { sales } = useTimeSale()

  return useMemo(() => {
    if (!variantId) return null
    return (
      sales.find((sale) =>
        sale.membershipOnlyVariantIds?.includes(variantId)
      ) ?? null
    )
  }, [sales, variantId])
}

type LineLike = {
  product_id?: string | null
  variant_id?: string | null
  unit_price?: number | null
  compare_at_unit_price?: number | null
}

/**
 * 카트·체크아웃 라인의 타임세일. 멤버십 전용 특가 옵션은 할인이 실제로 들어간 라인(=회원)만 세일로 본다
 * — 비회원은 정가로 결제하는데 「타임세일」을 띄우면 안 된다.
 */
export function lineTimeSale(
  sales: TimeSale[],
  line: LineLike | null | undefined
): { sale: TimeSale; membershipOnly: boolean } | null {
  if (!line?.product_id) return null

  const variantId = line.variant_id
  const membershipSale = variantId
    ? sales.find((sale) => sale.membershipOnlyVariantIds?.includes(variantId))
    : undefined
  if (membershipSale) {
    const discounted =
      (line.compare_at_unit_price ?? 0) > (line.unit_price ?? 0)
    return discounted ? { sale: membershipSale, membershipOnly: true } : null
  }

  const productId = line.product_id
  const sale = sales.find((s) => s.productIds.includes(productId))
  return sale ? { sale, membershipOnly: false } : null
}

export function useTimeSaleForLine(line: LineLike | null | undefined) {
  const { sales } = useTimeSale()
  return lineTimeSale(sales, line)
}
