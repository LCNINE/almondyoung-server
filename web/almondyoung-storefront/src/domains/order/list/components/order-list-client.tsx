"use client"

import { PageTitle } from "@/components/shared/page-title"
import OrderCard from "@components/orders/order-card/order-card"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import { OrderFilter } from "./shared/order-filter"
import { useEffect, useState } from "react"
import { getOrders } from "@lib/api/medusa/orders"
import { Spinner } from "@/components/shared/spinner"
import { Package } from "lucide-react"

interface OrderItem {
  orderId: string
  orderDate: string
  status: string
  deliveryInfo: string
  shippingNote: string
  productName: string
  productImage: string
  price: string
  quantity: number
  options: string[]
  showInquiry: boolean
}

export function OrderListClient() {
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const ordersData = await getOrders({ limit: 50 })

        const mappedOrders: OrderItem[] = (ordersData?.orders || []).map(
          (order) => {
            const orderDate = new Date(order.created_at)
            const formatDate = `${orderDate.getMonth() + 1}월 ${orderDate.getDate()}일`

            // 주문 상태 매핑
            let status = "결제 완료"
            let deliveryInfo = ""

            const fulfillmentStatus = order.fulfillment_status
            const paymentStatus = order.payment_status

            if (paymentStatus === "awaiting") {
              status = "결제 대기"
            } else if (fulfillmentStatus === "fulfilled") {
              status = "배송 완료"
            } else if (fulfillmentStatus === "shipped") {
              status = "배송 중"
            } else if (fulfillmentStatus === "partially_fulfilled") {
              status = "부분 배송"
            } else if (fulfillmentStatus === "not_fulfilled") {
              status = "상품 준비 중"
            } else if (order.status === "canceled") {
              status = "취소됨"
            }

            // 첫 번째 상품 정보
            const firstItem = order.items?.[0]
            const productName =
              firstItem?.title || firstItem?.variant?.product?.title || "상품"
            const productImage =
              firstItem?.thumbnail ||
              firstItem?.variant?.product?.thumbnail ||
              "https://placehold.co/80x80"
            const price = `${(order.total / 100).toLocaleString()}원`

            const options: string[] = []
            if (firstItem?.variant?.title && firstItem.variant.title !== "Default") {
              options.push(firstItem.variant.title)
            }

            return {
              orderId: order.id,
              orderDate: formatDate,
              status,
              deliveryInfo,
              shippingNote: "",
              productName,
              productImage,
              price,
              quantity: order.items?.length || 0,
              options,
              showInquiry: status === "배송 완료",
            }
          }
        )

        setOrders(mappedOrders)
      } catch (err) {
        console.error("주문 목록 조회 실패:", err)
        setError("주문 목록을 불러오는데 실패했습니다")
      } finally {
        setIsLoading(false)
      }
    }

    fetchOrders()
  }, [])

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" color="gray" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-gray-500">{error}</p>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="min-h-screen bg-white px-3 py-4 md:px-6">
        <PageTitle>주문 목록</PageTitle>
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Package className="h-12 w-12 text-gray-300" />
          <div className="text-center">
            <p className="text-lg font-medium text-gray-600">주문 내역이 없습니다</p>
            <p className="mt-1 text-sm text-gray-400">
              첫 주문을 시작해보세요
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white px-3 py-4 md:px-6">
      <PageTitle>주문 목록</PageTitle>
      <section className="my-5">
        <OrderFilter />
      </section>
      <section className="space-y-6">
        {orders.map((order) => (
          <OrderCard
            key={order.orderId}
            orderId={order.orderId}
            orderDate={order.orderDate}
          >
            <OrderCardContent
              orderId={order.orderId}
              status={order.status}
              deliveryInfo={order.deliveryInfo}
              shippingNote={order.shippingNote}
              productName={order.productName}
              productImage={order.productImage}
              price={order.price}
              quantity={order.quantity}
              options={order.options}
              showInquiry={order.showInquiry}
            />
          </OrderCard>
        ))}
      </section>
    </div>
  )
}
