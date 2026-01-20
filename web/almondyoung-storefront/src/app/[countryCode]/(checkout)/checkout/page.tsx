import { retrieveCart } from "@/lib/api/medusa/cart"
import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import { StoreCart } from "@medusajs/types"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"

export default async function CheckoutPage() {
  const currentUser = await fetchMe()
  const storeCart: StoreCart | null = await retrieveCart()

  return (
    <ProtectedRoute>
      <CheckoutTemplate user={currentUser} storeCart={storeCart} />
    </ProtectedRoute>
  )
}
