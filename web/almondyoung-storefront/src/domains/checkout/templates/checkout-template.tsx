"use client"

import { ShippingSection } from "@/domains/checkout/components/sections/shipping-section"
import type { ShippingMemo } from "@/domains/checkout/components/sections/shipping-section/types"
import { updateCart } from "@/lib/api/medusa/cart"
import type { UserDetail } from "@lib/types/ui/user"
import { StoreCart } from "@medusajs/types"
import { loadTossPayments } from "@tosspayments/tosspayments-sdk"
import { MobileCTA, PCFixedCTA } from "domains/checkout/components/cta"
import { MobileHeader, PCHeader } from "domains/checkout/components/header"
import { MobileOrderSummary } from "domains/checkout/components/order-summary"
import { PaymentDetailSidebar } from "domains/checkout/components/payment-detail-sidebar"
import { DiscountSection } from "domains/checkout/components/sections/discount-section"
import { OrderProductsSection } from "domains/checkout/components/sections/order-products-shipping-section"
import { PaymentMethodSection } from "domains/checkout/components/sections/payment-method-section"
import { PaymentInfoSection } from "domains/checkout/components/sections/paymentInfo-section"
import { ReceiptSection } from "domains/checkout/components/sections/receipt-section"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useRef, useState } from "react"

interface CheckoutTemplateProps {
  user: UserDetail
  cart: StoreCart | null
}

export default function CheckoutTemplate({
  user,
  cart,
}: CheckoutTemplateProps) {
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  const [selectedMethod, setSelectedMethod] = useState("payLater")
  const [cashReceiptOption, setCashReceiptOption] = useState("noapply")
  const [taxInvoiceOption, setTaxInvoiceOption] = useState("noapply")
  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tossPaymentRef = useRef<any>(null)

  // 배송 메모 상태
  const [shippingMemo, setShippingMemo] = useState<ShippingMemo>(() => ({
    type: (cart?.metadata?.shipping_memo_type as string) || "",
    custom: (cart?.metadata?.shipping_memo_custom as string) || "",
  }))

  const handleShippingMemoChange = useCallback((memo: ShippingMemo) => {
    setShippingMemo(memo)
  }, [])

  // Intent 생성 및 토스 결제 초기화
  const initializeTossPayment = async () => {
    try {
      if (!user?.id) {
        throw new Error("로그인이 필요합니다.")
      }

      // Intent 생성 (라우트 핸들러 사용)
      const intentResponse = await fetch("/api/wallet/payments/intents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          customerId: user.id,
          originalAmount: 100, // TODO: 실제 금액으로 교체
          discountAmount: 0,
          type: "ORDER",
        }),
        cache: "no-store",
      })

      if (!intentResponse.ok) {
        const errorData = await intentResponse.json().catch(() => ({}))
        throw new Error(errorData.message || "Intent 생성 실패")
      }

      const intent = await intentResponse.json()

      // 3. 토스 결제 SDK 초기화
      const clientKey =
        process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ||
        "test_ck_pP2YxJ4K87ZZmMga5K59rRGZwXLO"
      const tossPayments = await loadTossPayments(clientKey)
      const payment = tossPayments.payment({
        customerKey: intent.customerId,
      })

      tossPaymentRef.current = { payment, intentId: intent.id }
      return intent
    } catch (err) {
      console.error("토스 결제 초기화 실패:", err)
      throw err
    }
  }

  const handlePayment = async () => {
    try {
      setLoading(true)
      setError(null)

      // 결제 전 배송 메모 저장
      await updateCart({
        metadata: {
          shipping_memo_type: shippingMemo.type,
          shipping_memo_custom:
            shippingMemo.type === "other" ? shippingMemo.custom : "",
        },
      })

      if (selectedMethod === "toss") {
        // 토스 결제: 결제창 열기
        if (!tossPaymentRef.current) {
          await initializeTossPayment()
        }

        const { payment, intentId } = tossPaymentRef.current
        const baseUrl = window.location.origin

        await payment.requestPayment({
          method: "CARD",
          amount: {
            currency: "KRW",
            value: 100, // TODO: 실제 금액으로 교체
          },
          orderId: intentId,
          orderName: "주문 상품", // TODO: 실제 주문명으로 교체
          successUrl: `${baseUrl}/${countryCode}/checkout/callback`,
          failUrl: `${baseUrl}/${countryCode}/checkout/callback`,
          customerEmail: "customer@example.com", // TODO: 실제 이메일로 교체
          customerName: "고객명", // TODO: 실제 이름으로 교체
          customerMobilePhone: "01012341234", // TODO: 실제 전화번호로 교체
        })
      } else if (selectedMethod === "payLater") {
        // 나중 결제: 라우트 핸들러로 직접 요청
        if (!user?.id) {
          throw new Error("로그인이 필요합니다.")
        }

        // Intent 생성 (라우트 핸들러 사용)
        const intentResponse = await fetch("/api/wallet/payments/intents", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            credentials: "include",
          },

          body: JSON.stringify({
            customerId: user.id,
            originalAmount: 100, // TODO: 실제 금액으로 교체
            discountAmount: 0,
            type: "ORDER",
          }),
          cache: "no-store",
        })

        if (!intentResponse.ok) {
          const errorData = await intentResponse.json().catch(() => ({}))
          throw new Error(errorData.message || "Intent 생성 실패")
        }

        const intent = await intentResponse.json()

        // 3. BNPL 프로필 조회 (나중 결제는 프로필이 필요)
        const profilesResponse = await fetch("/api/wallet/payments/profiles", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        })

        let profileId: string | undefined
        if (profilesResponse.ok) {
          const profiles = await profilesResponse.json()
          // HMS_BNPL 프로필 찾기
          const bnplProfile = profiles.find(
            (p: any) => p.provider === "HMS_BNPL" && p.status === "ACTIVE"
          )
          profileId = bnplProfile?.id
        }

        if (!profileId) {
          throw new Error(
            "BNPL 프로필이 등록되어 있지 않습니다. 프로필을 먼저 등록해주세요."
          )
        }

        // 4. 결제 승인 (라우트 핸들러 사용)
        // 나중 결제는 HMS_BNPL로 처리
        const authorizeResponse = await fetch(
          `/api/wallet/payments/intents/${intent.id}/authorize`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              provider: "HMS_BNPL", // 나중 결제는 BNPL로 처리
              profileId: profileId, // BNPL 프로필 ID 필수
            }),
            cache: "no-store",
          }
        )

        if (!authorizeResponse.ok) {
          const errorData = await authorizeResponse.json().catch(() => ({}))
          throw new Error(errorData.message || "결제 승인 실패")
        }

        const responseData = await authorizeResponse.json()

        const result = responseData.data || responseData

        if (result.success && result.intentId) {
          router.push(`/${countryCode}/checkout/success/${result.intentId}`)
        } else {
          throw new Error(
            result.message ||
              `결제 승인 실패: success=${result?.success}, intentId=${result?.intentId}`
          )
        }
      }
    } catch (err) {
      console.error("결제 처리 실패:", err)
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="bg-muted min-h-screen w-full">
      <PCHeader />

      <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px] md:py-8">
        <MobileHeader onClose={() => router.back()} />

        <div className="md:flex md:w-full md:justify-between md:gap-9">
          {/* 왼쪽 섹션 */}
          <div className="md:max-w-[820px] md:min-w-[420px] md:flex-1">
            <ShippingSection
              shippingAddress={cart?.shipping_address || null}
              addressName={
                cart?.metadata?.shipping_address_name as string | null
              }
              shippingMemo={shippingMemo}
              onShippingMemoChange={handleShippingMemoChange}
            />
            <OrderProductsSection
              products={cart?.items}
              shippingTotal={cart?.shipping_total}
            />
            <DiscountSection />
            <PaymentInfoSection />
            <PaymentMethodSection
              selectedMethod={selectedMethod}
              setSelectedMethod={setSelectedMethod}
            />
            <ReceiptSection
              cashReceiptOption={cashReceiptOption}
              setCashReceiptOption={setCashReceiptOption}
              taxInvoiceOption={taxInvoiceOption}
              setTaxInvoiceOption={setTaxInvoiceOption}
            />
          </div>

          {/* 오른쪽 섹션 */}
          <div className="md:shrink-0">
            <MobileOrderSummary />
            <PaymentDetailSidebar
              isOpen={isPaymentDetailsOpen}
              setIsOpen={setIsPaymentDetailsOpen}
            />
          </div>
        </div>
      </div>

      {/* 에러 메시지 표시 */}
      {error && (
        <div className="fixed top-20 left-1/2 z-50 mx-4 w-full max-w-md -translate-x-1/2">
          <div className="rounded-lg border border-red-400 bg-red-100 p-4 text-red-700 shadow-lg">
            <div className="flex items-center justify-between">
              <strong>오류:</strong>
              <button
                onClick={() => setError(null)}
                className="text-red-700 hover:text-red-900"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        </div>
      )}

      <PCFixedCTA onPayment={handlePayment} loading={loading} />
      <MobileCTA onPayment={handlePayment} loading={loading} />
    </main>
  )
}
