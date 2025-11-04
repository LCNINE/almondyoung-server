"use client"

import { ShippingProduct, OrderStatus } from "@components/orders/types"
import { PageTitle } from "@components/common/page-title"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import OrderCard from "@components/orders/order-card/order-card"

/**
 * (가상) Order 타입을 정의합니다.
 * OrderCardsList와 OrderCard의 props를 기반으로 재구성했습니다.
 */
interface Order {
  id: string
  /**
   * OrderCardsList가 이 값을 그룹 헤더로 사용합니다.
   * 이미지 UI와 맞추기 위해 "날짜 + 주문유형"을 문자열로 전달합니다.
   */
  date: string
  status: OrderStatus
  deliveryDate?: string
  guaranteeLabel?: string
  isSeparateDelivery?: boolean
  products: ShippingProduct[]
}

export function ExchangeClient() {
  const handleMoreClick = (orderId: string) => {
    console.log("주문 상세보기 클릭 (ID):", orderId)
  }

  return (
    <div className="min-h-screen bg-white py-4 md:px-6">
      <PageTitle>반품/교환/환불 목록</PageTitle>

      <section className="space-y-6">
        <OrderCard orderDate={"6월 15일"}>
          <OrderCardContent
            status={"취소/교환/반품"}
            deliveryInfo={"6/18(화) 도착"}
            productName={"노몬드 속눈썹 영양제 블랙"}
            productImage={"/images/sample-cosmetic.png"}
            price={"9,000원"}
            quantity={2}
            options={["- 브러쉬 타입 1개", "- 마스카라 타입 1개"]}
            showInquiry={false}
          />
        </OrderCard>
      </section>
    </div>
  )
}
