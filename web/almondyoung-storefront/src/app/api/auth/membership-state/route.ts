import { NextResponse } from "next/server"
import { retrieveCart } from "@/lib/api/medusa/cart"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { fetchMe } from "@/lib/api/users/me"
import { resolveMembershipContext } from "@/lib/utils/resolve-membership-context"
import type { CustomerGroupRef } from "@/lib/utils/membership-group"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const [user, cart, customer] = await Promise.all([
    fetchMe().catch(() => null),
    retrieveCart(undefined, undefined, "no-store").catch(() => null),
    retrieveCustomer().catch(() => null),
  ])

  const cartWithCustomer = cart as
    | (typeof cart & {
        customer_id?: string | null
        customer?: { groups?: CustomerGroupRef[] }
      })
    | null

  const membership = await resolveMembershipContext({
    isLoggedIn: !!user,
    customerGroupsFromCart: cartWithCustomer?.customer?.groups,
    customerGroupsFromCustomer: customer?.groups,
  })

  return NextResponse.json(membership, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
