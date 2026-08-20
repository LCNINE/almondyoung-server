import { cookies } from "next/headers"

import { EmptyCartView } from "@/components/cart/empty-cart-view"
import { retrieveCart } from "@/lib/api/medusa/cart"
import { recoverCustomerCart } from "@/lib/api/medusa/customer"
import { mintPaymentHandoffToken } from "@/lib/api/users/auth/payment-handoff"
import { toGaCurrency } from "@/lib/analytics/gtag"
import type { CartResponseDto } from "@/lib/types/dto/medusa"

import CheckoutHandoffForm from "./checkout-handoff-form"

// 브릿지는 카트를 검증하지 않는다 — 품절/배송비/쿠폰 검증은 wallet-web /checkout 이 한다.
// 여기서 필요한 건 "카트가 존재하는가"와 GA payload 뿐이라 필드를 최소로 가져와 지연을 줄인다.
const BRIDGE_CART_FIELDS = "*items, +total, +currency_code"

export default async function CheckoutHandoffBridge({
  cartId,
  countryCode,
  walletWebUrl,
}: {
  cartId?: string
  countryCode: string
  /** wallet-web 착지 origin. 호출부가 존재를 확인하고 넘긴다. */
  walletWebUrl: string
}) {
  let cart = (await retrieveCart(
    cartId,
    BRIDGE_CART_FIELDS,
    "no-store"
  )) as CartResponseDto["cart"]

  // 쿠키의 카트 id 가 없거나(다른 브라우저/앱 웹뷰) 가리키는 카트가 완료·삭제됐어도, 로그인
  // 상태면 고객의 미완료 카트를 customer_id 로 찾는다.
  if (!cart) {
    const recovered = await recoverCustomerCart().catch(() => null)
    if (recovered?.id) {
      cart = (await retrieveCart(
        recovered.id,
        BRIDGE_CART_FIELDS,
        "no-store"
      ).catch(() => null)) as CartResponseDto["cart"]
    }
  }

  if (!cart || !cart.items?.length) {
    return <EmptyCartView />
  }

  const jar = await cookies()
  const medusaJwt = jar.get("_medusa_jwt")?.value ?? ""

  // 토큰 발급이 실패해도 폼은 보낸다 — wallet-web 이 `h` 없으면 /auth/ensure(refresh → silent SSO)
  // 로 떨어뜨린다. 여기서 막아 세우는 것보다 그쪽 폴백에 맡기는 편이 복구 확률이 높다.
  const handoffToken = await mintPaymentHandoffToken().catch(() => "")

  const gaEcommerce = {
    currency: toGaCurrency(cart.currency_code),
    value: cart.total ?? 0,
    items: (cart.items ?? []).map((item) => ({
      item_id: item.product_id ?? item.id,
      item_name: item.product_title ?? item.title,
      item_variant: item.title ?? undefined,
      price: item.unit_price ?? 0,
      quantity: item.quantity,
    })),
  }

  return (
    <CheckoutHandoffForm
      action={`${walletWebUrl}/auth/handoff`}
      handoffToken={handoffToken}
      medusaJwt={medusaJwt}
      cartId={cart.id}
      countryCode={countryCode}
      gaEcommerce={gaEcommerce}
    />
  )
}
