"use client"

import { Button } from "@/components/ui/button"
import { CustomButton } from "@/components/shared/custom-buttons"
import {
  dismissInterestBanner7Days,
  updateInterestCategories,
} from "@/domains/home/interest-categories-actions"
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
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 md:p-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 md:text-lg">
          {t("title")}
        </h3>
        <p className="text-xs text-zinc-500 md:text-sm">
          {t("description")}
        </p>
      </div>

      <InterestKeyChips
        selectedKeys={selected}
        onChange={setSelected}
        disabled={isPending}
        className="mt-4"
      />

      <div className="mt-5 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={isPending}
          className="text-xs text-zinc-500 hover:text-zinc-700"
        >
          {t("dismiss")}
        </Button>
        <CustomButton
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isPending || selected.length === 0}
          className="rounded-full"
        >
          {isPending ? t("saving") : t("save")}
        </CustomButton>
      </div>
    </section>
  )
}
