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

/**
 * 카드·상세가 그릴 타임세일. 회원은 실제로 적용된 가격표(`price_list_id`)만 믿는다 — 상시 멤버십가가 기간 특가보다
 * 싸면 Medusa 가 그쪽을 골랐으니 세일이 아니다. 비회원은 멤버십 전용 특가의 세일가가 계산되지 않으므로 id 목록으로 찾는다.
 */
export function useVariantTimeSale(
  variant: (VariantLike & { id?: string | null }) | null | undefined,
  isMember: boolean
): { timeSale: TimeSale | null; membershipOnly: boolean } {
  const priced = useTimeSaleForVariant(variant)
  const byId = useMembershipOnlySale(variant?.id)

  if (isMember) {
    const variantId = variant?.id ?? ""
    return {
      timeSale: priced,
      membershipOnly: !!priced?.membershipOnlyVariantIds?.includes(variantId),
    }
  }

  return { timeSale: priced ?? byId, membershipOnly: !priced && byId !== null }
}

type LineLike = {
  product_id?: string | null
  variant_id?: string | null
  unit_price?: number | null
  compare_at_unit_price?: number | null
  variant?: { metadata?: Record<string, unknown> | null } | null
}

/**
 * 카트·체크아웃 라인의 타임세일. 라인엔 가격표 출처(`price_list_id`)가 없어 옵션 id 와 금액으로 가른다.
 *
 * - 세일에 가격이 걸린 옵션만 세일이다 — 같은 상품의 세일 밖 옵션을 정가로 담았는데 배지가 붙으면 안 된다.
 * - 멤버십 전용 특가 옵션은 상시 멤버십가보다 싸게 담긴 라인만 세일이다. 비회원은 정가로 담기고, 상시 멤버십가가
 *   더 싸면 Medusa 가 그쪽을 고르므로 둘 다 기간 특가가 아니다.
 */
export function lineTimeSale(
  sales: TimeSale[],
  line: LineLike | null | undefined
): { sale: TimeSale; membershipOnly: boolean } | null {
  if (!line?.product_id) return null

  const variantId = line.variant_id ?? ""
  const productId = line.product_id
  const sale = sales.find((s) =>
    s.variantIds
      ? s.variantIds.includes(variantId)
      : s.productIds.includes(productId)
  )
  if (!sale) return null
  if (!sale.membershipOnlyVariantIds?.includes(variantId))
    return { sale, membershipOnly: false }

  const unit = line.unit_price ?? 0
  const regularMembership = Number(line.variant?.metadata?.membershipPrice)
  const discounted = unit < (line.compare_at_unit_price ?? 0)
  const beatsRegular = !(regularMembership > 0) || unit < regularMembership
  return discounted && beatsRegular ? { sale, membershipOnly: true } : null
}

export function useTimeSaleForLine(line: LineLike | null | undefined) {
  const { sales } = useTimeSale()
  return lineTimeSale(sales, line)
}
