import { NextResponse } from "next/server"
import { retrieveCart } from "@/lib/api/medusa/cart"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import {
  getMembershipGroupIdFromEnv,
  isMembershipGroup,
} from "@/lib/utils/membership-group"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const cartIdParam = url.searchParams.get("cartId") || undefined

  const [cart, customer] = await Promise.all([
    retrieveCart(cartIdParam, undefined, "no-store").catch(() => null),
    retrieveCustomer().catch(() => null),
  ])

  const membershipGroupId = getMembershipGroupIdFromEnv()
  const cartWithCustomer = cart as
    | (typeof cart & {
        customer_id?: string | null
        customer?: { groups?: { id?: string | null }[] }
      })
    | null
  const cartGroupIds =
    cartWithCustomer?.customer?.groups
      ?.map((group) => group?.id)
      .filter((id): id is string => !!id) ?? []
  const customerGroupIds =
    (customer as { groups?: { id?: string | null }[] } | null)?.groups
      ?.map((group) => group?.id)
      .filter((id): id is string => !!id) ?? []
  const itemPricing =
    cart?.items?.map((item) => ({
      line_item_id: item.id,
      variant_id: item.variant_id ?? null,
      quantity: item.quantity,
      compare_at_unit_price: item.compare_at_unit_price ?? null,
      unit_price: item.unit_price ?? null,
      total: item.total ?? null,
      original_total: item.original_total ?? null,
    })) ?? []

  return NextResponse.json({
    requestedCartId: cartIdParam ?? null,
    membershipGroupId,
    cartId: cart?.id ?? null,
    cartCustomerId: cartWithCustomer?.customer_id ?? null,
    cartGroupIds,
    customerId: customer?.id ?? null,
    customerGroupIds,
    isMembershipFromCart: isMembershipGroup(cartWithCustomer?.customer?.groups),
    isMembershipFromCustomer: isMembershipGroup(
      (customer as { groups?: { id?: string | null }[] } | null)?.groups
    ),
    itemPricing,
  })
}
