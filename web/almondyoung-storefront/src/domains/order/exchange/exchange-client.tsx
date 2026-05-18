"use client"

import { PageTitle } from "@/components/shared/page-title"
import { ShippingProduct, OrderStatus } from "@components/orders/types"
import { useTranslations } from "next-intl"
import { ExchangeOrderCard } from "./exchange-order-card"
import { ReturnOrderCard } from "./return-order-card"
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
  const t = useTranslations("mypage.order.exchange")

  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>{t("pageTitle")}</PageTitle>

      <section className="space-y-6">
        <ReturnOrderCard
          status={t("returned")}
          statusInfo={t("dateReturned", { date: "2025. 05. 12" })}
          productName={"노몬드 속눈썹 영양제 블랙"}
          productImage={"/images/sample-cosmetic.png"}
          price={"9,000원"}
          quantity={2}
          options={["- 브러쉬 타입 1개", "- 마스카라 타입 1개"]}
          returnDate={"2025. 05. 12"}
        />
        <ExchangeOrderCard
          exchangeDate={"2025. 05. 12"}
          status={t("exchanged")}
          productName={"노몬드 속눈썹 영양제 블랙"}
          productImage={"/images/sample-cosmetic.png"}
          price={"9,000원"}
          quantity={2}
          options={["- 브러쉬 타입 1개", "- 마스카라 타입 1개"]}
          orderDate={"2025. 05. 12"}
        />
      </section>
    </div>
  )
}
