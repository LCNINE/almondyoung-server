import React from "react"
import { Truck } from "lucide-react"

const FREE_SHIPPING_THRESHOLD = 50000 // 무료배송 기준금액

interface ShippingNoticeProps {
  shippingTotal: number
  selectedTotal: number // 선택된 상품의 총 금액
  variant?: "mobile" | "desktop"
}

export function ShippingNotice({
  shippingTotal,
  selectedTotal,
  variant = "mobile",
}: ShippingNoticeProps) {
  // 무료배송 달성 여부
  const isFreeShipping = selectedTotal >= FREE_SHIPPING_THRESHOLD
  // 프로그레스 퍼센트 (최대 100%)
  const progressPercent = Math.min(
    (selectedTotal / FREE_SHIPPING_THRESHOLD) * 100,
    100
  )
  // 무료배송까지 남은 금액
  const remainingAmount = Math.max(FREE_SHIPPING_THRESHOLD - selectedTotal, 0)

  // 표시 라벨
  const shippingLabel = isFreeShipping
    ? "무료배송"
    : `배송비 ${shippingTotal.toLocaleString()}원`

  // 안내 메시지
  const guideMessage = isFreeShipping
    ? "무료배송 조건을 충족했습니다!"
    : `${remainingAmount.toLocaleString()}원 더 담으면 무료배송`

  if (variant === "mobile") {
    return (
      <aside className="shipping-notice" role="complementary">
        <div className="notice-container rounded-lg py-3">
          <div className="notice-inner">
            <div className="notice-header flex justify-between text-xs font-semibold">
              <span className="notice-label text-base font-semibold">
                배송비 안내
              </span>
              <span className="notice-info text-sm">{shippingLabel}</span>
            </div>
            <div className="text-gray-60 mt-1 text-xs">{guideMessage}</div>
            <div className="mt-3 flex items-center gap-2">
              <div className="bg-yellow-10 relative h-2 flex-1 rounded-full">
                <div
                  className="bg-yellow-30 absolute h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className={isFreeShipping ? "text-yellow-30" : "text-gray-300"}>
                <Truck className="h-5 w-5" />
              </div>
            </div>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <div className="border-b px-8 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-3xl font-semibold">배송비 안내</span>
          <span className="text-xs font-medium">{shippingLabel}</span>
        </div>
        <span className="text-gray-60 text-sm">{guideMessage}</span>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <div className="bg-yellow-10 relative h-2.5 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-yellow-30 absolute h-2.5 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className={isFreeShipping ? "text-yellow-30" : "text-gray-300"}>
          <Truck className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}
