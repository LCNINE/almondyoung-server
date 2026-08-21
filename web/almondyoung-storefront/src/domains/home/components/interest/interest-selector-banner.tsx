"use client"

import { Button } from "@/components/ui/button"
import { CustomButton } from "@/components/shared/custom-buttons"
import {
  dismissInterestBanner7Days,
  updateInterestCategories,
} from "@/domains/home/interest-categories-actions"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { InterestKeyChips } from "./interest-key-chips"

export function InterestSelectorBanner() {
  const t = useTranslations("home.interestBanner")
  const [selected, setSelected] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    if (selected.length === 0) {
      toast.message(t("needAtLeastOne"))
      return
    }

    startTransition(async () => {
      try {
        await updateInterestCategories(selected)
        toast.success(t("saved"))
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("saveFail"))
      }
    })
  }

  const handleDismiss = () => {
    startTransition(async () => {
      try {
        await dismissInterestBanner7Days()
      } catch {
        toast.error(t("dismissFail"))
      }
    })
  }

  return (
    <section className="relative flex flex-col gap-5 text-center md:gap-7 lg:flex-row lg:items-center lg:gap-12 lg:text-left">
      {/* 모바일 — 우상단 닫기 */}
      <DismissButton
        onClick={handleDismiss}
        disabled={isPending}
        label={t("dismiss")}
        className="absolute top-0 right-0 lg:hidden"
      />

      <div className="shrink-0 space-y-1 lg:max-w-[280px]">
        <h3 className="text-foreground text-base font-bold tracking-tight md:text-lg">
          {t("title")}
        </h3>
        <p className="text-muted-foreground text-xs md:text-sm">
          {t("description")}
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center gap-5 md:gap-7 lg:flex-row lg:justify-between lg:gap-6">
        <InterestKeyChips
          selectedKeys={selected}
          onChange={setSelected}
          disabled={isPending}
          className="w-full justify-center lg:w-auto [&_button]:shadow-[1px_1px_0.5px_rgba(0,0,0,0.1)]"
        />

        <div className="flex w-full shrink-0 flex-col items-center gap-1 lg:w-auto lg:items-end">
          {/* 데스크톱 — 저장 버튼 위 닫기 */}
          <DismissButton
            onClick={handleDismiss}
            disabled={isPending}
            label={t("dismiss")}
            className="hidden lg:inline-flex"
          />
          <CustomButton
            type="button"
            onClick={handleSave}
            disabled={isPending || selected.length === 0}
            className="disabled:text-gray-30 h-[52px] w-full max-w-[320px] rounded-xl text-base font-bold disabled:bg-secondary disabled:opacity-100 lg:h-[48px] lg:w-auto lg:px-10"
          >
            {isPending ? t("saving") : t("save")}
          </CustomButton>
        </div>
      </div>
    </section>
  )
}

function DismissButton({
  onClick,
  disabled,
  label,
  className,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "text-foreground/40 hover:text-foreground size-7 hover:bg-transparent",
        className
      )}
    >
      <X className="size-[18px]" />
    </Button>
  )
}
