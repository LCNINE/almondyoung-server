"use client"

import type { ShippingGroup } from "@/lib/api/medusa/shipping-group-types"
import { createContext, useContext } from "react"

const ShippingGroupsContext = createContext<ShippingGroup[]>([])

export function ShippingGroupsProvider({
  children,
  groups,
}: {
  children: React.ReactNode
  groups: ShippingGroup[]
}) {
  return (
    <ShippingGroupsContext.Provider value={groups}>
      {children}
    </ShippingGroupsContext.Provider>
  )
}

export const useShippingGroups = () => useContext(ShippingGroupsContext)
