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
        "flex items-center justify-center gap-1 rounded-[5px] border border-zinc-400 bg-white py-3 pr-3 pl-4 font-['Noto_Sans_KR'] text-sm leading-5 font-normal text-zinc-800 transition hover:bg-zinc-50 active:bg-zinc-100",
        {
          "w-full": size === "full",
          "self-stretch": size === "full",
        }
      )}
    >
      <span>{label}</span>
      <ChevronRight className="h-5 w-5 text-gray-400" aria-hidden="true" />
    </button>
  )
}
