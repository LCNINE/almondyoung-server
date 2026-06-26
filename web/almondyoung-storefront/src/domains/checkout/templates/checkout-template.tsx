"use client"

import { CustomsCodeSection } from "@/domains/checkout/components/sections/customs-code"
import { DiscountSection } from "@/domains/checkout/components/sections/discount"
import { OrderProductsSection } from "@/domains/checkout/components/sections/order-products-shipping"
import { PaymentTotalSection } from "@/domains/checkout/components/sections/payment-total"
import { ShippingSection } from "@/domains/checkout/components/sections/shipping"
import type { ShippingMemo } from "@/domains/checkout/components/sections/shipping/types"
import {
  cartHasOverseasItem,
  isValidPersonalCustomsCode,
} from "@/domains/checkout/utils/customs"
import { initiatePaymentSession, updateCart } from "@/lib/api/medusa/cart"
import { cartRequiresShipping } from "@/lib/api/medusa/shipping-method-policy"
import { mintPaymentHandoffToken } from "@/lib/api/users/auth/payment-handoff"
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
import { useTranslations } from "next-intl"
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

function isUnauthorizedError(error: unknown): boolean {
  const err = error as Error & { digest?: string }
  return err?.digest === "UNAUTHORIZED" || err?.message === "UNAUTHORIZED"
}

async function restoreStorefrontToken(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/restore-token", {
      method: "POST",
      credentials: "include",
    })
    return res.ok
  } catch {
    return false
  }
}

function redirectToWalletHandoff(
  walletWebUrl: string,
  handoffToken: string,
  payPath: string
) {
  window.location.href = `${walletWebUrl}/auth/handoff?h=${encodeURIComponent(
    handoffToken
  )}&redirect_to=${encodeURIComponent(payPath)}`
}

function redirectToWalletEnsure(walletWebUrl: string, payPath: string) {
  window.location.href = `${walletWebUrl}/auth/ensure?redirect_to=${encodeURIComponent(
    payPath
  )}`
}

export default function CheckoutTemplate({
  isMembership,
  cart,
  checkoutCartId,
  shipping,
  promotions,
}: CheckoutTemplateProps) {
  const tProcess = useTranslations("checkout.process")
  const tCustoms = useTranslations("checkout.customsCode")
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  const cartItems = useMemo(() => cart.items ?? [], [cart.items])

  // 배송 필요 여부 — 전체 카트 기준. 디지털 단독 카트면 false → 배송지/배송메모 강제와 배송비를 모두 생략한다.
  // 판별은 line item requires_shipping 우선, 없으면 product_type 폴백(shipping-method-policy).
  const requiresShipping = cartRequiresShipping(cartItems)

  // 가격 계산 - checkout cart 전체 기준
  const cartTotals: CartTotals = useMemo(() => {
    const { currency_code, item_subtotal, discount_subtotal, total } =
      getCartTotals(cart)

    const membershipDiscount =
      isMembership && cartItems.length > 0
        ? calculateMembershipDiscount(cartItems)
        : 0

    // 할인 전 정가 기준 상품 금액 (compare_at_unit_price 기준)
    const original_item_subtotal = item_subtotal + membershipDiscount

    // 배송 불필요(디지털 단독)면 배송비 0
    const effectiveShipping = requiresShipping ? shipping.amount : 0

    const totalDiscount = discount_subtotal
    // 최종 결제금액은 Medusa 권위값(total: 배송비/세금 포함)을 그대로 사용한다.
    // 디지털 단독 카트는 배송메서드가 없어 total에 배송비가 포함되지 않는다(buildPaymentItems도 동일하게 배송 제외).
    const finalTotal = total

    return {
      currency_code,
      item_subtotal,
      original_item_subtotal,
      shipping: effectiveShipping,
      discount_subtotal,
      membershipDiscount,
      pointsUsed: 0,
      totalDiscount,
      finalTotal,
    }
  }, [cart, cartItems, shipping, isMembership, requiresShipping])

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

  // 해외직구 상품 포함 여부 → 개인통관고유부호 입력 필수
  const hasOverseasItem = useMemo(() => cartHasOverseasItem(cart), [cart])
  const [personalCustomsCode, setPersonalCustomsCode] = useState<string>(
    () =>
      (cart?.shipping_address?.metadata?.personalCustomsCode as string) || ""
  )
  const [customsCodeError, setCustomsCodeError] = useState<string | null>(null)

  const handleCustomsCodeChange = useCallback((value: string) => {
    setPersonalCustomsCode(value)
    setCustomsCodeError((prev) => (prev ? null : prev))
  }, [])

  const handlePayment = async () => {
    // 배송이 필요할 때만 배송지/배송메모를 강제한다.
    if (requiresShipping) {
      if (!cart?.shipping_address?.address_1) {
        return toast.error(tProcess("toasts.setShipping"))
      }
      if (!shippingMemo.type) {
        return toast.error(tProcess("toasts.selectMemo"))
      }
      // 문 앞 선택 + 공동현관 있음 체크 시 비밀번호 필수
      if (
        shippingMemo.type === "door" &&
        shippingMemo.hasEntrance &&
        !shippingMemo.entrancePassword.trim()
      ) {
        return toast.error(tProcess("toasts.enterEntrancePw"))
      }
    }
    // 해외직구 상품이 있으면 개인통관고유부호 형식 검증
    if (hasOverseasItem && !isValidPersonalCustomsCode(personalCustomsCode)) {
      setCustomsCodeError(tCustoms("error"))
      return toast.error(tCustoms("error"))
    }
    processPayment()
  }

  const processPayment = async () => {
    try {
      setLoading(true)
      setError(null)

      if (cartItems.length === 0) {
        setError(tProcess("toasts.noItems"))
        setLoading(false)
        return
      }

      // 결제 전 배송 메모 저장 (배송이 필요한 카트에서만)
      if (requiresShipping) {
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
      }

      // 해외직구 상품이 있으면 개인통관고유부호를 shipping_address.metadata 에 저장
      if (hasOverseasItem && cart?.shipping_address) {
        const addr = cart.shipping_address
        await updateCart(
          {
            shipping_address: {
              first_name: addr.first_name ?? undefined,
              last_name: addr.last_name ?? undefined,
              phone: addr.phone ?? undefined,
              company: addr.company ?? undefined,
              address_1: addr.address_1 ?? undefined,
              address_2: addr.address_2 ?? undefined,
              city: addr.city ?? undefined,
              province: addr.province ?? undefined,
              postal_code: addr.postal_code ?? undefined,
              country_code: addr.country_code ?? undefined,
              metadata: {
                ...(addr.metadata ?? {}),
                personalCustomsCode: personalCustomsCode.trim(),
              },
            },
          },
          checkoutCartId
        )
      }

      const returnUrl = `${window.location.origin}/${countryCode}/checkout/callback`

      const payLineItems = cartItems
      const firstTitle = payLineItems[0]?.title ?? tProcess("productFallback")
      const orderName =
        payLineItems.length <= 1
          ? tProcess("orderNameSingle", { title: firstTitle })
          : tProcess("orderNameMultiple", {
              title: firstTitle,
              count: payLineItems.length - 1,
            })

      // 배송이 필요할 때만 배송비를 결제항목에 포함(화면 총액과 일치)
      const paymentItems = buildPaymentItems(
        payLineItems,
        requiresShipping ? cart.shipping_methods : []
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

      if (!intentId) throw new Error(tProcess("toasts.paymentInitFailed"))
      setCheckoutCartByIntent(intentId, checkoutCartId)

      const walletWebUrl =
        process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
      const payPath = `/pay/${intentId}?region=${countryCode}`

      // 결제창(wallet-web)은 별도 서브도메인이라, 인앱브라우저·iOS Safari(ITP)에서 로그인 세션을
      // 재확보하지 못해 결제가 막힌다. storefront에서 단기 핸드오프 토큰을 발급해 넘기면 wallet-web이
      // 그걸 교환해 자기 세션을 확보한다. 발급 실패 시 기존 직접 진입으로 폴백(무회귀).
      try {
        const handoffToken = await mintPaymentHandoffToken()
        redirectToWalletHandoff(walletWebUrl, handoffToken, payPath)
      } catch (handoffErr) {
        if (isUnauthorizedError(handoffErr)) {
          const restored = await restoreStorefrontToken()
          if (restored) {
            try {
              const retryHandoffToken = await mintPaymentHandoffToken()
              redirectToWalletHandoff(walletWebUrl, retryHandoffToken, payPath)
              return
            } catch (retryErr) {
              if (!isUnauthorizedError(retryErr)) {
                window.location.href = `${walletWebUrl}${payPath}`
                return
              }
            }
          }

          redirectToWalletEnsure(walletWebUrl, payPath)
          return
        }
        // 핸드오프 미가용(미배포 등) → 기존 경로로 진입(wallet-web 자체 세션 복구).
        window.location.href = `${walletWebUrl}${payPath}`
      }
    } catch (err) {
      console.error("결제 처리 실패:", err)
      setError(
        err instanceof Error ? err.message : tProcess("toasts.unknownError")
      )
      setLoading(false)
    }
  }

  return (
    <main className="bg-muted min-h-screen w-full">
      <PCHeader />

      <div className="container mx-auto px-4 lg:px-[40px] lg:py-8">
        <MobileHeader onClose={() => router.push(`/${countryCode}/cart`)} />

        <div className="mx-auto lg:max-w-[820px]">
          {requiresShipping && (
            <ShippingSection
              cartId={checkoutCartId}
              shippingAddress={cart?.shipping_address || null}
              addressName={
                cart?.metadata?.shipping_address_name as string | null
              }
              shippingMemo={shippingMemo}
              onShippingMemoChange={handleShippingMemoChange}
            />
          )}
          {hasOverseasItem && (
            <CustomsCodeSection
              value={personalCustomsCode}
              onChange={handleCustomsCodeChange}
              error={customsCodeError}
            />
          )}
          <OrderProductsSection
            products={cartItems}
            shipping={requiresShipping ? shipping.amount : 0}
          />
          <DiscountSection
            cartId={cart.id}
            isMembership={isMembership}
            membershipDiscount={cartTotals.membershipDiscount}
            itemSubtotal={cartTotals.item_subtotal}
            cartDiscountTotal={cartTotals.discount_subtotal}
            shipping={shipping}
            promotions={promotions}
            appliedPromotionCode={cart.promotions?.[0]?.code}
            onCouponApplied={() => router.refresh()}
          />
          <PaymentTotalSection totals={cartTotals} />
        </div>
      </div>

      {/* 에러 메시지 표시 */}
      {error && (
        <div className="fixed top-20 left-1/2 z-50 mx-4 w-full max-w-md -translate-x-1/2">
          <div className="rounded-lg border border-red-400 bg-red-100 p-4 text-red-700 shadow-lg">
            <div className="flex items-center justify-between">
              <strong>{tProcess("errorPrefix")}</strong>
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
