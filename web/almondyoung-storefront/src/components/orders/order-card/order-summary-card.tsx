import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import type { ReactNode } from "react"
import OrderCard from "./order-card"

function statusColor(label: string): string {
  if (label.includes("배송"))
    return label.includes("완료") ? "text-green-600" : "text-primary"
  return "text-gray-900"
}

interface OrderSummaryCardProps {
  orderId: string
  orderDate: string
  orderNumber?: string
  status: string
  /** 도착 예정일 등. 물류 API 연동 전까지는 대개 빈 값 */
  deliveryInfo?: string
  productName: string
  productImage: string
  price: string
  quantity?: string
  options?: string[]
  children?: ReactNode
}

/**
 * 주문/배송 요약 카드
 */
export default function OrderSummaryCard({
  orderId,
  orderDate,
  orderNumber,
  status,
  deliveryInfo,
  productName,
  productImage,
  price,
  quantity,
  options = [],
  children,
}: OrderSummaryCardProps) {
  return (
    <OrderCard
      orderId={orderId}
      orderDate={orderDate}
      orderNumber={orderNumber}
    >
      {/* 상태 */}
      <p className="mb-3 text-base font-bold md:text-lg">
        <span className={statusColor(status)}>{status}</span>
        {deliveryInfo && (
          <span className="text-gray-500"> · {deliveryInfo}</span>
        )}
      </p>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <LocalizedClientLink
          href={`/mypage/order/details?orderId=${orderId}`}
          className="flex min-w-0 flex-1 items-center gap-3.5"
        >
          <figure className="shrink-0">
            <img
              className="h-20 w-20 rounded-md border border-[#ececec] object-cover"
              src={getThumbnailUrl(productImage)}
              alt={productName}
            />
          </figure>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-sm font-medium text-black md:text-base">
              {productName}
            </p>
            <div className="text-xs text-gray-500 md:text-sm">
              <p>
                {price}
                {quantity ? ` · ${quantity}` : ""}
              </p>
              {options.map((option, index) => (
                <p key={index}>- {option}</p>
              ))}
            </div>
          </div>
        </LocalizedClientLink>

        {children && (
          <div className="flex shrink-0 flex-col gap-2 md:w-40">{children}</div>
        )}
      </div>
    </OrderCard>
  )
}
