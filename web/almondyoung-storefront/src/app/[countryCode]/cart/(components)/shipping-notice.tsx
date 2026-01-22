import React from "react"
import { Truck } from "lucide-react"

interface ShippingNoticeProps {
  remainingForFreeShipping: number
  freeShippingProgress: number
  variant?: "mobile" | "desktop"
}

export function ShippingNotice({
  remainingForFreeShipping,
  freeShippingProgress,
  variant = "mobile",
}: ShippingNoticeProps) {
  if (variant === "mobile") {
    return (
      <aside className="shipping-notice" role="complementary">
        <div className="notice-container rounded-lg py-3">
          <div className="notice-inner">
            <div className="notice-header flex justify-between text-xs font-semibold">
              <span className="notice-label text-base font-semibold">
                무료배송
              </span>
              <span className="notice-info">
                <span className="highlight text-yellow-30 mr-1 text-sm font-semibold">
                  {remainingForFreeShipping.toLocaleString()}원
                </span>{" "}
                <span className="notice-info text-sm">
                  추가 시 무료배송 (결제금액 기준)
                </span>
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="bg-yellow-10 relative h-2 flex-1 rounded-full">
                <div
                  className="bg-yellow-30 absolute h-2 rounded-full transition-all duration-300"
                  style={{ width: `${freeShippingProgress}%` }}
                />
              </div>
              <div className="text-yellow-30">
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
          <span className="text-3xl font-semibold">무료배송</span>
          <span className="text-xs font-medium">
            {remainingForFreeShipping > 0
              ? `${remainingForFreeShipping.toLocaleString()}원 추가 시 무료배송 (결제금액 기준)`
              : "무료배송 적용"}
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <div className="bg-yellow-10 relative h-2.5 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-yellow-30 absolute h-2.5 rounded-full transition-all duration-300"
            style={{ width: `${freeShippingProgress}%` }}
          />
        </div>
        <div className="text-yellow-30">
          <Truck className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}
