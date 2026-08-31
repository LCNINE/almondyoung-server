"use client"

import { Button } from "@/components/ui/button"
import { CustomButton } from "@/components/shared/custom-buttons"
import {
  dismissInterestBanner7Days,
  updateInterestCategories,
} from "@/domains/home/interest-categories-actions"
import { MAX_INTEREST_CATEGORIES } from "@/lib/constants/categories"
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
        toast.success(t("saved", { count: selected.length }))
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

  const saveLabel = isPending
    ? t("saving")
    : selected.length === 0
      ? t("selectPrompt")
      : t("save", { count: selected.length })

  return (
    <section className="flex flex-col gap-4 text-center lg:flex-row lg:items-center lg:gap-8 lg:text-left">
      <div className="shrink-0 space-y-1 lg:max-w-[280px]">
        <h3 className="text-foreground text-base font-bold tracking-tight break-keep md:text-lg">
          {t("title")}
        </h3>
        <p className="text-muted-foreground text-xs break-keep md:text-sm">
          {t("description", { max: MAX_INTEREST_CATEGORIES })}
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center gap-3 lg:items-end">
        <InterestKeyChips
          selectedKeys={selected}
          onChange={setSelected}
          disabled={isPending}
          className="flex w-full flex-wrap justify-center gap-1.5 lg:w-auto lg:justify-end [&_button]:gap-1 [&_button]:px-2 [&_button]:text-xs [&_button]:shadow-[1px_1px_0.5px_rgba(0,0,0,0.1)] [&_img]:size-4"
        />

        <div className="flex w-full flex-col-reverse items-center gap-2 lg:w-auto lg:flex-row lg:gap-4">
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={handleDismiss}
            disabled={isPending}
            className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs font-normal"
          >
            {t("dismiss")}
          </Button>

          <CustomButton
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="disabled:text-muted-foreground disabled:bg-secondary h-10 w-full max-w-[280px] rounded-xl text-sm font-bold whitespace-nowrap disabled:opacity-100 lg:w-auto lg:min-w-[180px] lg:px-6"
          >
            {saveLabel}
          </CustomButton>
        </div>
      </div>
    </section>
  )
}
