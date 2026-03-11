import { PageTitle } from "@/components/shared/page-title"
import OrderCard from "@components/orders/order-card/order-card"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import { OrderFilter } from "./shared/order-filter"
import { Package } from "lucide-react"
import type { HttpTypes } from "@medusajs/types"

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
  hasError?: boolean
}

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
  hasError = false,
}: OrderListClientProps) {
  const orders: OrderItem[] = initialOrders.map(mapStoreOrderToOrderItem)

  if (hasError) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-gray-500">주문 목록을 불러오는데 실패했습니다</p>
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
        <OrderFilter />
      </section>
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
      </section>
    </div>
  )
}
