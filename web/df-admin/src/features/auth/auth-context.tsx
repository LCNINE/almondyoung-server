import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { authApi, type MeResponse } from "@/lib/api/auth"
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from "./auth-context-internal"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [user, setUser] = useState<MeResponse | null>(null)

  const refetchMe = useCallback(async () => {
    try {
      const me = await authApi.fetchMe()
      setUser(me)
      setStatus("authenticated")
    } catch {
      setUser(null)
      setStatus("unauthenticated")
    }
  }, [])

  const setUnauthenticated = useCallback(() => {
    setUser(null)
    setStatus("unauthenticated")
  }, [])

  const signOut = useCallback(async () => {
    try {
      await authApi.signout()
    } finally {
      setUser(null)
      setStatus("unauthenticated")
    }
  }, [])

  useEffect(() => {
    void refetchMe()
  }, [refetchMe])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, refetchMe, setUnauthenticated, signOut }),
    [status, user, refetchMe, setUnauthenticated, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
