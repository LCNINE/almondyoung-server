"use client"

import { PaymentTotalSection } from "@/domains/checkout/components/sections/payment-total"
import { createMembershipCheckoutIntent } from "@/lib/api/membership"
import { setPendingPaymentMode } from "@/lib/utils/checkout-intent-map"
import type { CartTotals } from "@/lib/types/ui/cart"
import type { UserDetail } from "@lib/types/ui/user"
import { MobileCTA, PCFixedCTA } from "domains/checkout/components/cta"
import { MobileHeader, PCHeader } from "domains/checkout/components/header"
import { MobileOrderSummary } from "domains/checkout/components/order-summary"
import { PaymentDetailSidebar } from "domains/checkout/components/payment-detail-sidebar"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useTranslations } from "next-intl"
import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"

interface MembershipCheckoutTemplateProps {
  user: UserDetail
  planName: string
  planId: string
  price: number
}

export default function MembershipCheckoutTemplate({
  user,
  planName,
  planId,
  price,
}: MembershipCheckoutTemplateProps) {
  const t = useTranslations("checkout.membership")
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  const [loading, setLoading] = useState(false)
  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(true)
  const [agreed, setAgreed] = useState(false)

  const totals: CartTotals = useMemo(
    () => ({
      currency_code: "krw",
      item_subtotal: price,
      original_item_subtotal: price,
      shipping: 0,
      discount_subtotal: 0,
      membershipDiscount: 0,
      pointsUsed: 0,
      totalDiscount: 0,
      finalTotal: price,
    }),
    [price]
  )

  const attemptPayment = async () => {
    const returnUrl = `${window.location.origin}/${countryCode}/checkout/callback`
    const { intentId } = await createMembershipCheckoutIntent(planId, returnUrl, "one_time")
    setPendingPaymentMode("membership", { planId, billingMode: "one_time" })
    const walletWebUrl = process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
    window.location.href = `${walletWebUrl}/pay/${intentId}?region=${countryCode}`
  }

  const handlePayment = async () => {
    if (!agreed) {
      toast.error(t("toasts.agreeRequired"))
      return
    }
    if (!user?.id) {
      toast.error(t("toasts.loginRequired"))
      return
    }

    try {
      setLoading(true)
      await attemptPayment()
    } catch (error: unknown) {
      setLoading(false)
      const err = error as Error & { digest?: string }

      if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
        // 이벤트 핸들러에서 throw는 error.tsx를 트리거하지 않으므로 인라인 토큰 복구
        let tokenRestored = false
        try {
          const res = await fetch("/api/auth/restore-token", {
            method: "POST",
            credentials: "include",
          })
          tokenRestored = res.ok
        } catch {
          // restore-token 네트워크 에러
        }

        if (!tokenRestored) {
          window.location.href = `/${countryCode}/login?redirect_to=${encodeURIComponent(window.location.pathname + window.location.search)}`
          return
        }

        // 토큰 복구 성공 → 결제 재시도 (실패 시 toast)
        setLoading(true)
        try {
          await attemptPayment()
        } catch (retryError: unknown) {
          setLoading(false)
          const retryErr = retryError as Error
          console.error("멤버십 결제 재시도 실패:", retryError)
          toast.error(
            retryErr instanceof Error
              ? retryErr.message
              : t("toasts.paymentRequestFailed")
          )
        }
        return
      }

      console.error("멤버십 결제 요청 실패:", error)
      toast.error(
        err instanceof Error ? err.message : t("toasts.paymentRequestFailed")
      )
    }
  }

  return (
    <main className="bg-muted min-h-screen w-full">
      <PCHeader />

      <div className="container mx-auto max-w-[1360px] px-4 lg:px-[40px] lg:py-8">
        <MobileHeader onClose={() => router.back()} />

        <div className="lg:flex lg:w-full lg:justify-between lg:gap-9">
          {/* 왼쪽 섹션 */}
          <div className="lg:max-w-[820px] lg:min-w-[420px] lg:flex-1">
            {/* 멤버십 플랜 요약 */}
            <section className="mb-4 rounded-[10px] border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-bold text-gray-900">
                {t("planSectionTitle")}
              </h2>
              <div className="mt-3 flex items-baseline justify-between">
                <div>
                  <p className="text-sm text-gray-500">
                    {t("selectedPlanLabel")}
                  </p>
                  <p className="text-lg font-semibold text-gray-900">{planName}</p>
                </div>
                <p className="text-xl font-bold text-[#F29219]">
                  {t("priceWon", { amount: price.toLocaleString() })}
                </p>
              </div>
            </section>

            {/* 결제 정책 */}
            <section className="mb-4 rounded-[10px] border border-gray-200 bg-white p-6">
              <h2 className="mb-3 text-base font-bold text-gray-900">
                {t("noticeTitle")}
              </h2>

              <div className="space-y-2 text-sm text-gray-600">
                <p className="font-medium text-gray-800">{t("oneTimeHeader")}</p>
                <ul className="ml-4 list-disc space-y-1 text-gray-600">
                  <li>{t("oneTimeNoAutoPay")}</li>
                  <li>
                    {t("immediateNoRefundPrefix")}
                    <span className="font-medium text-gray-800">
                      {t("immediateNoRefundEmphasis")}
                    </span>
                    {t("immediateNoRefundSuffix")}
                  </li>
                  <li>{t("paidPeriodAccess")}</li>
                </ul>
              </div>

              {/* 환불 정책 공통 */}
              <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                <p className="mb-1 font-semibold text-gray-600">
                  {t("refundPolicyTitle")}
                </p>
                <ul className="space-y-0.5">
                  <li>{t("refund1")}</li>
                  <li>{t("refund2")}</li>
                  <li>{t("refund3")}</li>
                </ul>
              </div>

              {/* 동의 체크박스 */}
              <div className="mt-4 flex items-start gap-2">
                <Checkbox
                  id="policy-agree"
                  checked={agreed}
                  onCheckedChange={(checked) => setAgreed(checked === true)}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="policy-agree"
                  className="cursor-pointer text-sm leading-snug text-gray-700"
                >
                  {t("agree")}
                </Label>
              </div>
            </section>

            <PaymentTotalSection totals={totals} />
          </div>

          {/* 오른쪽 섹션 */}
          <div className="lg:shrink-0">
            <MobileOrderSummary totals={totals} isMembership={false} />
            <PaymentDetailSidebar
              isOpen={isPaymentDetailsOpen}
              setIsOpen={setIsPaymentDetailsOpen}
              totals={totals}
            />
          </div>
        </div>
      </div>

      <PCFixedCTA
        onPayment={handlePayment}
        loading={loading}
        totals={totals}
        disabled={!agreed}
      />
      <MobileCTA onPayment={handlePayment} loading={loading} disabled={!agreed} />
    </main>
  )
}
