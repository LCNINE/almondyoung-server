import { NextResponse } from "next/server"
import { retrieveCart } from "@/lib/api/medusa/cart"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import {
  getMembershipGroupIdFromEnv,
  isMembershipGroup,
} from "@/lib/utils/membership-group"

export async function GET() {
  const [cart, customer] = await Promise.all([
    retrieveCart(undefined, undefined, "no-store").catch(() => null),
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

  return NextResponse.json({
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
  })
}
