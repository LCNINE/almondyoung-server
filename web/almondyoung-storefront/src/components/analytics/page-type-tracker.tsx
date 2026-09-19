"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

import { trackEvent } from "@/lib/analytics/gtag"
import { pageTypeEvent } from "@/lib/analytics/page-type"

export function PageTypeTracker() {
  const pathname = usePathname()

  useEffect(() => {
    const event = pageTypeEvent(pathname)
    if (event) trackEvent(event, { page_path: pathname })
  }, [pathname])

  return null
}
