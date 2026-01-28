"use client"

import { createContext, useContext } from "react"

export type MembershipStatus = "guest" | "regular" | "membership"

export interface MembershipTier {
  code: string
  name: string | null
  priorityLevel: number
}

export interface MembershipContextType {
  status: MembershipStatus
  tier?: MembershipTier
}

const MembershipContext = createContext<MembershipContextType>({
  status: "guest",
})

export function MembershipProvider({
  children,
  initialMembership,
}: {
  children: React.ReactNode
  initialMembership: MembershipContextType
}) {
  return (
    <MembershipContext.Provider value={initialMembership}>
      {children}
    </MembershipContext.Provider>
  )
}

export const useMembership = () => useContext(MembershipContext)
