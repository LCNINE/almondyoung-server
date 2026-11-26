"use client"

import { useEffect } from "react"

import { trackEvent } from "@/lib/analytics/gtag"

export function TemplateViewTracker({
  id,
  name,
}: {
  id: string
  name: string
}) {
  useEffect(() => {
    trackEvent("view_template_design", { template_id: id, template_name: name })
  }, [id, name])

  return null
}
