"use client"

import { DiscountSection } from "@/domains/checkout/components/sections/discount"
import { PinRequiredModal } from "@/domains/checkout/components/modals/pin-required-modal"
import { PinVerifyModal } from "@/domains/checkout/components/modals/pin-verify-modal"
import { OrderProductsSection } from "@/domains/checkout/components/sections/order-products-shipping"
import { PaymentMethodSection } from "@/domains/checkout/components/sections/payment-method"
import { PaymentTotalSection } from "@/domains/checkout/components/sections/payment-total"
import { ShippingSection } from "@/domains/checkout/components/sections/shipping"
import type { ShippingMemo } from "@/domains/checkout/components/sections/shipping/types"
import { updateCart } from "@/lib/api/medusa/cart"
import {
  authorizePayment,
  createIntent,
  getBnplProfiles,
} from "@/lib/api/wallet"
import { CartResponseDto } from "@/lib/types/dto/medusa"
import type { PointBalanceDto } from "@/lib/types/dto/wallet"
import type { CartTotals, ShippingInfo } from "@/lib/types/ui/cart"
import type { Promotion } from "@/lib/types/ui/promotion"
import { TaxInvoiceType } from "@/lib/types/ui/wallet"
import {
  calculateMembershipDiscount,
  getCartTotals,
} from "@/lib/utils/price-utils"
import type { UserDetail } from "@lib/types/ui/user"
import { loadTossPayments } from "@tosspayments/tosspayments-sdk"
import { MobileCTA, PCFixedCTA } from "domains/checkout/components/cta"
import { MobileHeader, PCHeader } from "domains/checkout/components/header"
import { MobileOrderSummary } from "domains/checkout/components/order-summary"
import { PaymentDetailSidebar } from "domains/checkout/components/payment-detail-sidebar"
import { usePinStatus } from "@/hooks/api/use-pin-status"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ReceiptSection } from "../components/sections/receipt/"
import { toast } from "sonner"
import { getCleanKoreanNumber } from "@/lib/utils/format-phone-number"

interface CheckoutTemplateProps {
  user: UserDetail
  cart: CartResponseDto["cart"]
  shipping: ShippingInfo
  promotions: Promotion[]
  pointBalance: PointBalanceDto
  taxInvoice: TaxInvoiceType
}

export default function CheckoutTemplate({
  user,
  cart,
  shipping,
  promotions,
  pointBalance,
  taxInvoice,
}: CheckoutTemplateProps) {
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  // PIN 상태 조회
  const { pinStatus, fetchPinStatus } = usePinStatus()

  //  PIN 상태 미리 조회
  useEffect(() => {
    fetchPinStatus()
  }, [fetchPinStatus])

  // 선택된 상품 ID (기본값: 전체 선택)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(cart.items?.map((item) => item.id) ?? [])
  )

  // 선택된 상품만 필터링
  const selectedItems = useMemo(
    () => cart.items?.filter((item) => selectedIds.has(item.id)) ?? [],
    [cart.items, selectedIds]
  )

  // 멤버십 여부
  const isMembership =
    cart?.customer?.groups?.some(
      (group) => group.name.toLowerCase() === "membership"
    ) ?? false

  // 적립금 사용 상태
  const [pointsUsed, setPointsUsed] = useState(0)

  // 가격 계산 (한 번에 계산하여 여러 컴포넌트에 전달)
  const cartTotals: CartTotals = useMemo(() => {
    const { currency_code, item_subtotal, discount_subtotal } =
      getCartTotals(cart)
    const membershipDiscount =
      isMembership && selectedItems.length > 0
        ? calculateMembershipDiscount(selectedItems)
        : 0
    const totalDiscount = discount_subtotal + membershipDiscount + pointsUsed
    const finalTotal = Math.max(
      0,
      item_subtotal + shipping.amount - totalDiscount
    )

    return {
      currency_code,
      item_subtotal,
      shipping: shipping.amount,
      discount_subtotal,
      membershipDiscount,
      pointsUsed,
      totalDiscount,
      finalTotal,
    }
  }, [cart, shipping, isMembership, selectedItems, pointsUsed])

  const [selectedMethod, setSelectedMethod] = useState("payLater")
  const [cashReceiptOption, setCashReceiptOption] = useState("noapply")
  const [taxInvoiceOption, setTaxInvoiceOption] = useState(
    taxInvoice?.defaultEnabled ? "apply" : "noapply"
  )
  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pinRequiredModalOpen, setPinRequiredModalOpen] = useState(false)
  const [pinVerifyModalOpen, setPinVerifyModalOpen] = useState(false)
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

      const intent = await createIntent({
        data: {
          customerId: user.id,
          originalAmount: cartTotals.finalTotal,
          discountAmount: 0,
          type: "ORDER",
        },
      })

      // 토스 결제 SDK 초기화
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
    // 배송지 확인
    if (!cart?.shipping_address?.address_1) {
      return toast.error("배송지를 설정해주세요.")
    }

    try {
      setLoading(true)
      setError(null)

      //  PIN 상태 확인
      if (!pinStatus) {
        // PIN 상태 조회 중이거나 실패한 경우
        fetchPinStatus()
        return toast.info(
          "PIN 상태를 확인 중입니다. 잠시 후 다시 시도해주세요."
        )
      }

      if (!pinStatus.hasPin || pinStatus.status === "NONE") {
        // PIN 미등록 → 확인 모달 열기
        setPinRequiredModalOpen(true)
        setLoading(false)
        return
      }

      if (pinStatus.status === "ACTIVE") {
        // PIN 검증 필요 → 검증 모달 열기
        setPinVerifyModalOpen(true)
        setLoading(false)
        return
      }
    } catch (err) {
      console.error("결제 처리 실패:", err)
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
      setLoading(false)
    }
  }

  // PIN 검증 성공 후 실제 결제 진행
  const processPayment = async () => {
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
            value: cartTotals.finalTotal,
          },
          orderId: intentId,
          orderName: cart.items?.map((item) => item.title).join(", "),
          successUrl: `${baseUrl}/${countryCode}/checkout/callback`,
          failUrl: `${baseUrl}/${countryCode}/checkout/callback`,
          customerEmail: user.email,
          customerName: user.username,
          customerMobilePhone:
            cart.shipping_address?.phone ??
            getCleanKoreanNumber(user.profile?.phoneNumber ?? ""),
        })
      } else if (selectedMethod === "payLater") {
        // 나중 결제: 라우트 핸들러로 직접 요청
        if (!user?.id) {
          throw new Error("로그인이 필요합니다.")
        }

        const intent = await createIntent({
          data: {
            customerId: user.id,
            originalAmount: cartTotals.finalTotal, // todo: 할인전 가격을 넣어야함
            discountAmount: 0, // 적립금 사용했을때의 금액을 여기에 넣어야 함
            type: "ORDER",
          },
        })

        //  BNPL 프로필 조회 (나중 결제는 프로필이 필요)
        const profiles = await getBnplProfiles()

        // HMS_BNPL 프로필 찾기
        const bnplProfile = profiles?.find(
          (p: any) => p.provider === "HMS_BNPL" && p.status === "ACTIVE"
        )

        const profileId = bnplProfile?.id

        if (!profileId) {
          throw new Error(
            "BNPL 프로필이 등록되어 있지 않습니다. 프로필을 먼저 등록해주세요."
          )
        }

        // 결제 승인 (라우트 핸들러 사용)
        // 나중 결제는 HMS_BNPL로 처리
        const authorize = await authorizePayment(intent.id, {
          provider: "HMS_BNPL",
          profileId: profileId,
        })

        if (authorize.success) {
          router.push(`/${countryCode}/checkout/success/${intent.id}`)
        } else {
          throw new Error(
            authorize.message ||
              `결제 승인 실패: success=${authorize?.success}, intentId=${intent.id}`
          )
        }
      }
    } catch (err) {
      console.error("결제 처리 실패:", err)
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
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
              shipping={shipping.amount}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
            />
            <DiscountSection
              cartId={cart.id}
              isMembership={isMembership}
              membershipDiscount={cartTotals.membershipDiscount}
              itemSubtotal={cartTotals.item_subtotal}
              shipping={shipping}
              promotions={promotions}
              appliedPromotionCode={cart.promotions?.[0]?.code}
              availablePoints={pointBalance.withdrawable}
              onPointsChange={setPointsUsed}
              onCouponApplied={() => router.refresh()}
            />
            <PaymentTotalSection totals={cartTotals} />

            <PaymentMethodSection
              selectedMethod={selectedMethod}
              setSelectedMethod={setSelectedMethod}
            />

            <ReceiptSection
              cashReceiptOption={cashReceiptOption}
              setCashReceiptOption={setCashReceiptOption}
              taxInvoiceOption={taxInvoiceOption}
              setTaxInvoiceOption={setTaxInvoiceOption}
              taxInvoice={taxInvoice}
            />
          </div>

          {/* 오른쪽 섹션 */}
          <div className="lg:shrink-0">
            <MobileOrderSummary
              totals={cartTotals}
              isMembership={isMembership}
            />
            <PaymentDetailSidebar
              isOpen={isPaymentDetailsOpen}
              setIsOpen={setIsPaymentDetailsOpen}
              totals={cartTotals}
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

      <PCFixedCTA
        onPayment={handlePayment}
        loading={loading}
        totals={cartTotals}
      />
      <MobileCTA onPayment={handlePayment} loading={loading} />

      {/* PIN 등록 필요 모달 */}
      <PinRequiredModal
        open={pinRequiredModalOpen}
        onOpenChange={setPinRequiredModalOpen}
      />

      {/* PIN 검증 모달 */}
      <PinVerifyModal
        open={pinVerifyModalOpen}
        onOpenChange={setPinVerifyModalOpen}
        onSuccess={processPayment}
      />
    </main>
  )
}
