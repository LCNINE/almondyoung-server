import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"

export default async function CheckoutPage() {
  const currentUser = await fetchMe()

  return (
    <ProtectedRoute>
      <CheckoutTemplate user={currentUser} />
    </ProtectedRoute>
  )
}
