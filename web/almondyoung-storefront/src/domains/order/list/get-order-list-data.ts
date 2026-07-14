import "server-only"

import { getOrders } from "@/lib/api/medusa/orders"
import {
  getOrderActionsBatchByMedusaId,
  type StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import { getActiveRefundRequest } from "@/lib/api/wallet"
import type { HttpTypes } from "@medusajs/types"
import { subMonths } from "date-fns"

/** 서버 페이지네이션 한 페이지 크기 */
export const ORDER_PAGE_SIZE = 5

export interface OrderListPageData {
  orders: HttpTypes.StoreOrder[]
  /** 기간 필터 적용된 전체 주문 수 */
  count: number
  /** 전체 페이지 수 (최소 1) */
  pageCount: number
  /** 1-base 페이지 번호 */
  page: number
  /** "recent"(최근 6개월) 또는 연도 문자열 */
  period: string
  /** 상품명 검색어 (없으면 "") */
  q: string
  actionsMap: Record<string, StoreOrderActionsResponse>
  refundMap: Record<string, string>
  hasError: boolean
}

/** URL searchParams → 검증된 page/period/q. 이상한 값은 기본값(1페이지, recent, 검색 없음)으로. */
export function sanitizeOrderListParams(sp: {
  page?: string
  period?: string
  q?: string
}): { page: number; period: string; q: string } {
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1)
  const period =
    sp.period && /^(recent|\d{4})$/.test(sp.period) ? sp.period : "recent"
  const q = (sp.q ?? "").trim().slice(0, 100)
  return { page, period, q }
}

function periodToRange(period: string): { dateFrom?: string; dateTo?: string } {
  if (period === "recent") {
    const now = new Date()
    return {
      dateFrom: subMonths(now, 6).toISOString(),
      dateTo: now.toISOString(),
    }
  }
  const year = parseInt(period, 10)
  if (isNaN(year)) return {}
  return {
    dateFrom: new Date(year, 0, 1).toISOString(),
    dateTo: new Date(year, 11, 31, 23, 59, 59, 999).toISOString(),
  }
}

/**
 * 주문목록 한 페이지의 모든 데이터를 서버에서 조립한다.
 * Medusa(주문) 1콜 → Core(액션) 배치 1콜 + Wallet(무통장 환불신청) 0~n콜 병렬.
 * 부가정보 실패는 빈 map 으로 강등 — 목록 렌더는 항상 진행.
 */
export async function getOrderListPageData(params: {
  page: number
  period: string
  q: string
}): Promise<OrderListPageData> {
  const { page, period, q } = params

  const ordersData = await getOrders({
    limit: ORDER_PAGE_SIZE,
    offset: (page - 1) * ORDER_PAGE_SIZE,
    ...periodToRange(period),
    ...(q ? { q } : {}),
  })
  const orders = ordersData?.orders ?? []

  // 무통장 확정 + wallet intentId 있는 주문만 환불신청 조회 대상
  const refundTargets = orders.flatMap((o) => {
    const bts = (o.metadata as Record<string, unknown> | null)
      ?.bank_transfer_status
    const intentId = (
      o.payment_collections?.[0]?.payment_sessions?.[0]?.data as
        | Record<string, unknown>
        | undefined
    )?.intentId as string | undefined
    return bts === "confirmed" && intentId ? [{ id: o.id, intentId }] : []
  })

  const [actionsList, refundEntries] = await Promise.all([
    getOrderActionsBatchByMedusaId(orders.map((o) => o.id)).catch(() => []),
    Promise.all(
      refundTargets.map(
        async (t) =>
          [
            t.id,
            await getActiveRefundRequest(t.intentId)
              .then((rr) => rr?.status ?? "")
              .catch(() => ""),
          ] as const
      )
    ),
  ])

  const count = ordersData?.count ?? 0

  return {
    orders,
    count,
    pageCount: Math.max(1, Math.ceil(count / ORDER_PAGE_SIZE)),
    page,
    period,
    q,
    actionsMap: Object.fromEntries(
      actionsList.map((a) => [a.channelOrderId, a])
    ),
    refundMap: Object.fromEntries(refundEntries),
    hasError: ordersData === null,
  }
}
