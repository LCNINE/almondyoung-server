import { retrieveCart } from "@/lib/api/medusa/cart"
import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import { StoreCart } from "@medusajs/types"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"
import { redirect } from "next/navigation"

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const currentUser = await fetchMe()
  const storeCart: StoreCart | null = await retrieveCart()

  // cart가 없거나 비어있으면 장바구니로 리다이렉트
  // if (!storeCart || !storeCart.items?.length) {
  //   redirect(`/${countryCode}/cart`)
  // }

  return (
    <ProtectedRoute>
      <CheckoutTemplate user={currentUser} storeCart={storeCart} />
    </ProtectedRoute>
  )
}
