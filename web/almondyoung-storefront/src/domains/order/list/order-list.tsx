"use client"

import { PageTitle } from "@/components/shared/page-title"
import { Button } from "@/components/ui/button"
import { getOrders } from "@/lib/api/medusa/orders"
import {
  getOrderActionsByMedusaId,
  type StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import { getActiveRefundRequest } from "@/lib/api/wallet"
import { useSearchFilter } from "@/hooks/use-search-filter"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import OrderActions from "@components/orders/order-card/order-actions"
import OrderSummaryCard from "@components/orders/order-card/order-summary-card"
import { getCoreDisplayStatus } from "@components/orders/order-status-badges"
import type { HttpTypes } from "@medusajs/types"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { useEffect, useMemo, useState, useTransition } from "react"
import { type FilterOptions } from "./order-filter"

interface OrderItem {
  orderId: string
  orderNumber: string
  orderDate: string
  status: string
  paymentStatus: string
  deliveryInfo: string
  shippingNote: string
  productName: string
  productImage: string
  price: string
  quantity: string
  options: string[]
  showInquiry: boolean
  orderItems: Array<{ productId: string; orderLineId: string }>
  variantId: string
  bankTransferStatus?: string
}

interface OrderListClientProps {
  initialOrders: HttpTypes.StoreOrder[]
  initialCount: number
  initialLimit: number
  hasError?: boolean
  initialActionsMap?: Record<string, StoreOrderActionsResponse>
  /** 마이페이지 홈 안에 끼워 넣어 쓸 때 true — 페이지 전용 여백/최소높이 제거 */
  embedded?: boolean
}

/** 한 페이지 기본 건수 (단, 같은 날짜 주문은 잘리지 않게 경계까지 확장) */
const PAGE_SIZE = 5
/** 페이지네이션용 클라 전체 로드 상한 */
const FETCH_LIMIT = 100

const getOrderStatusKey = (order: HttpTypes.StoreOrder): string => {
  if (order.status === "canceled") return "cancelled"
  // 무통장입금 선생성 주문: 관리자 입금확인 전까지 '입금확인중' 으로 표시
  // 결제는 authorized(미capture) 상태라 일반 로직에선 '상품 준비 중'으로 잘못 보이므로 최우선 처리
  // payment_status 와 AND: 입금확인(capture) 후 'confirmed' metadata 갱신이 실패해 awaiting_deposit
  // 가 남아도, captured 면 이미 결제완료이므로 '입금확인중' 으로 표시하지 않는다
  // (channel-adapter 의 WMS 수집 게이트와 동일한 불변식).
  if (
    (order.metadata as Record<string, unknown> | null)?.bank_transfer_status ===
      "awaiting_deposit" &&
    order.payment_status !== "captured"
  )
    return "depositPending"
  if (order.payment_status === "awaiting") return "paymentPending"
  if (order.fulfillment_status === "fulfilled") return "delivered"
  if (order.fulfillment_status === "shipped") return "shipping"
  if (order.fulfillment_status === "partially_fulfilled")
    return "partialShipping"
  if (order.fulfillment_status === "not_fulfilled") return "preparing"
  return "paid"
}

interface MapperContext {
  tStatus: (key: string) => string
  tList: (key: string, values?: Record<string, string | number>) => string
}

const mapStoreOrderToOrderItem = (
  order: HttpTypes.StoreOrder,
  ctx: MapperContext
): OrderItem => {
  const orderDate = new Date(order.created_at)
  const formatDate = `${orderDate.getMonth() + 1}월 ${orderDate.getDate()}일`
  const firstItem = order.items?.[0]
  const lineItemCount = order.items?.length ?? 0
  const totalQuantity = (order.items ?? []).reduce(
    (acc, item) => acc + (item.quantity ?? 0),
    0
  )
  const representativeName =
    firstItem?.title ||
    firstItem?.variant?.product?.title ||
    ctx.tList("defaultProductName")
  const productName =
    lineItemCount > 1
      ? `${representativeName} ${ctx.tList("productSuffix", { count: lineItemCount - 1 })}`
      : representativeName
  const displayPrice = typeof order.total === "number" ? order.total : 0

  const options: string[] = []
  if (firstItem?.variant?.title && firstItem.variant.title !== "Default") {
    options.push(firstItem.variant.title)
  }

  return {
    orderId: order.id,
    orderNumber: order.display_id
      ? `#${order.display_id}`
      : `#${order.id.slice(0, 12)}`,
    orderDate: formatDate,
    status: ctx.tStatus(getOrderStatusKey(order)),
    paymentStatus: order.payment_status ?? "",
    deliveryInfo: "",
    shippingNote: "",
    productName,
    productImage:
      firstItem?.thumbnail ||
      firstItem?.variant?.product?.thumbnail ||
      "https://placehold.co/80x80",
    price: `${displayPrice.toLocaleString()}원`,
    quantity: `${ctx.tList("items", { count: lineItemCount })} · ${ctx.tList("totalQuantity", { count: totalQuantity })}`,
    options,
    showInquiry: order.fulfillment_status === "fulfilled",
    orderItems: (order.items ?? [])
      .filter((item) => item.variant?.product?.handle || item.product_handle)
      .map((item) => ({
        productId: (item.variant?.product?.handle ??
          item.product_handle) as string,
        orderLineId: item.id,
      })),
    variantId: firstItem?.variant_id ?? "",
    bankTransferStatus:
      ((order.metadata as Record<string, unknown> | null)
        ?.bank_transfer_status as string | undefined) ?? undefined,
  }
}

/** FilterOptions의 year/month 값으로 API에 넘길 날짜 범위를 계산한다. */
function computeDateRange(filter: FilterOptions): {
  dateFrom?: string
  dateTo?: string
} {
  if (!filter.year) return {}

  const year = parseInt(filter.year)
  if (isNaN(year)) return {}

  if (!filter.month) {
    return {
      dateFrom: new Date(year, 0, 1).toISOString(),
      dateTo: new Date(year, 11, 31, 23, 59, 59, 999).toISOString(),
    }
  }

  const monthIndex = parseInt(filter.month) - 1
  if (isNaN(monthIndex)) return {}

  return {
    dateFrom: new Date(year, monthIndex, 1).toISOString(),
    dateTo: new Date(year, monthIndex + 1, 0, 23, 59, 59, 999).toISOString(),
  }
}

/** 검색 대상 텍스트: 주문 내 상품명 전체 */
const orderSearchText = (o: HttpTypes.StoreOrder) =>
  (o.items ?? [])
    .map((it) => it.title || it.variant?.product?.title || "")
    .join(" ")

/** created_at 의 날짜 키 (YYYY-MM-DD) */
const dayKey = (o: HttpTypes.StoreOrder) =>
  formatDate(o.created_at, DATE_FORMATS.ISO_DATE)

/**
 * 페이지당 PAGE_SIZE 건씩 나누되, 페이지 경계가 날짜 중간을 가르지 않도록
 * 마지막 건과 같은 날짜의 주문은 모두 같은 페이지에 포함시킨다.
 */
function paginateByDate(
  orders: HttpTypes.StoreOrder[],
  size: number
): HttpTypes.StoreOrder[][] {
  const pages: HttpTypes.StoreOrder[][] = []
  let i = 0
  while (i < orders.length) {
    let end = Math.min(i + size, orders.length)
    if (end < orders.length) {
      const boundary = dayKey(orders[end - 1]!)
      while (end < orders.length && dayKey(orders[end]!) === boundary) end++
    }
    pages.push(orders.slice(i, end))
    i = end
  }
  return pages
}

export function OrderList({
  initialOrders,
  hasError = false,
  initialActionsMap = {},
  embedded = false,
}: OrderListClientProps) {
  const tStatus = useTranslations("mypage.order.status")
  const tList = useTranslations("mypage.order.list")
  const tEmpty = useTranslations("mypage.empty")

  const [period, setPeriod] = useState<string>("recent")
  const [rawOrders, setRawOrders] =
    useState<HttpTypes.StoreOrder[]>(initialOrders)
  const [actionsMap, setActionsMap] =
    useState<Record<string, StoreOrderActionsResponse>>(initialActionsMap)
  const [refundMap, setRefundMap] = useState<Record<string, string>>({})
  const [page, setPage] = useState(0)
  const [isFiltering, startFilterTransition] = useTransition()

  // 상품명 검색
  const {
    input: searchInput,
    setInput: setSearchInput,
    filtered: filteredRaw,
  } = useSearchFilter(rawOrders, orderSearchText)

  const pages = useMemo(
    () => paginateByDate(filteredRaw, PAGE_SIZE),
    [filteredRaw]
  )
  const safePage = Math.min(page, Math.max(0, pages.length - 1))
  const pageRaw = useMemo(() => pages[safePage] ?? [], [pages, safePage])
  const orders = useMemo(
    () => pageRaw.map((o) => mapStoreOrderToOrderItem(o, { tStatus, tList })),
    [pageRaw, tStatus, tList]
  )

  // 현재 페이지 주문의 Core 액션(상태/버튼) 조회
  useEffect(() => {
    const targets = pageRaw.filter((o) => !(o.id in actionsMap))
    if (targets.length === 0) return
    let cancelled = false
    void (async () => {
      const results = await Promise.allSettled(
        targets.map((o) => getOrderActionsByMedusaId(o.id))
      )
      if (cancelled) return
      setActionsMap((prev) => {
        const next = { ...prev }
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next[targets[i]!.id] = r.value
        })
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [pageRaw, actionsMap])

  // 현재 페이지 무통장 확정 주문의 환불신청 상태 조회
  useEffect(() => {
    const targets = pageRaw.filter((o) => {
      const bts = (o.metadata as Record<string, unknown> | null)
        ?.bank_transfer_status
      const intentId = (
        o.payment_collections?.[0]?.payment_sessions?.[0]?.data as
          | Record<string, unknown>
          | undefined
      )?.intentId as string | undefined
      return bts === "confirmed" && !!intentId && !(o.id in refundMap)
    })
    if (targets.length === 0) return
    let cancelled = false
    void (async () => {
      const results = await Promise.allSettled(
        targets.map(async (o) => {
          const intentId = (
            o.payment_collections![0]!.payment_sessions![0]!.data as Record<
              string,
              unknown
            >
          ).intentId as string
          const rr = await getActiveRefundRequest(intentId)
          return [o.id, rr?.status ?? ""] as const
        })
      )
      if (cancelled) return
      setRefundMap((prev) => {
        const next = { ...prev }
        results.forEach((r, idx) => {
          if (r.status === "fulfilled") next[r.value[0]] = r.value[1]
          else next[targets[idx]!.id] = ""
        })
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [pageRaw, refundMap])

  // 기간 pill: "recent"(최근 6개월) 또는 연도 문자열
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i)

  const handlePeriodChange = (next: string) => {
    setPeriod(next)
    setPage(0)
    let range: { dateFrom?: string; dateTo?: string }
    if (next === "recent") {
      const from = new Date()
      from.setMonth(from.getMonth() - 6)
      range = { dateFrom: from.toISOString(), dateTo: new Date().toISOString() }
    } else {
      range = computeDateRange({ year: next, month: "" } as FilterOptions)
    }
    startFilterTransition(async () => {
      const result = await getOrders({
        limit: FETCH_LIMIT,
        offset: 0,
        ...range,
      })
      if (result) {
        setRawOrders(result.orders ?? [])
        setActionsMap({})
        setRefundMap({})
      }
    })
  }

  if (hasError) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-gray-500">{tList("errorTitle")}</p>
      </div>
    )
  }

  // 원본 데이터가 없으면 빈 화면
  if (initialOrders.length === 0 && !isFiltering) {
    return (
      <div className="bg-muted min-h-screen px-3 py-4 md:bg-transparent md:px-6">
        <div className="hidden md:block">
          <PageTitle>{tList("title")}</PageTitle>
        </div>
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Package className="h-12 w-12 text-gray-300" />
          <div className="text-center">
            <p className="text-lg font-medium text-gray-600">
              {tEmpty("orderTitle")}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {tEmpty("orderDescription")}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "bg-muted md:bg-transparent",
        embedded ? "md:px-0 md:py-0" : "min-h-screen md:px-6 md:py-4"
      )}
    >
      {/* 검색 + 기간 필터 */}
      <div className="space-y-3 bg-white px-4 py-3 md:bg-transparent md:p-0">
        <div className="hidden md:block">
          <PageTitle>{tList("title")}</PageTitle>
        </div>
        <div className="relative md:mt-5 md:max-w-xl">
          <input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value)
              setPage(0)
            }}
            placeholder={tList("searchPlaceholder")}
            className="focus:border-primary w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 pr-10 text-sm outline-none"
          />
          <Search className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
        </div>
        {/* 기간 필터 pill (PC 전용) */}
        <div className="hidden gap-2 overflow-x-auto md:flex [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => handlePeriodChange("recent")}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1 text-sm font-medium whitespace-nowrap transition-colors",
              period === "recent"
                ? "border-primary bg-primary text-white"
                : "hover:border-primary border-gray-200 text-gray-600"
            )}
          >
            {tList("recent6m")}
          </button>
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => handlePeriodChange(String(y))}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1 text-sm font-medium whitespace-nowrap transition-colors",
                period === String(y)
                  ? "border-primary bg-primary text-white"
                  : "hover:border-primary border-gray-200 text-gray-600"
              )}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {isFiltering ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4">
          <Package className="h-12 w-12 text-gray-300" />
          <div className="text-center">
            <p className="text-lg font-medium text-gray-600">
              {tEmpty("orderPeriodTitle")}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {tEmpty("orderPeriodDescription")}
            </p>
          </div>
        </div>
      ) : (
        <>
          <section className="mt-2 space-y-2 md:mt-4 md:space-y-6">
            {orders.map((order) => {
              const actions = actionsMap[order.orderId]
              const refund = refundMap[order.orderId]
              const displayStatus =
                refund === "REQUESTED"
                  ? "환불 신청됨 · 처리 대기중"
                  : actions
                    ? getCoreDisplayStatus(actions)
                    : order.status
              return (
                <OrderSummaryCard
                  key={order.orderId}
                  orderId={order.orderId}
                  orderDate={order.orderDate}
                  orderNumber={order.orderNumber}
                  status={displayStatus}
                  deliveryInfo={order.deliveryInfo}
                  productName={order.productName}
                  productImage={order.productImage}
                  price={order.price}
                  quantity={order.quantity}
                  options={order.options}
                >
                  <OrderActions
                    orderId={order.orderId}
                    paymentStatus={order.paymentStatus}
                    productName={order.productName}
                    variantId={order.variantId}
                    orderItems={order.orderItems}
                    showInquiry={order.showInquiry}
                    coreActions={actions}
                    bankTransferStatus={order.bankTransferStatus}
                    refundRequestStatus={refund}
                  />
                </OrderSummaryCard>
              )
            })}
          </section>

          {pages.length > 1 && (
            <div className="flex items-center justify-center gap-2 py-6">
              <Button
                variant="outline"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                {tList("prevPage")}
              </Button>
              <Button
                variant="outline"
                disabled={safePage >= pages.length - 1}
                onClick={() =>
                  setPage((p) => Math.min(pages.length - 1, p + 1))
                }
              >
                {tList("nextPage")}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
