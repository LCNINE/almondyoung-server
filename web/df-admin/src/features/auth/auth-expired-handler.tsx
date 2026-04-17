import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { SESSION_EXPIRED_EVENT } from "@/lib/api/client"
import { useAuth } from "./auth-context-internal"

export function AuthExpiredHandler() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setUnauthenticated } = useAuth()

  useEffect(() => {
    const handler = () => {
      setUnauthenticated()
      if (location.pathname === "/login") return
      const redirectTo = `${location.pathname}${location.search}`
      navigate(`/login?redirectTo=${encodeURIComponent(redirectTo)}`, {
        replace: true,
      })
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handler)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler)
  }, [navigate, location, setUnauthenticated])

  return null
}
