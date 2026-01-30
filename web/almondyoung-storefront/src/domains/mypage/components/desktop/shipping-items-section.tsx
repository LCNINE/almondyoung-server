"use client"

import OrderCardContent from "@components/orders/order-card/order-card-content"
import { useEffect, useState } from "react"
import { getOrders } from "@lib/api/medusa/orders"
import { Package } from "lucide-react"
import Link from "next/link"

interface ShippingOrder {
  orderId: string
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

export function ShippingItemsSection() {
  const [orders, setOrders] = useState<ShippingOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchShippingOrders = async () => {
      try {
        const ordersData = await getOrders({ limit: 10 })

        const shippingOrders: ShippingOrder[] = (ordersData.orders || [])
          .filter((order: any) => {
            const fulfillmentStatus = order.fulfillment_status
            return (
              fulfillmentStatus === "partially_fulfilled" ||
              fulfillmentStatus === "fulfilled" ||
              fulfillmentStatus === "shipped" ||
              fulfillmentStatus === "not_fulfilled"
            )
          })
          .slice(0, 3)
          .map((order: any) => {
            const fulfillmentStatus = order.fulfillment_status
            let status = "상품 준비 중"
            let deliveryInfo = ""

            if (
              fulfillmentStatus === "shipped" ||
              fulfillmentStatus === "fulfilled"
            ) {
              status = "배송 중"
            } else if (fulfillmentStatus === "partially_fulfilled") {
              status = "부분 배송 중"
            }

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
          })

        setOrders(shippingOrders)
      } catch (error) {
        console.error("배송 중 주문 조회 실패:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchShippingOrders()
  }, [])

  if (isLoading) {
    return (
      <section
        aria-labelledby="shipping-items-heading"
        className="bg-background mt-6 rounded-lg p-8"
      >
        <p className="text-sm text-gray-500">로딩 중...</p>
      </section>
    )
  }

  if (orders.length === 0) {
    return (
      <section
        aria-labelledby="shipping-items-heading"
        className="bg-background mt-6 rounded-lg p-8"
      >
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <Package className="h-12 w-12 text-gray-300" />
          <div className="text-center">
            <p className="text-base font-medium text-gray-600">
              배송 중인 상품이 없습니다
            </p>
            <p className="mt-1 text-sm text-gray-400">
              새로운 상품을 주문해보세요
            </p>
          </div>
          <Link
            href="/kr"
            className="mt-2 rounded-md bg-amber-500 px-4 py-2 text-sm text-white transition-colors hover:bg-amber-600"
          >
            쇼핑하러 가기
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="shipping-items-heading"
      className="bg-background mt-6 space-y-4 rounded-lg p-8"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-black">배송 중 상품</h2>
        <Link
          href="/kr/mypage/order/list"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          전체보기
        </Link>
      </div>
      {orders.map((order) => (
        <OrderCardContent
          key={order.orderId}
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
      ))}
    </section>
  )
}
