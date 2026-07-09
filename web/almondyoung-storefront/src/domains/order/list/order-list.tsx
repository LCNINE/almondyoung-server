"use client"

import { PageTitle } from "@/components/shared/page-title"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
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
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { usePathname, useRouter } from "next/navigation"
import { useMemo, useTransition } from "react"

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

interface OrderListProps {
  orders: HttpTypes.StoreOrder[]
  /** 1-base 현재 페이지 */
  page: number
  /** 전체 페이지 수 */
  pageCount: number
  /** "recent" 또는 연도 문자열 */
  period: string
  /** 상품명 검색어 (없으면 "") */
  q: string
  /** 필터 적용된 전체 주문 수 (검색 결과 요약 표시용) */
  count: number
  actionsMap: Record<string, StoreOrderActionsResponse>
  refundMap: Record<string, string>
  hasError?: boolean
  /** 마이페이지 홈 안에 끼워 넣어 쓸 때 true — 페이지 전용 여백/최소높이 제거 */
  embedded?: boolean
}

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

export function OrderList({
  orders: rawOrders,
  page,
  pageCount,
  period,
  q,
  count,
  actionsMap,
  refundMap,
  hasError = false,
  embedded = false,
}: OrderListProps) {
  const tStatus = useTranslations("mypage.order.status")
  const tList = useTranslations("mypage.order.list")
  const tEmpty = useTranslations("mypage.empty")

  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const orders = useMemo(
    () => rawOrders.map((o) => mapStoreOrderToOrderItem(o, { tStatus, tList })),
    [rawOrders, tStatus, tList]
  )

  const navigate = (next: { page?: number; period?: string; q?: string }) => {
    const nextPage = next.page ?? 1
    const nextPeriod = next.period ?? period
    const nextQ = (next.q ?? q).trim()
    const params = new URLSearchParams()
    if (nextPage > 1) params.set("page", String(nextPage))
    if (nextPeriod !== "recent") params.set("period", nextPeriod)
    if (nextQ) params.set("q", nextQ)
    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  // 기간 pill: "recent"(최근 6개월) 또는 연도 문자열
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i)

  if (hasError) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-gray-500">{tList("errorTitle")}</p>
      </div>
    )
  }

  // 기본 진입(최근 6개월 1페이지, 검색 없음)이 비어있으면 주문 자체가 없는 상태
  if (
    orders.length === 0 &&
    page === 1 &&
    period === "recent" &&
    !q &&
    !isPending
  ) {
    return (
      <div className="min-h-screen px-3 py-4 bg-muted md:bg-transparent md:px-6">
        <div className="hidden md:block">
          <PageTitle>{tList("title")}</PageTitle>
        </div>
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Package className="w-12 h-12 text-gray-300" />
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
      <div className="px-4 py-3 space-y-3 bg-white md:bg-transparent md:p-0">
        <div className="hidden md:block">
          <PageTitle>{tList("title")}</PageTitle>
        </div>
        {/* 상품명 검색 */}
        <form
          className="relative md:mt-5 md:max-w-xl"
          onSubmit={(e) => {
            e.preventDefault()
            const value = new FormData(e.currentTarget).get("q")
            navigate({ page: 1, q: String(value ?? "") })
          }}
        >
          <Input
            name="q"
            key={q}
            defaultValue={q}
            placeholder={tList("searchPlaceholder")}
            className={cn("bg-white", q ? "pr-16" : "pr-10")}
          />
          {/* 검색 적용 중일 때만 초기화(X) 노출 */}
          {q && (
            <button
              type="button"
              aria-label={tList("clearSearch")}
              onClick={() => navigate({ page: 1, q: "" })}
              className="absolute -translate-y-1/2 cursor-pointer top-1/2 right-9 rounded-full bg-gray-300 p-0.5 hover:bg-gray-400"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          )}
          <button
            type="submit"
            aria-label={tList("searchPlaceholder")}
            className="absolute -translate-y-1/2 cursor-pointer top-1/2 right-3"
          >
            <Search className="w-4 h-4 text-gray-400" />
          </button>
        </form>
        <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => navigate({ page: 1, period: "recent" })}
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
              onClick={() => navigate({ page: 1, period: String(y) })}
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
        {/* 검색 적용 중: 결과 요약 + 검색어 초기화 버튼 (눈에 띄는 해제 지점) */}
        {q && !isPending && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-700">
              {tList("searchResultCount", { q, count })}
            </p>
            <button
              type="button"
              onClick={() => navigate({ page: 1, q: "" })}
              className="hover:border-primary hover:text-primary flex cursor-pointer items-center gap-1 rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600 transition-colors"
            >
              <X className="w-3 h-3" />
              {tList("clearSearch")}
            </button>
          </div>
        )}
      </div>

      {isPending ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4">
          <Package className="w-12 h-12 text-gray-300" />
          <div className="text-center">
            <p className="text-lg font-medium text-gray-600">
              {tEmpty(q ? "orderSearchTitle" : "orderPeriodTitle")}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {tEmpty(q ? "orderSearchDescription" : "orderPeriodDescription")}
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

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-2 py-6">
              <Button
                variant="outline"
                disabled={page <= 1 || isPending}
                onClick={() => navigate({ page: page - 1 })}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {tList("prevPage")}
              </Button>
              <Button
                variant="outline"
                disabled={page >= pageCount || isPending}
                onClick={() => navigate({ page: page + 1 })}
              >
                {tList("nextPage")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
