import { listCartShippingMethods, retrieveCart } from "@/lib/api/medusa/cart"
import { listCartPaymentMethods } from "@/lib/api/medusa/payment"
import { getMyPromotions } from "@/lib/api/medusa/promotion"
import { getPointBalance, getTaxInvoice } from "@/lib/api/wallet"
import { CartResponseDto } from "@/lib/types/dto/medusa"
import type { ShippingInfo } from "@/lib/types/ui/cart"
import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"
import { notFound } from "next/navigation"
import { EmptyCartView } from "@/components/cart/empty-cart-view"

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const currentUser = await fetchMe()
  const cart = (await retrieveCart()) as CartResponseDto["cart"]

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
    <ProtectedRoute>
      <CheckoutTemplate
        user={currentUser}
        cart={cart}
        shipping={shipping}
        promotions={promotionsResponse.promotions}
        pointBalance={pointBalance}
        taxInvoice={taxInvoice}
      />
    </ProtectedRoute>
  )
}
