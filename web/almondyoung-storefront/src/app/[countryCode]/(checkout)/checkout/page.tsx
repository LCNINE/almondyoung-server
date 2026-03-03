import { EmptyCartView } from "@/components/cart/empty-cart-view"
import {
  addCartShippingMethodDuringRender,
  listCartShippingMethods,
  retrieveCart,
} from "@/lib/api/medusa/cart"
import { listCartPaymentMethods } from "@/lib/api/medusa/payment"
import { getMyPromotions } from "@/lib/api/medusa/promotion"
import { getPointBalance, getTaxInvoice } from "@/lib/api/wallet"
import { CartResponseDto } from "@/lib/types/dto/medusa"
import type { ShippingInfo } from "@/lib/types/ui/cart"
import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"
import { notFound } from "next/navigation"

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ cartId?: string }>
}) {
  const { countryCode } = await params
  const { cartId } = await searchParams

  return (
    <ProtectedRoute>
      <CheckoutManager countryCode={countryCode} cartId={cartId} />
    </ProtectedRoute>
  )
}

async function CheckoutManager({
  countryCode,
  cartId,
}: {
  countryCode: string
  cartId?: string
}) {
  const currentUser = await fetchMe()
  const cart = (await retrieveCart(cartId)) as CartResponseDto["cart"]

  if (!cart) {
    return notFound()
  }

  if (!cart.items?.length) {
    return (
      <ProtectedRoute>
        <EmptyCartView countryCode={countryCode} />
      </ProtectedRoute>
    )
  }

  const [shippingMethods, paymentMethods, promotionsResponse] =
    await Promise.all([
      listCartShippingMethods(cart.id),
      listCartPaymentMethods(cart.region?.id ?? ""),
      getMyPromotions({ limit: 100 }).catch(() => ({
        promotions: [],
        count: 0,
        offset: 0,
        limit: 100,
      })),
    ])

  // 배송 수단이 카트에 추가되지 않은 경우 자동으로 첫 번째 옵션 추가
  // revalidateTag는 렌더 중 호출 불가이므로 DuringRender 전용 함수 사용
  if (!cart.shipping_methods?.length && shippingMethods?.length) {
    await addCartShippingMethodDuringRender(cart.id, shippingMethods[0].id)
  }

  const [pointBalance, taxInvoice] = await Promise.all([
    getPointBalance(),
    getTaxInvoice(),
  ])

  // 배송료 정보
  const shippingMethod = shippingMethods?.[0]
  const shipping: ShippingInfo = {
    amount: shippingMethod?.amount ?? 0,
    name: shippingMethod?.name ?? "배송",
    description: shippingMethod?.type?.description ?? "",
  }

  return (
    <CheckoutTemplate
      user={currentUser}
      cart={cart}
      checkoutCartId={cart.id}
      shipping={shipping}
      promotions={promotionsResponse.promotions}
      pointBalance={pointBalance}
      taxInvoice={taxInvoice}
    />
  )
}
