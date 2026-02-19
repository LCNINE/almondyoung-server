"use client"

import { HttpTypes } from "@medusajs/types"
import type { CustomerGroupRef } from "@/lib/utils/membership-group"
import { createContext, useContext } from "react"

type StoreCartWithCustomerGroups = HttpTypes.StoreCart & {
  customer?: {
    groups?: CustomerGroupRef[]
  }
}

interface CartContextType {
  cart: StoreCartWithCustomerGroups | null
  itemCount: number
}

const CartContext = createContext<CartContextType>({
  cart: null,
  itemCount: 0,
})

export function CartProvider({
  children,
  initialCart,
}: {
  children: React.ReactNode
  initialCart: StoreCartWithCustomerGroups | null
}) {
  const itemCount =
    initialCart?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0

  return (
    <CartContext.Provider value={{ cart: initialCart, itemCount }}>
      {children}
    </CartContext.Provider>
  )
}

export const useCart = () => useContext(CartContext)
