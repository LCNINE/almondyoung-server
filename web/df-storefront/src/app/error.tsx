"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

const getCountryCode = (pathname: string) => {
  const segment = pathname.split("/")[1]
  return segment || "kr"
}

const normalizeRedirectPath = (pathname: string) => {
  const normalized = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "")
  return normalized || "/"
}

export default function Error({
  error,
}: {
  error: Error & { digest?: string }
}) {
  const pathname = usePathname()
  const hasTriedRef = useRef(false)

  useEffect(() => {
    if (hasTriedRef.current) {
      return
    }

    hasTriedRef.current = true

    const restoreToken = async () => {
      if (
        error.digest !== "UNAUTHORIZED" &&
        error.message !== "UNAUTHORIZED"
      ) {
        return
      }

      const countryCode = getCountryCode(pathname)
      const redirectTo = encodeURIComponent(normalizeRedirectPath(pathname))

      try {
        const response = await fetch("/api/auth/restore-token", {
          method: "POST",
          credentials: "include",
        })

        if (response.ok) {
          window.location.reload()
          return
        }
      } catch {}

      window.location.href = `/${countryCode}/account?redirect_to=${redirectTo}`
    }

    restoreToken()
  }, [error, pathname])

  if (error.digest === "UNAUTHORIZED" || error.message === "UNAUTHORIZED") {
    return <div className="min-h-screen" />
  }

  return (
    <div className="content-container py-16">
      <h1 className="text-2xl font-medium">Something went wrong</h1>
      <p className="mt-4 text-ui-fg-subtle">
        Please refresh the page and try again.
      </p>
    </div>
  )
}
