"use client"

import React, { useState } from "react"
import { ChevronUp } from "lucide-react"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { useRouter, useParams } from "next/navigation"

interface CartFooterProps {
  totalOriginalPrice: number
  totalDiscount: number
  finalPrice: number
  selectedCount: number
  shippingFee: number
}

export function CartFooter({
  totalOriginalPrice,
  totalDiscount,
  finalPrice,
  selectedCount,
  shippingFee,
}: CartFooterProps) {
  const router = useRouter()
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const [isExpanded, setIsExpanded] = useState(false)

  const handleCheckout = () => {
    if (selectedCount === 0) {
      alert("구매할 상품을 선택해주세요.")
      return
    }
    // 결제 페이지로 이동
    router.push(`/${countryCode}/checkout`)
  }

  return (
    <footer className="checkout-footer md:hidden">
      <div className="footer-container border-t bg-white shadow-[0_-1px_2px_0_rgba(0,0,0,0.1)]">
        <div className="footer-inner mx-auto max-w-4xl">
          {/* 가격 정보 영역 */}
          <div
            className="cursor-pointer border-b border-border p-4"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center justify-between">
              {/* 할인 정보 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-red-30">
                  {totalDiscount.toLocaleString()}원 할인
                </span>
                <ChevronUp
                  className={`h-3 w-3 transition-transform ${isExpanded ? "" : "rotate-180"}`}
                />
              </div>

              {/* 가격 정보 */}
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground line-through">
                  {totalOriginalPrice.toLocaleString()}원
                </span>
                <span className="text-2xl font-bold">
                  {(finalPrice + shippingFee).toLocaleString()}원
                </span>
              </div>
            </div>

            {/* 펼친 상태 - 상세 정보 */}
            {isExpanded && (
              <div className="mt-4 space-y-2 border-t pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">총 상품 가격</span>
                  <span className="font-medium">
                    {totalOriginalPrice.toLocaleString()}원
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">할인 금액</span>
                  <span className="font-medium">
                    {totalDiscount.toLocaleString()}원
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">배송비</span>
                  <span className="font-medium">
                    {shippingFee === 0
                      ? "무료"
                      : `+ ${shippingFee.toLocaleString()}원`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 구매하기 버튼 */}
          <div className="p-4">
            <CustomButton
              className="w-full"
              variant="fill"
              color="primary"
              size="lg"
              onClick={handleCheckout}
            >
              총 {selectedCount}개 상품 구매하기
            </CustomButton>
          </div>
        </div>
      </div>
    </footer>
  )
}
