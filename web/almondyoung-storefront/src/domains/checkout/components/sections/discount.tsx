"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PriceRow } from "@/domains/checkout/components/shared/price-row"
import { CheckoutMembershipTagIcon } from "@/icons/membership-tag-icon"
import {
  addPromotionToCart,
  removePromotionFromCart,
  previewCouponCode,
  claimCoupon,
  type CouponPreviewResult,
} from "@/lib/api/medusa/store"
import type { ShippingInfo } from "@/lib/types/ui/cart"
import type { Promotion } from "@/lib/types/ui/promotion"
import { formatPrice } from "@/lib/utils/price-utils"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { useTranslations } from "next-intl"
import { useCallback, useState, useTransition } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"

const PREVIEW_REASON_KEYS = [
  "COUPON_NOT_FOUND",
  "COUPON_INACTIVE",
  "COUPON_EXPIRED",
  "COUPON_NOT_STARTED",
  "COUPON_GROUP_RESTRICTED",
  "COUPON_NOT_ASSIGNED",
  "LOGIN_REQUIRED",
] as const
type PreviewReasonKey = (typeof PREVIEW_REASON_KEYS)[number]

function isKnownReason(r: string | undefined): r is PreviewReasonKey {
  return PREVIEW_REASON_KEYS.includes(r as PreviewReasonKey)
}

async function tryRestoreTokenAndRedirect(countryCode: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/restore-token", {
      method: "POST",
      credentials: "include",
    })
    if (res.ok) return true
  } catch {}
  window.location.href = `/${countryCode}/login?redirect_to=${encodeURIComponent(
    window.location.pathname + window.location.search
  )}`
  return false
}

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
  const params = useParams()
  const countryCode = params.countryCode as string
  const [isPending, startTransition] = useTransition()
  const [selectedCoupon, setSelectedCoupon] = useState<string>(
    appliedPromotionCode ?? ""
  )

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
          if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
            await tryRestoreTokenAndRedirect(countryCode)
            return
          }
          if (err.digest === "COUPON_NOT_ASSIGNED") {
            toast.error(t("toasts.couponNotAssigned"))
          } else if (err.digest === "COUPON_LIMIT_EXCEEDED") {
            toast.error(t("toasts.couponLimitExceeded"))
          } else {
            toast.error(t("toasts.couponApplyFailed"))
          }
        }
      })
    },
    [cartId, countryCode, selectedCoupon, onCouponApplied, t]
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

          {/* 적용된 쿠폰 표시 */}
          {selectedCoupon ? (
            <div className="flex items-center justify-between rounded-[5px] border border-[#F29219] px-3 py-2.5">
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

          {/* 코드 직접 입력 */}
          <DirectCouponInput
            cartId={cartId}
            selectedCoupon={selectedCoupon}
            onApplied={(code) => {
              setSelectedCoupon(code)
              onCouponApplied?.()
            }}
          />
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

/*──────────────────────────────────────────────────────────────
 * DirectCouponInput — 쿠폰 코드 직접 입력 + 미리보기 + 적용
 *──────────────────────────────────────────────────────────────*/
interface DirectCouponInputProps {
  cartId: string
  selectedCoupon: string
  onApplied: (code: string) => void
}

const DirectCouponInput = ({
  cartId,
  selectedCoupon,
  onApplied,
}: DirectCouponInputProps) => {
  const t = useTranslations("checkout.discount")
  const td = useTranslations("checkout.discount.directInput")
  const params = useParams()
  const countryCode = params.countryCode as string
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [preview, setPreview] = useState<CouponPreviewResult | null>(null)
  const [isPreviewing, startPreviewing] = useTransition()
  const [isApplying, startApplying] = useTransition()

  const upperCode = code.trim().toUpperCase()

  const handleUnauthorized = async () => {
    const restored = await tryRestoreTokenAndRedirect(countryCode)
    if (!restored) return
    // 토큰 복구 성공 시 재시도 없이 사용자에게 다시 버튼을 누르게 함
    toast.error(t("toasts.couponApplyFailed"))
  }

  const handleCheck = () => {
    if (!upperCode) return
    setPreview(null)
    startPreviewing(async () => {
      try {
        const result = await previewCouponCode(upperCode)
        setPreview(result)
      } catch {
        setPreview({ valid: false, reason: "COUPON_NOT_FOUND" })
      }
    })
  }

  const handleApply = () => {
    if (upperCode === selectedCoupon) {
      toast.error(td("alreadyApplied"))
      return
    }
    startApplying(async () => {
      try {
        if (selectedCoupon) {
          await removePromotionFromCart(cartId, [selectedCoupon])
        }
        await addPromotionToCart(cartId, [upperCode])
        onApplied(upperCode)
        setCode("")
        setPreview(null)
        setOpen(false)
      } catch (error) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          // 기존 쿠폰이 제거됐을 수 있으므로 cart refresh
          onApplied("")
          await handleUnauthorized()
          return
        }
        // 새 쿠폰 적용 실패 → 기존 쿠폰 rollback 시도
        if (selectedCoupon) {
          try {
            await addPromotionToCart(cartId, [selectedCoupon])
          } catch {
            // rollback 실패 시 cart refresh로 상태 동기화
            onApplied("")
          }
        }
        if (err.digest === "COUPON_NOT_ASSIGNED") {
          toast.error(t("toasts.couponNotAssigned"))
        } else if (err.digest === "COUPON_LIMIT_EXCEEDED") {
          toast.error(t("toasts.couponLimitExceeded"))
        } else {
          toast.error(t("toasts.couponApplyFailed"))
        }
      }
    })
  }

  const handleClaim = () => {
    const promotionId =
      preview?.promotion?.promotion_id_to_claim ?? preview?.promotion?.id
    if (!promotionId) return
    startApplying(async () => {
      let claimSucceeded = false
      try {
        await claimCoupon(promotionId)
        claimSucceeded = true
        if (selectedCoupon) {
          await removePromotionFromCart(cartId, [selectedCoupon])
        }
        await addPromotionToCart(cartId, [upperCode])
        onApplied(upperCode)
        setCode("")
        setPreview(null)
        setOpen(false)
      } catch (error) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          await handleUnauthorized()
          return
        }
        // 새 쿠폰 적용 실패 → 기존 쿠폰 rollback 시도
        if (selectedCoupon) {
          try {
            await addPromotionToCart(cartId, [selectedCoupon])
          } catch {
            onApplied("")
          }
        }
        toast.error(
          claimSucceeded
            ? t("toasts.claimSuccessApplyFailed")
            : t("toasts.claimAndApplyFailed")
        )
      }
    })
  }

  // known reason map — 동적 key 대신 안전한 정적 매핑
  const previewError: string | null = (() => {
    if (!preview || preview.valid || preview.claimable) return null
    const reason = preview.reason
    if (isKnownReason(reason)) return td(`errors.${reason}`)
    return td("errors.UNKNOWN")
  })()

  const discountLabel = preview?.promotion?.discount
    ? preview.promotion.discount.type === "percentage"
      ? `${preview.promotion.discount.value}%${td("discountSuffix")}`
      : `${formatPrice(preview.promotion.discount.value)}원${td("discountSuffix")}`
    : null

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setCode("")
          setPreview(null)
        }}
        className="self-start text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
      >
        {td("tabLabel")}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          {/* 입력 행 */}
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase())
                setPreview(null)
              }}
              onKeyDown={(e) => e.key === "Enter" && handleCheck()}
              placeholder={td("placeholder")}
              className="h-10 flex-1 text-sm uppercase placeholder:normal-case placeholder:text-gray-400"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCheck}
              disabled={!upperCode || isPreviewing}
              className="h-10 shrink-0 px-4 text-xs"
            >
              {isPreviewing ? td("checking") : td("checkButton")}
            </Button>
          </div>

          {/* 미리보기 카드 */}
          {preview && (
            <div
              className={`rounded-[5px] border px-3 py-2.5 text-xs ${
                preview.valid || preview.claimable
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              {preview.valid || preview.claimable ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-green-800">
                      {discountLabel ?? td("confirmed")}
                    </span>
                    {!preview.claimable && (
                      <span className="text-xs text-green-600">{td("confirmHint")}</span>
                    )}
                    {preview.claimable && (
                      <span className="text-green-700">{td("claimableHint")}</span>
                    )}
                    {preview.promotion?.expires_at && (
                      <span className="text-green-600">
                        {td("expiresAt", {
                          date: formatDate(
                            preview.promotion.expires_at,
                            DATE_FORMATS.KO_DOT
                          ),
                        })}
                      </span>
                    )}
                  </div>
                  {preview.claimable ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleClaim}
                      disabled={isApplying}
                      className="h-8 shrink-0 bg-green-700 px-3 text-xs hover:bg-green-800"
                    >
                      {isApplying ? td("claiming") : td("claimButton")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleApply}
                      disabled={isApplying}
                      className="h-8 shrink-0 bg-green-700 px-3 text-xs hover:bg-green-800"
                    >
                      {isApplying ? td("applying") : td("applyButton")}
                    </Button>
                  )}
                </div>
              ) : (
                <span className="text-red-700">{previewError}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
