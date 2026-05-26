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
import { useTranslations } from "next-intl"
import { useCallback, useState, useTransition } from "react"
import { toast } from "sonner"

interface DiscountSectionProps {
  cartId: string
  isMembership: boolean
  membershipDiscount: number
  itemSubtotal: number
  cartDiscountTotal?: number
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
  cartDiscountTotal,
  shipping,
  promotions,
  appliedPromotionCode,
  onCouponApplied,
}: DiscountSectionProps) => {
  const t = useTranslations("checkout.discount")
  const [isPending, startTransition] = useTransition()
  const [selectedCoupon, setSelectedCoupon] = useState<string>(
    appliedPromotionCode ?? ""
  )

  console.log("promotions:", promotions)

  const handleCouponChange = useCallback(
    (code: string) => {
      startTransition(async () => {
        try {
          if (selectedCoupon) {
            await removePromotionFromCart(cartId, [selectedCoupon])
          }
          if (code) {
            await addPromotionToCart(cartId, [code])
          }
          setSelectedCoupon(code)
          onCouponApplied?.()
        } catch (error) {
          const err = error as Error & { digest?: string }
          if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED")
            throw error
          if (err.digest === "COUPON_LIMIT_EXCEEDED") {
            toast.error(t("toasts.couponLimitExceeded"))
          } else {
            toast.error(t("toasts.couponApplyFailed"))
          }
        }
      })
    },
    [cartId, selectedCoupon, onCouponApplied, t]
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
    ? (cartDiscountTotal ??
      (appliedPromotion.application_method?.type === "percentage"
        ? Math.floor(
            itemSubtotal * (appliedPromotion.application_method.value / 100)
          )
        : (appliedPromotion.application_method?.value ?? 0)))
    : 0

  // 총 할인 금액 = 멤버십 할인 + 쿠폰 할인
  const totalDiscount = membershipDiscount + couponDiscount

  const formatPromoLabel = (promo: Promotion) =>
    promo.application_method?.type === "percentage"
      ? t("percentDiscount", { value: promo.application_method.value })
      : t("amountDiscount", {
          amount: formatPrice(promo.application_method?.value ?? 0),
        })

  return (
    <section aria-labelledby="discount-heading" className="mb-8">
      <h2
        id="discount-heading"
        className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
      >
        {t("title")}
      </h2>

      <div className="flex w-full flex-col gap-5 rounded-md border border-gray-200 bg-white p-4 lg:gap-6 lg:rounded-[10px] lg:p-6">
        <DiscountRow
          label={t("totalLabel")}
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
              {t("couponLabel")}
            </span>
            <span className="text-xs text-gray-500 lg:text-sm">
              {promotions.length > 0
                ? t("availableCount", { count: promotions.length })
                : t("available")}
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
                    return formatPromoLabel(promo)
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
                aria-label={t("removeAria")}
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
                      ? t("applying")
                      : promotions.length === 0
                        ? t("noCoupons")
                        : t("selectPlaceholder", { count: promotions.length })
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {promotions.map((promo) => (
                  <SelectItem key={promo.id} value={promo.code}>
                    {formatPromoLabel(promo)}
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
  appliedPromotion,
}: DiscountRowProps) => {
  const t = useTranslations("checkout.discount")
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
          {hasDiscount
            ? t("amountMinusWon", { amount: formatPrice(totalDiscount) })
            : t("zero")}
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
            {t("membershipDiscount")}
          </PriceRow.Label>
          <PriceRow.Value size="xs" tone="membership" weight="medium">
            {t("amountMinusWon", { amount: formatPrice(membershipDiscount) })}
          </PriceRow.Value>
        </PriceRow>
      )}

      {hasCouponDiscount && appliedPromotion && (
        <PriceRow>
          <PriceRow.Label size="xs" tone="accent" weight="medium">
            {t("couponDiscount")}
          </PriceRow.Label>
          <PriceRow.Value size="xs" tone="discount" weight="medium">
            {t("amountMinusWon", { amount: formatPrice(couponDiscount) })}
          </PriceRow.Value>
        </PriceRow>
      )}
    </div>
  )
}
