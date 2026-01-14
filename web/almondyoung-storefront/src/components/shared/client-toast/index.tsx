"use client"

import { useEffect } from "react"
import { toast } from "sonner"

export default function ClientToast({
  message,
  type = "error",
}: {
  message: string | null
  type?: "error" | "success" | "info"
}) {
  useEffect(() => {
    setTimeout(() => {
      if (message) {
        toast[type](message)
      }
    }, 1000)
  }, [message, type])

  return null
}
