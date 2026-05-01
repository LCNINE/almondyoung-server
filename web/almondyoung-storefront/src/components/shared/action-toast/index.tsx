"use client"

import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"

type ActionToastVariant = "default" | "active"

type ShowActionToastOptions = {
  icon: ReactNode
  label: string
  variant?: ActionToastVariant
  duration?: number
}

const EXIT_DURATION = 300
let currentToastId: string | number | undefined

function ActionToastContent({
  icon,
  label,
  variant,
  duration,
}: {
  icon: ReactNode
  label: string
  variant: ActionToastVariant
  duration: number
}) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const exitDelay = Math.max(duration - EXIT_DURATION, 0)
    const timer = setTimeout(() => setExiting(true), exitDelay)
    return () => clearTimeout(timer)
  }, [duration])

  if (typeof document === "undefined") return null

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className={cn(
          "flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-full text-white shadow-lg",
          exiting
            ? "animate-out fade-out zoom-out-95 duration-300"
            : "animate-in fade-in zoom-in-95 duration-200",
          variant === "active" ? "bg-primary/90" : "bg-neutral-500/85"
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center">{icon}</div>
        <span className="text-sm font-semibold tracking-tight">{label}</span>
      </div>
    </div>,
    document.body
  )
}

export function showActionToast({
  icon,
  label,
  variant = "active",
  duration = 1800,
}: ShowActionToastOptions) {
  if (currentToastId !== undefined) {
    toast.dismiss(currentToastId)
  }

  const id = toast.custom(
    () => (
      <ActionToastContent
        icon={icon}
        label={label}
        variant={variant}
        duration={duration}
      />
    ),
    {
      duration,
      unstyled: true,
      onAutoClose: () => {
        if (currentToastId === id) currentToastId = undefined
      },
      onDismiss: () => {
        if (currentToastId === id) currentToastId = undefined
      },
    }
  )

  currentToastId = id
  return id
}
