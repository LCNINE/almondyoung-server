"use client"

import {
  InsightQuestions,
  type InsightQuestion,
} from "../components/insight-questions"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import { AreaView } from "./area-view"
import { ShopTeaser } from "./shop-teaser"
import { UnlockDrawer } from "./unlock-drawer"

/** What visitors without membership see: the whole neighbourhood, and a question mark where their shop's answer is. */
export function BeautyTopPreview({
  signedIn,
  loginHref,
  membershipHref,
}: {
  signedIn: boolean
  loginHref: string
  membershipHref?: string
}) {
  const locale = useLocale()
  const t = useTranslations("beautytop.unlock")
  const [mine, setMine] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState<InsightQuestion>("reviews")

  return (
    <div
      lang={locale}
      className="motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:duration-0 [&:lang(ja)_.break-keep]:break-normal"
    >
      <div className="mt-6 pb-8">
        <InsightQuestions
          onQuestionChange={setQuestion}
          onExplore={(next) => {
            setQuestion(next)
            setOpen(true)
          }}
        />
        <section className="border-border mt-8 flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <h2 className="text-lg font-bold">{t("everyoneTitle")}</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-5">
              {t("everyoneBody")}
            </p>
          </div>
          <span className="bg-background shrink-0 rounded-full px-3 py-2 text-xs font-medium">
            {t("publicLabel")}
          </span>
        </section>
        <AreaView
          mineLabel={mine}
          shopSlot={(filters) => (
            <ShopTeaser
              key={`${filters.sido}:${filters.gugun}`}
              area={filters}
              signedIn={signedIn}
              loginHref={loginHref}
              onPick={(shop) => setMine(shop?.name ?? null)}
            />
          )}
        />
      </div>
      {/* Above the fixed mobile bottom navigation (h-16 + safe area); that bar is hidden from xl up. */}
      <div className="border-border bg-background sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t px-4 pt-3 pb-4 xl:bottom-0">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">{t("stickyLabel")}</span>
          <span className="font-medium">{t(`sticky.${question}`)}</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-primary hover:bg-primary/90 h-[52px] w-full rounded-xl text-base font-bold text-white transition-colors duration-150"
        >
          {t("membershipCta")}
        </button>
      </div>
      <UnlockDrawer
        question={question}
        open={open}
        onOpenChange={setOpen}
        signedIn={signedIn}
        loginHref={membershipHref ?? loginHref}
      />
    </div>
  )
}
