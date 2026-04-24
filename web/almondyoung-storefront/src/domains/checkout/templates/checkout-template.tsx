"use client"

import { DiscountSection } from "@/domains/checkout/components/sections/discount"
import { OrderProductsSection } from "@/domains/checkout/components/sections/order-products-shipping"
import { PaymentTotalSection } from "@/domains/checkout/components/sections/payment-total"
import { ShippingSection } from "@/domains/checkout/components/sections/shipping"
import type { ShippingMemo } from "@/domains/checkout/components/sections/shipping/types"
import { initiatePaymentSession, updateCart } from "@/lib/api/medusa/cart"
import { CartResponseDto } from "@/lib/types/dto/medusa"
import type { CartTotals, ShippingInfo } from "@/lib/types/ui/cart"
import type { Promotion } from "@/lib/types/ui/promotion"
import { buildPaymentItems } from "@/lib/utils/build-payment-items"
import { setCheckoutCartByIntent } from "@/lib/utils/checkout-intent-map"
import {
  calculateMembershipDiscount,
  getCartTotals,
} from "@/lib/utils/price-utils"
import { MobileCTA, PCFixedCTA } from "domains/checkout/components/cta"
import { MobileHeader, PCHeader } from "domains/checkout/components/header"
import { PaymentDetailSidebar } from "domains/checkout/components/payment-detail-sidebar"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"

interface CheckoutTemplateProps {
  isMembership: boolean
  cart: CartResponseDto["cart"]
  checkoutCartId: string
  shipping: ShippingInfo
  promotions: Promotion[]
}

export default function CheckoutTemplate({
  isMembership,
  cart,
  checkoutCartId,
  shipping,
  promotions,
}: CheckoutTemplateProps) {
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  // 선택된 상품 ID (기본값: 전체 선택)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(cart.items?.map((item) => item.id) ?? [])
  )

  // 선택된 상품만 필터링
  const selectedItems = useMemo(
    () => cart.items?.filter((item) => selectedIds.has(item.id)) ?? [],
    [cart.items, selectedIds]
  )

  // 가격 계산 - 선택된 아이템 기준
  const cartTotals: CartTotals = useMemo(() => {
    const { currency_code } = getCartTotals(cart)

    // 선택된 아이템 기준 상품 금액 계산 (멤버십 할인 적용 후)
    const item_subtotal = selectedItems.reduce((acc, item) => {
      return acc + (item.unit_price ?? 0) * (item.quantity ?? 0)
    }, 0)

    // 선택된 아이템 기준 프로모션 할인 계산
    const discount_subtotal = selectedItems.reduce((acc, item) => {
      return acc + (item.discount_total ?? 0)
    }, 0)

    const membershipDiscount =
      isMembership && selectedItems.length > 0
        ? calculateMembershipDiscount(selectedItems)
        : 0

    // 할인 전 정가 기준 상품 금액 (compare_at_unit_price 기준)
    const original_item_subtotal = item_subtotal + membershipDiscount

    const totalDiscount = discount_subtotal
    const finalTotal = Math.max(
      0,
      item_subtotal + shipping.amount - totalDiscount
    )

    return {
      currency_code,
      item_subtotal,
      original_item_subtotal,
      shipping: shipping.amount,
      discount_subtotal,
      membershipDiscount,
      pointsUsed: 0,
      totalDiscount,
      finalTotal,
    }
  }, [cart, shipping, selectedItems, isMembership])

  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 배송 메모 상태
  const [shippingMemo, setShippingMemo] = useState<ShippingMemo>(() => ({
    type: (cart?.metadata?.shipping_memo_type as string) || "",
    custom: (cart?.metadata?.shipping_memo_custom as string) || "",
    hasEntrance: (cart?.metadata?.has_entrance as boolean) || false,
    entrancePassword: (cart?.metadata?.entrance_password as string) || "",
  }))

  const handleShippingMemoChange = useCallback((memo: ShippingMemo) => {
    setShippingMemo(memo)
  }, [])

  const handlePayment = async () => {
    if (!cart?.shipping_address?.address_1) {
      return toast.error("배송지를 설정해주세요.")
    }
    if (!shippingMemo.type) {
      return toast.error("배송 메모를 선택해주세요.")
    }
    // 문 앞 선택 + 공동현관 있음 체크 시 비밀번호 필수
    if (
      shippingMemo.type === "door" &&
      shippingMemo.hasEntrance &&
      !shippingMemo.entrancePassword.trim()
    ) {
      return toast.error("공동현관 비밀번호를 입력해주세요.")
    }
    processPayment()
  }

  const processPayment = async () => {
    try {
      setLoading(true)
      setError(null)

      if (selectedItems.length === 0) {
        setError(
          "결제할 상품이 없습니다. 장바구니로 돌아가 상품을 선택해주세요."
        )
        setLoading(false)
        return
      }

      // 결제 전 배송 메모 저장
      await updateCart(
        {
          metadata: {
            shipping_memo_type: shippingMemo.type,
            shipping_memo_custom:
              shippingMemo.type === "other" ? shippingMemo.custom : "",
            has_entrance:
              shippingMemo.type === "door" ? shippingMemo.hasEntrance : false,
            entrance_password:
              shippingMemo.type === "door" && shippingMemo.hasEntrance
                ? shippingMemo.entrancePassword
                : "",
          },
        },
        checkoutCartId
      )

      const returnUrl = `${window.location.origin}/${countryCode}/checkout/callback`

      const payLineItems = selectedItems
      const firstTitle = payLineItems[0]?.title ?? "상품"
      const orderName =
        payLineItems.length <= 1
          ? `아몬드영 - ${firstTitle}`
          : `아몬드영 - ${firstTitle} 외 ${payLineItems.length - 1}개`

      const paymentItems = buildPaymentItems(
        payLineItems,
        cart.shipping_methods
      )

      const result = await initiatePaymentSession(cart, {
        provider_id: "pp_almond-payment_almond-payment",
        data: { returnUrl, orderName, items: paymentItems },
      })

      const intentId = (
        result?.payment_collection?.payment_sessions?.[0]?.data as Record<
          string,
          unknown
        >
      )?.intentId as string | undefined

      if (!intentId) throw new Error("결제 세션 초기화에 실패했습니다.")
      setCheckoutCartByIntent(intentId, checkoutCartId)

      const walletWebUrl =
        process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
      window.location.href = `${walletWebUrl}/pay/${intentId}`
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
        <MobileHeader onClose={() => router.push(`/${countryCode}/cart`)} />

        <div className="lg:flex lg:w-full lg:justify-between lg:gap-9">
          {/* 왼쪽 섹션 */}
          <div className="lg:max-w-[820px] lg:min-w-[420px] lg:flex-1">
            <ShippingSection
              cartId={checkoutCartId}
              shippingAddress={cart?.shipping_address || null}
              addressName={
                cart?.metadata?.shipping_address_name as string | null
              }
              shippingMemo={shippingMemo}
              onShippingMemoChange={handleShippingMemoChange}
            />
            <OrderProductsSection
              cartId={checkoutCartId}
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
              onCouponApplied={() => router.refresh()}
            />
            <PaymentTotalSection totals={cartTotals} />

            {/* TODO: 현금영수증 및 세금계산서는 wallet-web의 책임이므로 대체 예정 */}
            {/* <ReceiptSection
              cashReceiptOption={cashReceiptOption}
              setCashReceiptOption={setCashReceiptOption}
              taxInvoiceOption={taxInvoiceOption}
              setTaxInvoiceOption={setTaxInvoiceOption}
              taxInvoice={taxInvoice}
            /> */}
          </div>

          {/* 오른쪽 섹션 */}
          <div className="lg:shrink-0">
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
    </main>
  )
}
