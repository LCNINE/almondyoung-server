"use client"

import { PageTitle } from "@/components/shared/page-title"
import { Button } from "@/components/ui/button"
import OrderCard from "@components/orders/order-card/order-card"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import { OrderFilter, type FilterOptions } from "./shared/order-filter"
import { getOrders } from "@/lib/api/medusa/orders"
import { Package, Loader2 } from "lucide-react"
import type { HttpTypes } from "@medusajs/types"
import { useState, useMemo, useTransition } from "react"
import { getYear } from "date-fns"

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
}

const LOAD_MORE_LIMIT = 20

const getKoreanOrderStatus = (order: HttpTypes.StoreOrder): string => {
  if (order.status === "canceled") return "취소됨"
  if (order.payment_status === "awaiting") return "결제 대기"
  if (order.fulfillment_status === "fulfilled") return "배송 완료"
  if (order.fulfillment_status === "shipped") return "배송 중"
  if (order.fulfillment_status === "partially_fulfilled") return "부분 배송"
  if (order.fulfillment_status === "not_fulfilled") return "상품 준비 중"
  return "결제 완료"
}

const mapStoreOrderToOrderItem = (order: HttpTypes.StoreOrder): OrderItem => {
  const orderDate = new Date(order.created_at)
  const formatDate = `${orderDate.getMonth() + 1}월 ${orderDate.getDate()}일`
  const firstItem = order.items?.[0]
  const lineItemCount = order.items?.length ?? 0
  const totalQuantity = (order.items ?? []).reduce(
    (acc, item) => acc + (item.quantity ?? 0),
    0
  )
  const representativeName =
    firstItem?.title || firstItem?.variant?.product?.title || "상품"
  const productName =
    lineItemCount > 1
      ? `${representativeName} 외 ${lineItemCount - 1}건`
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
    status: getKoreanOrderStatus(order),
    paymentStatus: order.payment_status ?? "",
    deliveryInfo: "",
    shippingNote: "",
    productName,
    productImage:
      firstItem?.thumbnail ||
      firstItem?.variant?.product?.thumbnail ||
      "https://placehold.co/80x80",
    price: `${displayPrice.toLocaleString()}원`,
    quantity: `상품 ${lineItemCount}건 · 총 수량 ${totalQuantity}개`,
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

export function OrderList({
  initialOrders,
  initialCount,
  initialLimit,
  hasError = false,
}: OrderListClientProps) {
  const [filter, setFilter] = useState<FilterOptions>({
    year: "전체년도",
    month: "전체",
  })
  const [rawOrders, setRawOrders] =
    useState<HttpTypes.StoreOrder[]>(initialOrders)
  const [totalCount, setTotalCount] = useState(initialCount)
  const [isPending, startTransition] = useTransition()

  const hasMore = rawOrders.length < totalCount

  const allOrders: OrderItem[] = useMemo(
    () => rawOrders.map(mapStoreOrderToOrderItem),
    [rawOrders]
  )

  const orders = useMemo(() => {
    return allOrders.filter((order) => {
      const orderDateMatch = order.orderDate.match(/(\d+)월/)
      const orderMonth = orderDateMatch ? parseInt(orderDateMatch[1]) : null

      const originalOrder = rawOrders.find((o) => o.id === order.orderId)
      const orderYear = originalOrder
        ? getYear(new Date(originalOrder.created_at))
        : null

      const yearMatch =
        filter.year === "전체년도" || String(orderYear) === filter.year

      const monthMatch =
        filter.month === "전체" ||
        (orderMonth !== null && filter.month === `${orderMonth}월`)

      return yearMatch && monthMatch
    })
  }, [allOrders, filter, rawOrders])

  const handleFilterChange = (newFilter: FilterOptions) => {
    setFilter(newFilter)
  }

  const handleLoadMore = () => {
    startTransition(async () => {
      const result = await getOrders({
        limit: LOAD_MORE_LIMIT,
        offset: rawOrders.length,
      })

      if (result?.orders) {
        setRawOrders((prev) => [...prev, ...result.orders])
        if (typeof result.count === "number") {
          setTotalCount(result.count)
        }
      }
    })
  }

  if (hasError) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-gray-500">주문 목록을 불러오는데 실패했습니다</p>
      </div>
    )
  }

  // 원본 데이터가 없으면 필터 없이 빈 화면
  if (allOrders.length === 0) {
    return (
      <div className="min-h-screen bg-white px-3 py-4 md:px-6">
        <PageTitle>주문 목록</PageTitle>
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Package className="h-12 w-12 text-gray-300" />
          <div className="text-center">
            <p className="text-lg font-medium text-gray-600">
              주문 내역이 없습니다
            </p>
            <p className="mt-1 text-sm text-gray-400">첫 주문을 시작해보세요</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white px-3 py-4 md:px-6">
      <PageTitle>주문 목록</PageTitle>
      <section className="my-5">
        <OrderFilter onFilterChange={handleFilterChange} />
      </section>

      {orders.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4">
          <Package className="h-12 w-12 text-gray-300" />
          <div className="text-center">
            <p className="text-lg font-medium text-gray-600">
              해당 기간에 주문 내역이 없습니다
            </p>
            <p className="mt-1 text-sm text-gray-400">
              다른 기간을 선택해보세요
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
                    불러오는 중...
                  </>
                ) : (
                  `더 보기 (${rawOrders.length}/${totalCount})`
                )}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
