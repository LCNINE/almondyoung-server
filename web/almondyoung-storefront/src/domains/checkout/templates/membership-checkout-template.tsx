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
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  const [loading, setLoading] = useState(false)
  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(true)

  const totals: CartTotals = useMemo(
    () => ({
      currency_code: "krw",
      item_subtotal: price,
      shipping: 0,
      discount_subtotal: 0,
      membershipDiscount: 0,
      pointsUsed: 0,
      totalDiscount: 0,
      finalTotal: price,
    }),
    [price]
  )

  const handlePayment = async () => {
    await processPayment()
  }

  const processPayment = async () => {
    try {
      setLoading(true)

      if (!user?.id) {
        throw new Error("로그인이 필요합니다.")
      }

      // returnUrl에 쿼리파라미터를 포함하면 wallet이 ?payment_intent_id=...를 붙일 때 URL이 깨짐
      // mode/planId는 sessionStorage에 저장 후 callback에서 읽음
      const returnUrl = `${window.location.origin}/${countryCode}/checkout/callback`
      const { intentId } = await createMembershipCheckoutIntent(
        planId,
        returnUrl
      )
      setPendingPaymentMode("membership", { planId })

      const walletWebUrl =
        process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
      window.location.href = `${walletWebUrl}/pay/${intentId}`
    } catch (error) {
      console.error("멤버십 결제 요청 실패:", error)
      toast.error(
        error instanceof Error ? error.message : "결제 요청에 실패했습니다."
      )
      setLoading(false)
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
            <section className="mb-6 rounded-[10px] border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-bold text-gray-900">멤버십 플랜</h2>
              <div className="mt-3 flex items-baseline justify-between">
                <div>
                  <p className="text-sm text-gray-500">선택한 플랜</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {planName}
                  </p>
                </div>
                <p className="text-xl font-bold text-[#F29219]">
                  {price.toLocaleString()}원
                </p>
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

      <PCFixedCTA onPayment={handlePayment} loading={loading} totals={totals} />
      <MobileCTA onPayment={handlePayment} loading={loading} />
    </main>
  )
}
