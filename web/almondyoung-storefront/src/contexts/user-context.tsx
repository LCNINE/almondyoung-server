"use client"

import type { UserDetail } from "@lib/types/ui/user"
import { createContext, useContext, useEffect, useState } from "react"

const UserContext = createContext<{
  user: UserDetail | null
  setUser: (user: UserDetail | null) => void
} | null>(null)

export function UserProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode
  initialUser: UserDetail | null
}) {
  const [user, setUser] = useState<UserDetail | null>(initialUser)

  useEffect(() => {
    setUser(initialUser)
  }, [initialUser])

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  )
}

export const useUser = () => {
  const context = useContext(UserContext)
  if (!context) throw new Error("useUser must be used within UserProvider")
  return context
}
