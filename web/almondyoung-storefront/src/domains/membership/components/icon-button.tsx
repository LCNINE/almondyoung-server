"use client"

// components/common/IconTextButton.tsx
import { ChevronRight } from "lucide-react"
import clsx from "clsx"

interface IconTextButtonProps {
  label: string
  onClick?: () => void
  size?: "default" | "full" // 확장성 고려
}

export function IconTextButton({
  label,
  onClick,
  size = "default",
}: IconTextButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "text-foreground hover:bg-muted flex items-center justify-between gap-1 rounded-lg border border-border bg-white px-4 py-3.5 text-sm font-medium transition-colors",
        {
          "w-full": size === "full",
          "self-stretch": size === "full",
        }
      )}
    >
      <span>{label}</span>
      <ChevronRight className="text-muted-foreground h-4 w-4" aria-hidden="true" />
    </button>
  )
}
