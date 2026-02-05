"use client"

import { PinRequiredModal } from "@/domains/checkout/components/modals/pin-required-modal"
import { PinVerifyModal } from "@/domains/checkout/components/modals/pin-verify-modal"
import { PaymentMethodSection } from "@/domains/checkout/components/sections/payment-method"
import { PaymentTotalSection } from "@/domains/checkout/components/sections/payment-total"
import { usePinStatus } from "@/hooks/api/use-pin-status"
import { createIntent } from "@/lib/api/wallet"
import type { CartTotals } from "@/lib/types/ui/cart"
import type { UserDetail } from "@lib/types/ui/user"
import { getCleanKoreanNumber } from "@/lib/utils/format-phone-number"
import { loadTossPayments } from "@tosspayments/tosspayments-sdk"
import { MobileCTA, PCFixedCTA } from "domains/checkout/components/cta"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
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

  const { pinStatus, fetchPinStatus } = usePinStatus()
  const [selectedMethod, setSelectedMethod] = useState("toss")
  const [loading, setLoading] = useState(false)
  const [pinRequiredModalOpen, setPinRequiredModalOpen] = useState(false)
  const [pinVerifyModalOpen, setPinVerifyModalOpen] = useState(false)
  const tossPaymentRef = useRef<any>(null)

  useEffect(() => {
    fetchPinStatus()
  }, [fetchPinStatus])

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

  const initializeTossPayment = async () => {
    if (!user?.id) {
      throw new Error("로그인이 필요합니다.")
    }

    const intent = await createIntent({
      data: {
        customerId: user.id,
        originalAmount: totals.finalTotal,
        discountAmount: 0,
        type: "MEMBERSHIP_FEE",
      },
    })

    const clientKey =
      process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ||
      "test_ck_pP2YxJ4K87ZZmMga5K59rRGZwXLO"
    const tossPayments = await loadTossPayments(clientKey)
    const payment = tossPayments.payment({
      customerKey: intent.customerId,
    })

    tossPaymentRef.current = { payment, intentId: intent.id }
    return intent
  }

  const handlePayment = async () => {
    try {
      setLoading(true)

      if (!pinStatus) {
        fetchPinStatus()
        toast.info("PIN 상태를 확인 중입니다. 잠시 후 다시 시도해주세요.")
        setLoading(false)
        return
      }

      if (!pinStatus.hasPin || pinStatus.status === "NONE") {
        setPinRequiredModalOpen(true)
        setLoading(false)
        return
      }

      if (pinStatus.status === "ACTIVE") {
        setPinVerifyModalOpen(true)
        setLoading(false)
        return
      }
    } catch (error) {
      console.error("멤버십 결제 처리 실패:", error)
      toast.error(
        error instanceof Error ? error.message : "결제 처리에 실패했습니다."
      )
      setLoading(false)
    }
  }

  const processPayment = async () => {
    try {
      setLoading(true)

      if (selectedMethod === "toss") {
        if (!tossPaymentRef.current) {
          await initializeTossPayment()
        }

        const { payment, intentId } = tossPaymentRef.current
        const baseUrl = window.location.origin

        await payment.requestPayment({
          method: "CARD",
          amount: {
            currency: "KRW",
            value: totals.finalTotal,
          },
          orderId: intentId,
          orderName: `멤버십 구독 - ${planName}`,
          successUrl: `${baseUrl}/${countryCode}/checkout/callback?mode=membership&planId=${planId}`,
          failUrl: `${baseUrl}/${countryCode}/checkout/callback?mode=membership&planId=${planId}`,
          customerEmail: user.email,
          customerName: user.username,
          customerMobilePhone: getCleanKoreanNumber(
            user.profile?.phoneNumber ?? ""
          ),
        })
      }
    } catch (error) {
      console.error("멤버십 결제 요청 실패:", error)
      toast.error(
        error instanceof Error ? error.message : "결제 요청에 실패했습니다."
      )
      setLoading(false)
    }
  }

  return (
    <section className="bg-[#f8f8f8] pb-20">
      <div className="container mx-auto flex max-w-[1360px] flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-10 lg:px-10">
        <div className="flex-1 space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6">
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
          </div>

          <PaymentTotalSection totals={totals} />
          <PaymentMethodSection
            selectedMethod={selectedMethod}
            setSelectedMethod={setSelectedMethod}
          />
        </div>
      </div>

      <PCFixedCTA onPayment={handlePayment} loading={loading} totals={totals} />
      <MobileCTA onPayment={handlePayment} loading={loading} />

      <PinRequiredModal
        open={pinRequiredModalOpen}
        setOpen={setPinRequiredModalOpen}
      />
      <PinVerifyModal
        open={pinVerifyModalOpen}
        setOpen={setPinVerifyModalOpen}
        onSuccess={processPayment}
        onCancel={() => setLoading(false)}
      />
    </section>
  )
}
