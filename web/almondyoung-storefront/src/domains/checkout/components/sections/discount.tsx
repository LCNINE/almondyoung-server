"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PriceRow } from "@/domains/checkout/components/shared/price-row"
import { CheckoutMembershipTagIcon } from "@/icons/membership-tag-icon"
import {
  addPromotionToCart,
  removePromotionFromCart,
} from "@/lib/api/medusa/store"
import type { ShippingInfo } from "@/lib/types/ui/cart"
import type { Promotion } from "@/lib/types/ui/promotion"
import { formatPrice } from "@/lib/utils/price-utils"
import { useCallback, useState, useTransition } from "react"
import { toast } from "sonner"

interface DiscountSectionProps {
  cartId: string
  isMembership: boolean
  membershipDiscount: number
  itemSubtotal: number
  shipping: ShippingInfo
  promotions: Promotion[]
  appliedPromotionCode?: string | null
  onCouponApplied?: () => void
}

export const DiscountSection = ({
  cartId,
  isMembership = false,
  membershipDiscount,
  itemSubtotal,
  shipping,
  promotions,
  appliedPromotionCode,
  onCouponApplied,
}: DiscountSectionProps) => {
  const [isPending, startTransition] = useTransition()
  const [selectedCoupon, setSelectedCoupon] = useState<string>(
    appliedPromotionCode ?? ""
  )

  const handleCouponChange = useCallback(
    (code: string) => {
      startTransition(async () => {
        try {
          // 기존 쿠폰이 있으면 제거
          if (selectedCoupon) {
            await removePromotionFromCart(cartId, [selectedCoupon])
          }
          // 새 쿠폰 적용
          if (code) {
            await addPromotionToCart(cartId, [code])
          }
          setSelectedCoupon(code)
          onCouponApplied?.()
        } catch (error) {
          console.error("쿠폰 적용 실패:", error)
          toast.error("쿠폰 적용에 실패했습니다. 잠시 후 다시 시도해주세요.")
        }
      })
    },
    [cartId, selectedCoupon, onCouponApplied]
  )

  const handleCouponRemove = useCallback(() => {
    if (!selectedCoupon) return

    startTransition(async () => {
      try {
        await removePromotionFromCart(cartId, [selectedCoupon])
        setSelectedCoupon("")
        onCouponApplied?.()
      } catch (error) {
        console.error("쿠폰 제거 실패:", error)
      }
    })
  }, [cartId, selectedCoupon, onCouponApplied])

  // 쿠폰 할인 금액 계산
  const appliedPromotion = selectedCoupon
    ? promotions.find((p) => p.code === selectedCoupon)
    : null

  const couponDiscount = appliedPromotion
    ? appliedPromotion.application_method?.type === "percentage"
      ? Math.floor(
          itemSubtotal * (appliedPromotion.application_method.value / 100)
        )
      : (appliedPromotion.application_method?.value ?? 0)
    : 0

  // 총 할인 금액 = 멤버십 할인 + 쿠폰 할인
  const totalDiscount = membershipDiscount + couponDiscount

  return (
    <section aria-labelledby="discount-heading" className="mb-8">
      <h2
        id="discount-heading"
        className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
      >
        할인 / 부가결제
      </h2>

      <div className="flex w-full flex-col gap-5 rounded-md border border-gray-200 bg-white p-4 lg:gap-6 lg:rounded-[10px] lg:p-6">
        <DiscountRow
          label="총 할인 금액"
          isMembership={isMembership}
          totalDiscount={totalDiscount}
          membershipDiscount={membershipDiscount}
          couponDiscount={couponDiscount}
          shipping={shipping}
          appliedPromotion={appliedPromotion}
        />

        <hr className="border-t border-gray-100" />

        {/* 쿠폰 */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-900 lg:text-sm">
              쿠폰
            </span>
            <span className="text-xs text-gray-500 lg:text-sm">
              사용가능 {promotions.length > 0 && `(${promotions.length})`}
            </span>
          </div>

          {/* 적용된 쿠폰이 있을 때 */}
          {selectedCoupon ? (
            <div className="bg-gray-0 flex items-center justify-between rounded-[5px] border border-[#F29219] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#F29219] lg:text-sm">
                  {(() => {
                    const promo = promotions.find(
                      (p) => p.code === selectedCoupon
                    )
                    if (!promo) return selectedCoupon
                    return promo.application_method.type === "percentage"
                      ? `${promo.application_method.value}% 할인`
                      : `${formatPrice(promo.application_method.value)}원 할인`
                  })()}
                </span>
                <span className="text-[10px] text-gray-500 lg:text-xs">
                  ({selectedCoupon})
                </span>
              </div>
              <button
                type="button"
                onClick={handleCouponRemove}
                disabled={isPending}
                className="flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="쿠폰 제거"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
          ) : (
            /* 쿠폰 선택 드롭다운 */
            <Select
              value={selectedCoupon}
              onValueChange={handleCouponChange}
              disabled={promotions.length === 0 || isPending}
            >
              <SelectTrigger className="h-10 w-full rounded-[5px] border-gray-200 bg-white text-xs text-gray-500 focus:border-gray-400 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 lg:text-sm">
                <SelectValue
                  placeholder={
                    isPending
                      ? "쿠폰 적용 중..."
                      : promotions.length === 0
                        ? "사용 가능한 쿠폰이 없습니다"
                        : `쿠폰을 선택해주세요 (${promotions.length})`
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {promotions.map((promo) => (
                  <SelectItem key={promo.id} value={promo.code}>
                    {promo.application_method.type === "percentage"
                      ? `${promo.application_method.value}% 할인`
                      : `${formatPrice(promo.application_method.value)}원 할인`}
                    {promo.code && ` (${promo.code})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </section>
  )
}

interface DiscountRowProps {
  label: string
  isMembership: boolean
  totalDiscount: number
  membershipDiscount: number
  couponDiscount: number
  shipping: ShippingInfo
  appliedPromotion: Promotion | null | undefined
}

const DiscountRow = ({
  label,
  isMembership,
  totalDiscount,
  membershipDiscount,
  couponDiscount,
  shipping,
  appliedPromotion,
}: DiscountRowProps) => {
  const hasMembershipDiscount = isMembership && membershipDiscount > 0
  const hasDiscount = totalDiscount > 0
  const hasCouponDiscount = couponDiscount > 0

  return (
    <div className="flex flex-col gap-1.5">
      <PriceRow>
        <PriceRow.Label size="sm" weight="medium">
          {label}
        </PriceRow.Label>
        <PriceRow.Value size="base" weight="semibold">
          {hasDiscount ? `-${formatPrice(totalDiscount)}원` : "0원"}
        </PriceRow.Value>
      </PriceRow>

      {hasMembershipDiscount && (
        <PriceRow>
          <PriceRow.Label
            size="xs"
            tone="membership"
            weight="medium"
            className="flex items-center gap-1"
          >
            <CheckoutMembershipTagIcon />
            멤버십 할인
          </PriceRow.Label>
          <PriceRow.Value size="xs" tone="membership" weight="medium">
            -{formatPrice(membershipDiscount)}원
          </PriceRow.Value>
        </PriceRow>
      )}

      {hasCouponDiscount && appliedPromotion && (
        <PriceRow>
          <PriceRow.Label
            size="xs"
            tone="accent"
            weight="medium"
          >
            쿠폰 할인
          </PriceRow.Label>
          <PriceRow.Value size="xs" tone="discount" weight="medium">
            -{formatPrice(couponDiscount)}원
          </PriceRow.Value>
        </PriceRow>
      )}
    </div>
  )
}
