"use client"

import { cn } from "@lib/utils"
import { ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"
import type { ButtonHTMLAttributes } from "react"

type BackButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  fallbackHref: string
  label?: string
  showLabel?: boolean
  iconClassName?: string
}

export function BackButton({
  fallbackHref,
  label = "뒤로가기",
  showLabel = false,
  className,
  iconClassName,
  onClick,
  children,
  ...props
}: BackButtonProps) {
  const router = useRouter()

  const handleClick: ButtonHTMLAttributes<HTMLButtonElement>["onClick"] = (
    event
  ) => {
    onClick?.(event)
    if (event.defaultPrevented) return

    const referrer = document.referrer
    const hasSameOriginReferrer =
      referrer &&
      (() => {
        try {
          return new URL(referrer).origin === window.location.origin
        } catch {
          return false
        }
      })()

    if (hasSameOriginReferrer || (!referrer && window.history.length > 1)) {
      router.back()
      return
    }

    router.push(fallbackHref)
  }

  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 text-gray-900 transition-colors hover:text-black",
        showLabel ? "px-1.5 text-sm font-medium" : "w-9",
        className
      )}
      onClick={handleClick}
      {...props}
    >
      {children ?? (
        <>
          <ArrowLeft className={cn("h-5 w-5", iconClassName)} />
          {showLabel && <span>{label}</span>}
        </>
      )}
    </button>
  )
}
