"use client"

import { useState, useEffect } from "react"
import { ChevronUp } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

import { Button } from "@/components/ui/button"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { formatPrice } from "@/lib/utils/price-utils"
import PriceErrorNotice from "../components/price-error-notice"
import { calculateCartDiscount } from "../utils/calculate-discount"

type MobileCheckoutBarProps = {
  cart: HttpTypes.StoreCart & {
    promotions: HttpTypes.StorePromotion[]
  }
}

function getCheckoutStep(cart: HttpTypes.StoreCart) {
  if (!cart?.shipping_address?.address_1 || !cart.email) {
    return "address"
  } else if (cart?.shipping_methods?.length === 0) {
    return "delivery"
  } else {
    return "payment"
  }
}

export default function MobileCheckoutBar({ cart }: MobileCheckoutBarProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showScrollFade, setShowScrollFade] = useState(false)
  const step = getCheckoutStep(cart)
  const isTotalValid = cart.total !== null && cart.total !== undefined
  const hasError = !isTotalValid

  const { originalTotal, membershipDiscount, itemCount } =
    calculateCartDiscount(cart.items)

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY
      const windowHeight = window.innerHeight
      const documentHeight = document.documentElement.scrollHeight

      // 스크롤 가능한 여유가 있고, 맨 아래가 아닐 때 페이드 표시
      const isScrollable = documentHeight > windowHeight + 100
      const isNotAtBottom = scrollTop + windowHeight < documentHeight - 50

      setShowScrollFade(isScrollable && isNotAtBottom)
    }

    handleScroll() // 초기 상태 설정
    window.addEventListener("scroll", handleScroll)
    window.addEventListener("resize", handleScroll)

    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleScroll)
    }
  }, [])

  return (
    <div className="fixed inset-x-0 bottom-0 z-99 border-t bg-white lg:hidden">
      {/* 스크롤 페이드 인디케이터 */}
      <div
        className={`pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-t from-white to-transparent transition-opacity duration-300 ${
          showScrollFade ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* 할인 상세 펼침 영역 */}
      <AnimatePresence>
        {isExpanded && membershipDiscount > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden bg-white shadow-inner"
          >
            <div className="px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">멤버십 할인</span>
                <span className="text-destructive">
                  -{formatPrice(membershipDiscount)}원
                </span>
              </div>
              {(cart.discount_total ?? 0) > 0 && (
                <div className="mt-1 flex justify-between">
                  <span className="text-gray-600">쿠폰/프로모션</span>
                  <span className="text-destructive">
                    -{formatPrice(cart.discount_total ?? 0)}원
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 메인 바 */}
      <div className="px-4 py-3">
        {hasError ? (
          <>
            <div className="mb-3">
              <PriceErrorNotice />
            </div>
            <Button className="h-12 w-full" disabled>
              구매하기
            </Button>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              {/* 왼쪽: 할인 금액 */}
              {membershipDiscount > 0 ? (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-sm font-medium transition-colors ${
                    isExpanded
                      ? "bg-destructive/10 text-destructive"
                      : "text-destructive active:bg-destructive/5"
                  }`}
                >
                  총 {formatPrice(membershipDiscount)}원 할인
                  <motion.span
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </motion.span>
                </button>
              ) : (
                <span />
              )}

              {/* 오른쪽: 가격 */}
              <div className="flex items-baseline gap-2">
                {membershipDiscount > 0 && (
                  <span className="text-sm text-gray-400 line-through">
                    {formatPrice(originalTotal)}원
                  </span>
                )}
                <span className="text-xl font-bold">
                  {formatPrice(cart.total)}원
                </span>
              </div>
            </div>

            {/* 구매 버튼 */}
            <LocalizedClientLink href={"/checkout?step=" + step}>
              <Button className="h-12 w-full">
                총 {itemCount}개 상품 구매하기
              </Button>
            </LocalizedClientLink>
          </>
        )}
      </div>
    </div>
  )
}
