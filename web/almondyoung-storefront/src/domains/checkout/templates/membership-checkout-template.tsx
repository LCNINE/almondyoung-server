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
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"

type BillingMode = "one_time" | "recurring"

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
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  const [loading, setLoading] = useState(false)
  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(true)
  const [billingMode, setBillingMode] = useState<BillingMode>("recurring")
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
    const { intentId } = await createMembershipCheckoutIntent(planId, returnUrl, billingMode)
    setPendingPaymentMode("membership", { planId, billingMode })
    const walletWebUrl = process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
    window.location.href = `${walletWebUrl}/pay/${intentId}`
  }

  const handlePayment = async () => {
    if (!agreed) {
      toast.error("결제 및 환불 정책에 동의해주세요.")
      return
    }
    if (!user?.id) {
      toast.error("로그인이 필요합니다.")
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
          toast.error(retryErr instanceof Error ? retryErr.message : "결제 요청에 실패했습니다.")
        }
        return
      }

      console.error("멤버십 결제 요청 실패:", error)
      toast.error(err instanceof Error ? err.message : "결제 요청에 실패했습니다.")
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
              <h2 className="text-lg font-bold text-gray-900">멤버십 플랜</h2>
              <div className="mt-3 flex items-baseline justify-between">
                <div>
                  <p className="text-sm text-gray-500">선택한 플랜</p>
                  <p className="text-lg font-semibold text-gray-900">{planName}</p>
                </div>
                <p className="text-xl font-bold text-[#F29219]">
                  {price.toLocaleString()}원
                </p>
              </div>
            </section>

            {/* 결제 방식 선택 */}
            <section className="mb-4 rounded-[10px] border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-base font-bold text-gray-900">결제 방식</h2>
              <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {billingMode === "recurring" ? "정기결제 (자동갱신)" : "1회 결제"}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {billingMode === "recurring"
                      ? "매월 자동으로 결제됩니다"
                      : "이번 달만 결제, 자동갱신 없음"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">1회</span>
                  <Switch
                    checked={billingMode === "recurring"}
                    onCheckedChange={(checked) => {
                      setBillingMode(checked ? "recurring" : "one_time")
                      // 모드 변경 시 정책 텍스트가 바뀌므로 재동의 필요
                      setAgreed(false)
                    }}
                  />
                  <span className="text-xs text-gray-400">정기</span>
                </div>
              </div>
            </section>

            {/* 결제 정책 */}
            <section className="mb-4 rounded-[10px] border border-gray-200 bg-white p-6">
              <h2 className="mb-3 text-base font-bold text-gray-900">결제 안내</h2>

              {billingMode === "one_time" ? (
                <div className="space-y-2 text-sm text-gray-600">
                  <p className="font-medium text-gray-800">📌 1회 결제 (자동결제 없음)</p>
                  <ul className="ml-4 list-disc space-y-1 text-gray-600">
                    <li>1회 결제로, 자동결제는 진행되지 않습니다.</li>
                    <li>결제 즉시 이용이 시작되며, <span className="font-medium text-gray-800">이용 시작 후 환불은 불가</span>합니다.</li>
                    <li>결제한 기간 동안 서비스 이용이 가능합니다.</li>
                  </ul>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-gray-600">
                  <p className="font-medium text-gray-800">🔄 정기결제 (매월 자동갱신)</p>
                  <ul className="ml-4 list-disc space-y-1 text-gray-600">
                    <li>매월 같은 날 자동으로 결제됩니다.</li>
                    <li>언제든지 <span className="font-medium text-gray-800">다음 결제일 전</span>에 해지할 수 있습니다.</li>
                    <li>해지 시 남은 기간은 그대로 이용 가능합니다.</li>
                    <li><span className="font-medium text-gray-800">이용 시작 후 환불은 불가</span>합니다.</li>
                  </ul>
                </div>
              )}

              {/* 환불 정책 공통 */}
              <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                <p className="mb-1 font-semibold text-gray-600">[환불 정책]</p>
                <ul className="space-y-0.5">
                  <li>· 단순 변심에 의한 환불은 불가합니다.</li>
                  <li>· 서비스 장애, 기술적 오류 등으로 정상적인 이용이 어려운 경우, 이용하지 못한 기간에 대해 일부 환불이 진행될 수 있습니다.</li>
                  <li>· 환불 여부 및 금액은 내부 정책에 따라 산정됩니다.</li>
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
                  결제 및 환불 정책을 확인하였으며 이에 동의합니다.
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
