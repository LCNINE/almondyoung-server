"use client"

import { PageTitle } from "@/components/shared/page-title"
import { Button } from "@/components/ui/button"
import { getOrders } from "@/lib/api/medusa/orders"
import { getOrderActionsByMedusaId, type StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import OrderCard from "@components/orders/order-card/order-card"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import type { HttpTypes } from "@medusajs/types"
import { Loader2, Package } from "lucide-react"
import { useTranslations } from "next-intl"
import { useMemo, useState, useTransition } from "react"
import { OrderFilter, type FilterOptions } from "./shared/order-filter"

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
}

interface OrderListClientProps {
  initialOrders: HttpTypes.StoreOrder[]
  initialCount: number
  initialLimit: number
  hasError?: boolean
  initialActionsMap?: Record<string, StoreOrderActionsResponse>
}

const LOAD_MORE_LIMIT = 20

const getOrderStatusKey = (order: HttpTypes.StoreOrder): string => {
  if (order.status === "canceled") return "cancelled"
  if (order.payment_status === "awaiting") return "paymentPending"
  if (order.fulfillment_status === "fulfilled") return "delivered"
  if (order.fulfillment_status === "shipped") return "shipping"
  if (order.fulfillment_status === "partially_fulfilled") return "partialShipping"
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
  }
}

/** FilterOptions의 year/month 값으로 API에 넘길 날짜 범위를 계산한다. */
function computeDateRange(filter: FilterOptions): { dateFrom?: string; dateTo?: string } {
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

export function OrderList({
  initialOrders,
  initialCount,
  initialLimit: _initialLimit,
  hasError = false,
  initialActionsMap = {},
}: OrderListClientProps) {
  const tStatus = useTranslations("mypage.order.status")
  const tList = useTranslations("mypage.order.list")
  const tEmpty = useTranslations("mypage.empty")

  const [filter, setFilter] = useState<FilterOptions>({ year: "", month: "" })
  const [currentDateRange, setCurrentDateRange] = useState<{ dateFrom?: string; dateTo?: string }>({})
  const [rawOrders, setRawOrders] = useState<HttpTypes.StoreOrder[]>(initialOrders)
  const [actionsMap, setActionsMap] = useState<Record<string, StoreOrderActionsResponse>>(initialActionsMap)
  const [totalCount, setTotalCount] = useState(initialCount)
  const [isFiltering, startFilterTransition] = useTransition()
  const [isPending, startLoadMoreTransition] = useTransition()

  const hasMore = rawOrders.length < totalCount

  const orders: OrderItem[] = useMemo(
    () => rawOrders.map((o) => mapStoreOrderToOrderItem(o, { tStatus, tList })),
    [rawOrders, tStatus, tList]
  )

  const handleFilterChange = (newFilter: FilterOptions) => {
    setFilter(newFilter)
    const dateRange = computeDateRange(newFilter)
    setCurrentDateRange(dateRange)

    startFilterTransition(async () => {
      const result = await getOrders({ limit: LOAD_MORE_LIMIT, offset: 0, ...dateRange })

      if (result) {
        setRawOrders(result.orders ?? [])
        setTotalCount(result.count ?? 0)

        const newActions = await Promise.allSettled(
          (result.orders ?? []).map((o: HttpTypes.StoreOrder) => getOrderActionsByMedusaId(o.id))
        )
        const nextMap: Record<string, StoreOrderActionsResponse> = {}
        newActions.forEach((r, idx) => {
          const order = (result.orders ?? [])[idx]
          if (r.status === "fulfilled" && order) {
            nextMap[order.id] = r.value
          }
        })
        setActionsMap(nextMap)
      }
    })
  }

  const handleLoadMore = () => {
    startLoadMoreTransition(async () => {
      const result = await getOrders({
        limit: LOAD_MORE_LIMIT,
        offset: rawOrders.length,
        ...currentDateRange,
      })

      if (result?.orders) {
        setRawOrders((prev) => [...prev, ...result.orders])
        if (typeof result.count === "number") {
          setTotalCount(result.count)
        }
        const newActions = await Promise.allSettled(
          result.orders.map((o: HttpTypes.StoreOrder) => getOrderActionsByMedusaId(o.id))
        )
        setActionsMap((prev) => {
          const next = { ...prev }
          newActions.forEach((r, idx) => {
            if (r.status === "fulfilled" && result.orders[idx]) {
              next[result.orders[idx]!.id] = r.value
            }
          })
          return next
        })
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

  // 원본 데이터가 없으면 필터 없이 빈 화면
  if (initialOrders.length === 0 && !isFiltering) {
    return (
      <div className="min-h-screen bg-white px-3 py-4 md:px-6">
        <PageTitle>{tList("title")}</PageTitle>
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
    <div className="min-h-screen bg-white px-3 py-4 md:px-6">
      <PageTitle>{tList("title")}</PageTitle>
      <section className="my-5">
        <OrderFilter
          onFilterChange={handleFilterChange}
          defaultYear={filter.year}
          defaultMonth={filter.month}
        />
      </section>

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
        <section className="space-y-6">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId}
              orderId={order.orderId}
              orderDate={order.orderDate}
              orderNumber={order.orderNumber}
            >
              <OrderCardContent
                orderId={order.orderId}
                status={order.status}
                paymentStatus={order.paymentStatus}
                deliveryInfo={order.deliveryInfo}
                shippingNote={order.shippingNote}
                productName={order.productName}
                productImage={order.productImage}
                price={order.price}
                quantity={order.quantity}
                options={order.options}
                showInquiry={order.showInquiry}
                orderItems={order.orderItems}
                variantId={order.variantId}
                coreActions={actionsMap[order.orderId]}
              />
            </OrderCard>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-4 pb-8">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={isPending}
                className="w-full max-w-xs"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {tList("loadingMore")}
                  </>
                ) : (
                  tList("loadMore", {
                    loaded: rawOrders.length,
                    total: totalCount,
                  })
                )}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
