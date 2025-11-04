"use client"

import React from "react"
import { CustomButton } from "@components/common/custom-buttons/custom-button"

interface CartSummaryProps {
  totalOriginalPrice: number
  totalDiscount: number
  shippingFee: number
  finalPrice: number
  selectedCount: number
}

export function CartSummary({
  totalOriginalPrice,
  totalDiscount,
  shippingFee,
  finalPrice,
  selectedCount,
}: CartSummaryProps) {
  return (
    <div className="hidden md:block md:w-[360px]">
      <div className="sticky top-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-bold">결제 정보</h2>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">상품금액</span>
              <span className="font-medium">
                {totalOriginalPrice.toLocaleString()}원
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">할인금액</span>
              <span className="font-medium text-red-500">
                -{totalDiscount.toLocaleString()}원
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">배송비</span>
              <span className="font-medium">
                {shippingFee === 0
                  ? "무료"
                  : `${shippingFee.toLocaleString()}원`}
              </span>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">결제예정금액</span>
                <div className="text-right">
                  <div className="text-2xl font-bold text-orange-500">
                    {(finalPrice + shippingFee).toLocaleString()}원
                  </div>
                </div>
              </div>
            </div>
          </div>

          <CustomButton className="mt-6 w-full" variant="primary" size="lg">
            총 {selectedCount}개 상품 구매하기
          </CustomButton>
        </div>
      </div>
    </div>
  )
}
