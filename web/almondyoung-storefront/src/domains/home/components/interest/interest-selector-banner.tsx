"use client"

import { Button } from "@/components/ui/button"
import { CustomButton } from "@/components/shared/custom-buttons"
import {
  dismissInterestBanner7Days,
  updateInterestCategories,
} from "@/domains/home/interest-categories-actions"
import {
  INTEREST_CANDIDATE_CATEGORIES,
  MAX_INTEREST_CATEGORIES,
} from "@/lib/constants/categories"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { InterestKeyChips } from "./interest-key-chips"

export function InterestSelectorBanner() {
  const t = useTranslations("home.interestBanner")
  const tCat = useTranslations("categories")
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
    : t("save", { count: selected.length })

  const selectedNames = INTEREST_CANDIDATE_CATEGORIES.filter((cat) =>
    selected.includes(cat.key)
  )
    .map((cat) => tCat(cat.key as "lash-perm"))
    .join(", ")

  return (
    <section aria-labelledby="interest-selector-title">
      <div className="mb-5 flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
        <div>
          <h2
            id="interest-selector-title"
            className="text-foreground text-xl font-bold tracking-[-0.03em] break-keep md:text-[22px]"
          >
            {t("title")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm break-keep">
            {t("description", { max: MAX_INTEREST_CATEGORIES })}
          </p>
        </div>

        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={handleDismiss}
          disabled={isPending}
          className="text-muted-foreground hover:text-foreground h-auto shrink-0 p-0 text-[13px] font-normal underline underline-offset-4"
        >
          {t("dismiss")}
        </Button>
      </div>

      <InterestKeyChips
        variant="card"
        selectedKeys={selected}
        onChange={setSelected}
        disabled={isPending}
      />

      <div className="mt-7">
        {selected.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-[14px] border border-dashed bg-white p-7 text-center text-sm">
            {t("selectPrompt")}
          </p>
        ) : (
          <div className="flex flex-col items-stretch gap-3 rounded-[14px] bg-white p-5 md:flex-row md:items-center md:justify-between">
            <p className="text-foreground text-[15px] font-bold break-keep">
              {t("previewSelected", { names: selectedNames })}
            </p>
            <CustomButton
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="h-11 w-full rounded-xl px-6 text-sm font-bold whitespace-nowrap md:w-auto md:min-w-[180px]"
            >
              {saveLabel}
            </CustomButton>
          </div>
        )}
      </div>
    </section>
  )
}
