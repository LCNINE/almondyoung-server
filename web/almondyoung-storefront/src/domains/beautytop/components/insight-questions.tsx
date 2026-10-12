"use client"

import { useId, useState } from "react"
import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  ScanLine,
  SlidersHorizontal,
  LockKeyhole,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

export const INSIGHT_QUESTIONS = ["reviews", "followers", "price"] as const
export type InsightQuestion = (typeof INSIGHT_QUESTIONS)[number]
const ICONS = {
  reviews: ChartNoAxesColumnIncreasing,
  followers: ScanLine,
  price: SlidersHorizontal,
}

/** Selecting a question previews capabilities only; it never fetches member data. */
export function InsightQuestions({
  member = false,
  onExplore,
  onQuestionChange,
}: {
  member?: boolean
  onExplore: (question: InsightQuestion) => void
  onQuestionChange?: (question: InsightQuestion) => void
}) {
  const t = useTranslations("beautytop.insights")
  const id = useId()
  const [question, setQuestion] = useState<InsightQuestion>("reviews")
  const Icon = ICONS[question]
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="border-border bg-background overflow-hidden rounded-2xl border"
    >
      <div className="px-4 pt-6 sm:px-6">
        <p className="text-muted-foreground mb-2 text-xs font-medium">
          {t(member ? "memberEyebrow" : "eyebrow")}
        </p>
        <h2
          id={`${id}-title`}
          className="text-[26px] leading-[35px] font-bold break-normal"
        >
          {t("title")}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-5">
          {t("subtitle")}
        </p>
        <div
          className="mt-6 grid grid-cols-3 gap-2"
          role="group"
          aria-label={t("pick")}
        >
          {INSIGHT_QUESTIONS.map((key) => {
            const ItemIcon = ICONS[key]
            return (
              <Button
                key={key}
                variant="ghost"
                aria-pressed={question === key}
                aria-controls={`${id}-answer`}
                onClick={() => {
                  setQuestion(key)
                  onQuestionChange?.(key)
                }}
                className={cn(
                  "h-auto min-h-16 flex-col gap-2 rounded-xl px-2 py-3 text-xs whitespace-normal sm:text-sm",
                  question === key
                    ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
                    : "bg-muted text-foreground hover:bg-secondary"
                )}
              >
                <ItemIcon aria-hidden className="h-5 w-5 shrink-0" />
                {t(`${key}.label`)}
              </Button>
            )
          })}
        </div>
      </div>
      <div id={`${id}-answer`} className="p-4 sm:p-6">
        <div className="bg-muted rounded-xl p-4">
          <div className="text-muted-foreground mb-4 flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2">
              <Icon aria-hidden className="h-4 w-4" />
              {t(`${question}.scope`)}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {!member && <LockKeyhole aria-hidden className="h-3 w-3" />}
              {t(member ? "included" : "memberLabel")}
            </span>
          </div>
          <div aria-live="polite" aria-atomic="true">
            <h3 className="text-xl leading-7 font-bold">
              {t(`${question}.question`)}
            </h3>
            <p className="text-muted-foreground mt-2 text-sm leading-5">
              {t(`${question}.why`)}
            </p>
          </div>
          <ul className="border-border mt-4 space-y-3 border-t pt-4 text-sm">
            {(["first", "second"] as const).map((key) => (
              <li key={key} className="flex gap-2">
                <span aria-hidden className="text-muted-foreground">
                  ↗
                </span>
                <span>{t(`${question}.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <Button
          variant={member ? "default" : "outline"}
          onClick={() => onExplore(question)}
          className="mt-4 h-[52px] w-full justify-between rounded-xl px-4 text-left text-base font-bold whitespace-normal"
        >
          <span>{t(member ? `${question}.action` : "previewAction")}</span>
          <ArrowRight aria-hidden className="ml-2 h-4 w-4 shrink-0" />
        </Button>
        {!member && (
          <p className="text-muted-foreground mt-3 text-xs leading-5">
            {t("previewNote")}
          </p>
        )}
      </div>
    </section>
  )
}
