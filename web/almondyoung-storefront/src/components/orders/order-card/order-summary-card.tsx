"use client"

import { useTranslations } from "next-intl"
import type { ReactNode } from "react"
import OrderCard from "./order-card"
import OrderStatusCards from "./order-status-cards"
import type { OrderSummaryItem } from "./order-summary-items"

export type { OrderSummaryItem } from "./order-summary-items"

interface OrderSummaryCardProps {
  orderId: string
  orderDate: string
  orderNumber?: string
  status: string
  /** 도착 예정일 등. 물류 API 연동 전까지는 대개 빈 값 */
  deliveryInfo?: string
  items: OrderSummaryItem[]
  totalPrice?: string
  /** 포인트 사용 등으로 실결제액이 주문금액보다 적을 때의 주문금액. 취소선으로 앞에 붙는다. */
  originalPrice?: string
  children?: ReactNode
}

export default function OrderSummaryCard({
  orderId,
  orderDate,
  orderNumber,
  status,
  deliveryInfo,
  items,
  totalPrice,
  originalPrice,
  children,
}: OrderSummaryCardProps) {
  const t = useTranslations("mypage.order")

  return (
    <OrderCard
      orderId={orderId}
      orderDate={orderDate}
      orderNumber={orderNumber}
    >
      <OrderStatusCards
        status={status}
        deliveryInfo={deliveryInfo}
        items={items}
        collapsible
      >
        {children}
      </OrderStatusCards>
      {totalPrice && (
        <p className="mt-3 text-right text-sm text-gray-700 md:text-left">
          {t("list.totalPaid")}{" "}
          {originalPrice && (
            <span className="mr-1 text-gray-400 line-through">
              {originalPrice}
            </span>
          )}
          <span className="font-bold text-black">{totalPrice}</span>
        </p>
      )}
    </OrderCard>
  )
}
