"use client"

import type { BenefitItem } from "./benefit.types"

interface BenefitListItemProps {
  benefit: BenefitItem
  onClick?: () => void
}

export default function BenefitListItem({
  benefit,
  onClick,
}: BenefitListItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg bg-zinc-800 p-4 text-left transition-colors hover:bg-zinc-700"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-700">
          <span className="text-sm font-bold text-[#f29219]">
            {benefit.number}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-white">
            {benefit.title}
          </span>
          <span className="break-words text-xs text-white/60">
            {benefit.description}
          </span>
        </div>
      </div>
    </button>
  )
}
