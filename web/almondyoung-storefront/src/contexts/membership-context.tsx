"use client"

import { createContext, useContext, useMemo, useState } from "react"

export type MembershipStatus = "guest" | "regular" | "membership"

export interface MembershipTier {
  code: string
  name: string | null
  priorityLevel: number
}

export interface MembershipContextType {
  status: MembershipStatus
  isMembershipPricing: boolean
  tier?: MembershipTier
  setMembership?: (next: MembershipContextType) => void
}

const MembershipContext = createContext<MembershipContextType>({
  status: "guest",
  isMembershipPricing: false,
})

export function MembershipProvider({
  children,
  initialMembership,
}: {
  children: React.ReactNode
  initialMembership: MembershipContextType
}) {
  const [membership, setMembership] = useState<MembershipContextType>(
    initialMembership
  )

  const value = useMemo(
    () => ({
      ...membership,
      setMembership,
    }),
    [membership]
  )

  return (
    <MembershipContext.Provider value={value}>
      {children}
    </MembershipContext.Provider>
  )
}

export const useMembership = () => useContext(MembershipContext)
