"use client"

import { Triangle } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import React from "react"
import { useTranslations } from "next-intl"
import { cn } from "@lib/utils"

const categoryOptions = [
  { id: "eyelash", labelKey: "eyelash" },
  { id: "nail", labelKey: "nail" },
  { id: "hair", labelKey: "hair" },
  { id: "waxing", labelKey: "waxing" },
] as const

const triggerFont = "font-['Pretendard'] text-xs"
const triggerColor = "text-[#ffa500]"
const triggerBorder = "border border-[#ffa500]"
const triggerBg = "bg-white"
const hoverBg = "hover:bg-orange-50"

export default function CategoryPillDropdown() {
  const t = useTranslations("category.pillDropdown")
  const [selectedId, setSelectedId] = React.useState<
    (typeof categoryOptions)[number]["id"]
  >(categoryOptions[0].id)

  const selectedKey =
    categoryOptions.find((opt) => opt.id === selectedId)?.labelKey ??
    categoryOptions[0].labelKey

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center justify-center gap-0.5",
            "rounded-full px-3.5 py-0.5",
            "transition-colors",
            triggerFont,
            triggerColor,
            triggerBorder,
            triggerBg,
            hoverBg
          )}
        >
          <span>{t(selectedKey)}</span>
          <Triangle
            className="h-2.5 w-2.5 rotate-180"
            fill="#FFA500"
            strokeWidth={0}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className={cn(
          "min-w-[var(--radix-dropdown-menu-trigger-width)]",
          triggerBorder,
          triggerBg
        )}
      >
        {categoryOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => setSelectedId(option.id)}
            className={cn(
              "focus:bg-orange-50",
              triggerFont,
              "text-black"
            )}
          >
            {t(option.labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
