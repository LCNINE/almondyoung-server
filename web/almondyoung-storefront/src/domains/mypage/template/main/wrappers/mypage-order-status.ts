import type { HttpTypes } from "@medusajs/types"
import type { OrderStatus } from "../../../types/mypage-types"

const getOrderStatusLabel = (order: HttpTypes.StoreOrder): string => {
  if (order.status === "canceled") return "취소됨"
  if (order.payment_status === "awaiting") return "결제 대기"
  if (order.fulfillment_status === "fulfilled") return "배송 완료"
  if (order.fulfillment_status === "shipped") return "배송 중"
  if (order.fulfillment_status === "partially_fulfilled") return "부분 배송"
  if (order.fulfillment_status === "not_fulfilled") return "상품 준비 중"
  return "결제 완료"
}

export const resolveMypageShippingStatus = (order: HttpTypes.StoreOrder) => {
  const statusLabel = getOrderStatusLabel(order)

  if (statusLabel === "배송 중" || statusLabel === "부분 배송") {
    return { statusLabel, status: "SHIPPING" as OrderStatus }
  }

  if (statusLabel === "상품 준비 중") {
    return { statusLabel, status: "PREPARING" as OrderStatus }
  }

  return null
}
