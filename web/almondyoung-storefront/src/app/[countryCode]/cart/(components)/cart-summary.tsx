"use client"

import React, { useState } from "react"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { toast } from "sonner"

interface CartSummaryProps {
  totalOriginalPrice: number
  totalDiscount: number
  membershipDiscount: number
  shippingFee: number
  finalPrice: number
  onCheckout: () => Promise<boolean>
}

export function CartSummary({
  totalOriginalPrice,
  totalDiscount,
  membershipDiscount,
  shippingFee,
  finalPrice,
  onCheckout,
}: CartSummaryProps) {
  const [isProcessing, setIsProcessing] = useState(false)

  const handleCheckout = async () => {
    setIsProcessing(true)

    try {
      await onCheckout()
    } catch (error) {
      // console.error("체크아웃 처리 실패:", error)
      toast.error("체크아웃 처리 중 오류가 발생했습니다.")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="hidden md:block md:w-[360px]">
      <div className="sticky top-4">
        <div className="rounded-xl border bg-white p-6">
          <h2 className="mb-4 text-3xl font-semibold">주문 예상금액</h2>

          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-base font-normal">총 상품 가격</span>
              <span className="text-2xl font-bold">
                {totalOriginalPrice.toLocaleString()}원
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-base font-normal">할인 금액</span>
              <span className="text-2xl font-bold">
                {totalDiscount.toLocaleString()}원
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-base font-normal">멤버십 할인</span>
              <span className="text-2xl font-bold">
                {membershipDiscount.toLocaleString()}원
              </span>
            </div>
            <div className="w-full">
              <div className="flex items-center justify-between">
                <span className="text-base font-normal">배송비</span>
                <span className="text-2xl font-bold">
                  {shippingFee === 0
                    ? "무료"
                    : `+ ${shippingFee.toLocaleString()}원`}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold">총 결제 예정 금액</span>
              <span className="text-right text-2xl font-bold">
                {(finalPrice + shippingFee).toLocaleString()}원
              </span>
            </div>
          </div>

          <div className="my-6 h-px bg-border" />

          <CustomButton
            className="w-full"
            variant="fill"
            color="primary"
            size="lg"
            onClick={handleCheckout}
            disabled={isProcessing}
          >
            {isProcessing ? "처리 중..." : "구매하기"}
          </CustomButton>
        </div>
      </div>
    </div>
  )
}
