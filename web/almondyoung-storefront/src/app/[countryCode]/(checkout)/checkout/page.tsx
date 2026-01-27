import { listCartShippingMethods, retrieveCart } from "@/lib/api/medusa/cart"
import { listCartPaymentMethods } from "@/lib/api/medusa/payment"
import { getMyPromotions } from "@/lib/api/medusa/promotion"
import {
  getBnplProfiles,
  getPointBalance,
  getTaxInvoice,
} from "@/lib/api/wallet"
import { CartResponseDto } from "@/lib/types/dto/medusa"
import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"
import { notFound } from "next/navigation"

export default async function CheckoutPage() {
  const currentUser = await fetchMe()
  const cart = (await retrieveCart()) as CartResponseDto["cart"]

  if (!cart) {
    return notFound()
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

  const profiles = await getBnplProfiles()

  console.log("cart::", cart)

  return (
    <ProtectedRoute>
      <CheckoutTemplate
        user={currentUser}
        cart={cart}
        shippingFee={shippingMethods?.[0]?.amount ?? 0}
        promotions={promotionsResponse.promotions}
        pointBalance={pointBalance}
        taxInvoice={taxInvoice}
      />
    </ProtectedRoute>
  )
}
