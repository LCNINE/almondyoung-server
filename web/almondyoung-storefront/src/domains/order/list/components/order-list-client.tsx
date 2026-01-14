"use client"

import { PageTitle } from "@/components/shared/page-title"
import { useOrderList } from "../hooks/use-order-list"
import { groupOrdersByDate } from "../../../../components/orders/utils"

import OrderCard from "@components/orders/order-card/order-card"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import { OrderFilter } from "./shared/order-filter"

// Mock 주문 데이터
const mockOrders = [
  {
    orderId: "ORD-2025-0615-001",
    orderDate: "6월 15일",
    status: "배송 완료",
    deliveryInfo: "6/18(화) 도착",
    shippingNote: "문 앞 배송",
    productName: "초경량 하이킹 백팩 25L (블랙)",
    productImage: "/images/backpack.jpg",
    price: "89,000원",
    quantity: 1,
    options: ["옵션: 블랙"],
    showInquiry: true,
  },
  {
    orderId: "ORD-2025-0610-002",
    orderDate: "6월 10일",
    status: "배송 중",
    deliveryInfo: "6/12(금) 도착 예정",
    shippingNote: "경비실 보관",
    productName: "노모드 속눈썹 영양제 블랙",
    productImage:
      "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
    price: "9,000원",
    quantity: 2,
    options: ["브러쉬 타입 1개", "마스카라 타입 1개"],
    showInquiry: true,
  },
  {
    orderId: "ORD-2025-0601-003",
    orderDate: "6월 1일",
    status: "결제 완료",
    deliveryInfo: "",
    shippingNote: "",
    productName: "프로페셔널 네일 아트 키트",
    productImage: "/images/nail-kit.jpg",
    price: "45,000원",
    quantity: 1,
    options: ["풀세트"],
    showInquiry: false,
  },
]
export function OrderListClient() {
  const { orders, handleFilterChange, handleMoreClick } = useOrderList()
  const groupedOrders = groupOrdersByDate(orders)

  return (
    <div className="min-h-screen bg-white px-3 py-4 md:px-6">
      <PageTitle>주문 목록</PageTitle>
      {/* <FrequentProducts />  이건 잠시 보류 물어볼것 */}
      <section className="my-5">
        <OrderFilter />
      </section>
      <section className="space-y-6">
        {mockOrders.map((order) => (
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
