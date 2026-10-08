"use client"

import { useUser } from "@/contexts/user-context"
import type { GrowthAction } from "@/lib/types/ui/beautytop-growth"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { InsightQuestions, type InsightQuestion } from "./insight-questions"
import { Button } from "@/components/ui/button"
import { useLocale, useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { AreaView } from "../area/area-view"
import { PremiumGate } from "../area/premium-gate"
import { MembershipReceipt } from "../area/membership-receipt"
import { PriceSimulator } from "../area/price-simulator"
import type { BeautyTopOptions, BeautyTopTarget } from "../types"
import { useArea } from "../use-area"
import { useMyShop } from "../use-watchlist"
import { FranchiseTab } from "./franchise-tab"
import { MyShopTab, WatchTab } from "./my-shop-tab"
import { CardSkeleton, LoadError } from "./parts"
import { ShopSheet } from "./shop-sheet"
import { ShopsTab } from "./shops-tab"
import { setScopeFilters } from "../use-scope"
import { PriceCalculator } from "../growth/price-calculator"
import { GrowthNotes } from "../growth/growth-notes"

const TAB_KEY = "beautytop:tab:v2"
const TABS = ["neighborhood", "discovery", "myShop", "brand"] as const

type Tab = (typeof TABS)[number]

function Rankings({
  onSelectShop,
  onFindMine,
  onPlanAction,
  initialMetric,
}: {
  onSelectShop: (target: BeautyTopTarget) => void
  onFindMine: () => void
  onPlanAction: (action: GrowthAction) => void
  initialMetric: "reviews" | "followers"
}) {
  const options = useArea<BeautyTopOptions>("options")
  if (options.isPending) return <CardSkeleton />
  if (options.isError) return <LoadError onRetry={() => options.refetch()} />
  return (
    <ShopsTab
      initialMetric={initialMetric}
      options={options.data}
      onSelectShop={onSelectShop}
      onFindMine={onFindMine}
      onPlanAction={onPlanAction}
    />
  )
}

// With «my shop» chosen, its report already carries the watched shops; showing them again here duplicated the card.
function WatchSection({
  onSelectShop,
}: {
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const t = useTranslations("beautytop")
  const [shop] = useMyShop()
  if (shop !== null) return null
  return (
    <section aria-labelledby="bt-watch" className="flex flex-col gap-3">
      <h2 id="bt-watch" className="text-lg font-bold">
        {t("tabs.watch")}
      </h2>
      <WatchTab onSelectShop={onSelectShop} />
    </section>
  )
}

export function BeautyTopBoard() {
  const locale = useLocale()
  const { user } = useUser()
  const t = useTranslations("beautytop")
  const [tab, setTab] = useState<Tab>("neighborhood")
  const [initialMetric, setInitialMetric] = useState<"reviews" | "followers">(
    "reviews"
  )
  const [workspace, setWorkspace] = useState<"report" | "pricing" | "notes">(
    "report"
  )
  const [visitedTools, setVisitedTools] = useState<("pricing" | "notes")[]>([])
  const [intent, setIntent] = useState<GrowthAction | null>(null)
  const [target, setTarget] = useState<BeautyTopTarget | null>(null)

  useEffect(() => {
    try {
      const cached = localStorage.getItem(TAB_KEY)
      const saved = TABS.find((value) => value === cached)
      if (saved) setTab(saved)
    } catch {}
  }, [])

  const changeTab = (next: Tab) => {
    setIntent(null)
    setWorkspace("report")
    setVisitedTools([])
    if (next === "discovery") setScopeFilters({ sido: "", gugun: "" })
    setTab(next)
    document.getElementById(`bt-tab-${next}`)?.focus({ preventScroll: true })
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {}
  }

  const explore = (question: InsightQuestion) => {
    if (question === "price") {
      changeTab("myShop")
      setWorkspace("pricing")
      setVisitedTools(["pricing"])
      setIntent("PRICE_CHANGE")
    } else {
      setInitialMetric(question)
      changeTab("discovery")
    }
  }

  return (
    <div
      lang={locale}
      className="mt-6 motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:duration-0 [&:lang(ja)_.break-keep]:break-normal"
    >
      <div
        role="tablist"
        aria-label={t("navigationLabel")}
        className="border-border -mx-4 grid grid-cols-4 border-b"
      >
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`bt-tab-${value}`}
            aria-controls={`bt-panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            aria-selected={tab === value}
            onKeyDown={(event) => {
              const index = TABS.indexOf(value)
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % TABS.length
                  : event.key === "ArrowLeft"
                    ? (index + TABS.length - 1) % TABS.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? TABS.length - 1
                        : null
              if (next === null) return
              event.preventDefault()
              document.getElementById(`bt-tab-${TABS[next]}`)?.focus()
            }}
            onClick={() => changeTab(value)}
            className={cn(
              "-mb-px h-12 border-b-2 text-[16px] transition-colors duration-150",
              tab === value
                ? "border-foreground text-foreground font-bold"
                : "text-muted-foreground border-transparent font-medium"
            )}
          >
            {t(`tabs.${value}`)}
          </button>
        ))}
      </div>

      <details className="border-border bg-background text-muted-foreground mt-3 rounded-lg border px-3 py-2 text-xs">
        <summary className="cursor-pointer py-2 leading-5">
          {t("memberNoticeSummary")}
        </summary>
        <p className="pb-2 text-[13px] leading-5">
          {t.rich("memberNotice", {
            b: (chunks) => (
              <b className="text-foreground font-bold">{chunks}</b>
            ),
            link: (chunks) => (
              <LocalizedClientLink
                href="/mypage/membership/benefits"
                className="text-foreground underline underline-offset-2"
              >
                {chunks}
              </LocalizedClientLink>
            ),
          })}
        </p>
      </details>

      {TABS.filter((value) => value !== tab).map((value) => (
        <div
          key={value}
          id={`bt-panel-${value}`}
          role="tabpanel"
          aria-labelledby={`bt-tab-${value}`}
          hidden
        />
      ))}
      <div
        tabIndex={0}
        id={`bt-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`bt-tab-${tab}`}
        className="mt-5"
      >
        {tab === "neighborhood" && (
          <div className="space-y-6">
            <InsightQuestions member onExplore={explore} />
            <AreaView
              mineLabel={null}
              shopSlot={() => (
                <button
                  type="button"
                  onClick={() => changeTab("myShop")}
                  className="bg-foreground text-background hover:bg-foreground/90 flex w-full items-center justify-between rounded-lg p-4 text-left transition-colors"
                >
                  <span className="text-[15px] font-medium">
                    {t("area.toMyShop")}
                  </span>
                  <span aria-hidden className="text-primary">
                    →
                  </span>
                </button>
              )}
            />
          </div>
        )}
        {tab === "discovery" && (
          <PremiumGate
            key={user?.id}
            onDecline={() => changeTab("neighborhood")}
          >
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-bold">{t("discovery.title")}</h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("discovery.subtitle")}
                </p>
              </div>
              <Rankings
                initialMetric={initialMetric}
                onSelectShop={setTarget}
                onFindMine={() => changeTab("myShop")}
                onPlanAction={(action) => {
                  changeTab("myShop")
                  setWorkspace(action === "PRICE_CHANGE" ? "pricing" : "notes")
                  setVisitedTools([
                    action === "PRICE_CHANGE" ? "pricing" : "notes",
                  ])
                  setIntent(action)
                }}
              />
            </div>
          </PremiumGate>
        )}
        {tab === "myShop" && (
          <PremiumGate
            key={user?.id}
            onDecline={() => changeTab("neighborhood")}
          >
            <div className="flex flex-col gap-6">
              <div
                role="group"
                aria-label={t("workspace.label")}
                className="grid grid-cols-3 gap-2"
              >
                {(["report", "pricing", "notes"] as const).map((value) => (
                  <Button
                    key={value}
                    variant="secondary"
                    aria-pressed={workspace === value}
                    aria-controls="bt-workspace"
                    onClick={() => {
                      setWorkspace(value)
                      if (value !== "report")
                        setVisitedTools((current) =>
                          current.includes(value)
                            ? current
                            : [...current, value]
                        )
                      setIntent(null)
                    }}
                    className={cn(
                      "h-12 rounded-xl px-2 whitespace-normal",
                      workspace === value &&
                        "bg-foreground text-background hover:bg-foreground/90"
                    )}
                  >
                    {t(`workspace.${value}`)}
                  </Button>
                ))}
              </div>
              <div id="bt-workspace" className="space-y-6">
                {workspace === "report" && (
                  <>
                    <MyShopTab onSelectShop={setTarget} />
                    <WatchSection onSelectShop={setTarget} />
                  </>
                )}
                {visitedTools.includes("pricing") && (
                  <div hidden={workspace !== "pricing"} className="space-y-6">
                    <PriceCalculator
                      focusRequested={intent === "PRICE_CHANGE"}
                    />
                    <PriceSimulator onSelectShop={setTarget} />
                  </div>
                )}
                {visitedTools.includes("notes") && (
                  <div hidden={workspace !== "notes"}>
                    <GrowthNotes
                      suggestedAction={
                        intent === "PRICE_CHANGE" ? null : intent
                      }
                    />
                  </div>
                )}
              </div>
              <MembershipReceipt />
            </div>
          </PremiumGate>
        )}
        {tab === "brand" && (
          <PremiumGate
            key={user?.id}
            onDecline={() => changeTab("neighborhood")}
          >
            <FranchiseTab />
          </PremiumGate>
        )}
      </div>

      <ShopSheet target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
