"use client"

import { useMembership } from "@/contexts/membership-context"

export const useMembershipPricing = () => {
  const { isMembershipPricing } = useMembership()

  return { isMembershipPricing }
}
