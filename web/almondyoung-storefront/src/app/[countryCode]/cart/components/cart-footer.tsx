"use client"

import React from "react"
import { ChevronUp } from "lucide-react"
import { CustomButton } from "@components/common/custom-buttons/custom-button"

interface CartFooterProps {
  totalOriginalPrice: number
  totalDiscount: number
  finalPrice: number
  selectedCount: number
}

export function CartFooter({
  totalOriginalPrice,
  totalDiscount,
  finalPrice,
  selectedCount,
}: CartFooterProps) {
  return (
    <footer className="checkout-footer md:hidden">
      <div className="footer-container mt-2 border-t bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <div className="footer-inner mx-auto max-w-4xl p-4">
          <div className="checkout-summary">
            <div className="summary-content flex items-center justify-between">
              {/* 할인 정보 */}
              <div className="discount-info flex items-center gap-1">
                <span className="discount-amount text-lg font-bold text-orange-500">
                  {totalDiscount.toLocaleString()}원 할인
                </span>
                <span className="discount-toggle">
                  <ChevronUp className="h-6 w-6" />
                </span>
              </div>

              {/* 가격 정보 */}
              <div className="price-summary flex items-baseline gap-2">
                <span className="price-original text-base text-gray-400 line-through">
                  {totalOriginalPrice.toLocaleString()}원
                </span>
                <span className="price-total text-2xl font-bold text-gray-800">
                  {finalPrice.toLocaleString()}원
                </span>
              </div>
            </div>
          </div>

          <div className="checkout-actions mt-3">
            <CustomButton
              className="checkout-button w-full"
              variant="primary"
              size="lg"
            >
              총 {selectedCount}개 상품 구매하기
            </CustomButton>
          </div>
        </div>
      </div>
    </footer>
  )
}
