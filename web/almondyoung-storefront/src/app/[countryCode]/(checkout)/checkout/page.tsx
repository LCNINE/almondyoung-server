import { EmptyCartView } from "@/components/cart/empty-cart-view"
import {
  ensureCorrectShippingMethod,
  retrieveCart,
} from "@/lib/api/medusa/cart"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getMyPromotions } from "@/lib/api/medusa/promotion"
import { getPointBalance } from "@/lib/api/wallet"
import { CartResponseDto } from "@/lib/types/dto/medusa"
import type { ShippingInfo } from "@/lib/types/ui/cart"
import { getMembershipGroupIdFromEnv } from "@/lib/utils/membership-group"
import ProtectedRoute from "@components/protected-route"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"
import { notFound } from "next/navigation"

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ cartId?: string }>
}) {
  const { cartId } = await searchParams

  return (
    <ProtectedRoute>
      <CheckoutManager cartId={cartId} />
    </ProtectedRoute>
  )
}

async function CheckoutManager({ cartId }: { cartId?: string }) {
  let cart = (await retrieveCart(
    cartId,
    "*items, *items.product, *items.product.tags, *items.variant, *region, *customer, *shipping_methods, +item_subtotal, +shipping_total, +total, +payment_collection.id, +currency_code",
    "no-store"
  )) as CartResponseDto["cart"]

  if (!cart) {
    return notFound()
  }

  if (!cart.items?.length) {
    return (
      <ProtectedRoute>
        <EmptyCartView />
      </ProtectedRoute>
    )
  }

  // 장바구니 아이템 타입에 따라 올바른 배송 옵션 자동 설정
  const { cart: updatedCart, shippingMethods } =
    await ensureCorrectShippingMethod(cart)
  cart = updatedCart as CartResponseDto["cart"]

  const promotionsResponse = await getMyPromotions({ limit: 100 }).catch(
    () => ({
      promotions: [],
      count: 0,
      offset: 0,
      limit: 100,
    })
  )

  const [pointBalance] = await Promise.all([getPointBalance()])

  // 배송료 정보
  const shippingMethod = shippingMethods?.[0]
  const shipping: ShippingInfo = {
    amount: shippingMethod?.amount ?? 0,
    name: shippingMethod?.name ?? "배송",
    description: shippingMethod?.type?.description ?? "",
  }

  const customer = await retrieveCustomer()

  return (
    <CheckoutTemplate
      isMembership={
        !!customer?.groups?.some(
          (group) => group.id === getMembershipGroupIdFromEnv()
        )
      }
      cart={cart}
      checkoutCartId={cart.id}
      shipping={shipping}
      promotions={promotionsResponse.promotions}
      pointBalance={pointBalance}
    />
  )
}
