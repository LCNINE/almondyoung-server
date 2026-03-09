import OrderCardContent from "@components/orders/order-card/order-card-content"
import { Package } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { ShippingOrder } from "../../types/mypage-types"

interface ShippingItemsSectionProps {
  initialOrders: ShippingOrder[]
}

export function ShippingItemsSection({
  initialOrders,
}: ShippingItemsSectionProps) {
  if (initialOrders.length === 0) {
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
          <Button asChild>
            <Link
              href="/kr/best"
              className="mt-2 rounded-md px-4 py-2 text-sm text-white transition-colors"
            >
              쇼핑하러 가기
            </Link>
          </Button>
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
      {initialOrders.map((order) => (
        <OrderCardContent
          key={order.orderId}
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
        />
      ))}
    </section>
  )
}
