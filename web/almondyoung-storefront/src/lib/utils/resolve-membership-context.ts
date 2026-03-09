import { getCurrentSubscription } from "@/lib/api/membership"
import { isMembershipGroup } from "@/lib/utils/membership-group"

export type MembershipTier = {
  code: string
  name: string | null
  priorityLevel: number
}

export type MembershipResolvedContext = {
  status: "guest" | "regular" | "membership"
  isMembershipPricing: boolean
  tier?: MembershipTier
}

export async function resolveMembershipContext({
  isLoggedIn,
  customerGroupsFromCart,
  customerGroupsFromCustomer,
}: {
  isLoggedIn: boolean
  customerGroupsFromCart?: { id?: string | null }[] | null
  customerGroupsFromCustomer?: { id?: string | null }[] | null
}): Promise<MembershipResolvedContext> {
  if (!isLoggedIn) {
    return { status: "guest", isMembershipPricing: false }
  }

  const isMembershipPricing =
    isMembershipGroup(customerGroupsFromCart) ||
    isMembershipGroup(customerGroupsFromCustomer)
  const status = isMembershipPricing ? "membership" : "regular"

  try {
    const subscription = await getCurrentSubscription().catch(() => null)
    if (subscription?.status === "ACTIVE" && subscription?.tier) {
      return {
        status,
        isMembershipPricing,
        tier: {
          code: subscription.tier.code,
          name: subscription.tier.name,
          priorityLevel: subscription.tier.priorityLevel,
        },
      }
    }
    return { status, isMembershipPricing }
  } catch {
    return { status, isMembershipPricing }
  }
}
