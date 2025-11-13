"use client"

import { PageTitle } from "@components/common/page-title"
import { useOrderList } from "../hooks/use-order-list"
import { groupOrdersByDate } from "../../../../components/orders/utils"

import { ArrowRight, MoreVertical } from "lucide-react"
import OrderCard from "@components/orders/order-card/order-card"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import { FrequentProducts } from "./shared/frequent-products"
import { OrderFilter } from "./shared/order-filter"
// 예시 데이터
const orderData = {
  orderDate: "6월 15일",
  status: "배송 완료",
  deliveryInfo: "6/18(화) 도착",
  shippingNote: "문 앞 배송",
  productName: "초경량 하이킹 백팩 25L (블랙)",
  productImage: "/images/backpack.jpg", // 예시 경로
  price: "89,000원",
  quantity: 1,
  options: ["옵션: 블랙"],
  showInquiry: true,
}
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
        <OrderCard orderDate={orderData.orderDate}>
          <OrderCardContent
            status={orderData.status}
            deliveryInfo={orderData.deliveryInfo}
            shippingNote={orderData.shippingNote}
            productName={orderData.productName}
            productImage={orderData.productImage}
            price={orderData.price}
            quantity={orderData.quantity}
            options={orderData.options}
            showInquiry={orderData.showInquiry}
          />
        </OrderCard>
      </section>
    </div>
  )
}
