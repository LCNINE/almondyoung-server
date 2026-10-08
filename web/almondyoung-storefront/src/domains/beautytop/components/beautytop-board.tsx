"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { Info } from "lucide-react"
import { useTranslations } from "next-intl"
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
}: {
  onSelectShop: (target: BeautyTopTarget) => void
  onFindMine: () => void
}) {
  const options = useArea<BeautyTopOptions>("options")
  if (options.isPending) return <CardSkeleton />
  if (options.isError) return <LoadError onRetry={() => options.refetch()} />
  return (
    <ShopsTab
      options={options.data}
      onSelectShop={onSelectShop}
      onFindMine={onFindMine}
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
  const t = useTranslations("beautytop")
  const [tab, setTab] = useState<Tab>("neighborhood")
  const [target, setTarget] = useState<BeautyTopTarget | null>(null)

  useEffect(() => {
    try {
      const cached = localStorage.getItem(TAB_KEY)
      const saved = TABS.find((value) => value === cached)
      if (saved) setTab(saved)
    } catch {}
  }, [])

  const changeTab = (next: Tab) => {
    if (next === "discovery") setScopeFilters({ sido: "", gugun: "" })
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {}
  }

  return (
    <div className="mt-6">
      <div
        role="tablist"
        className="border-border -mx-4 grid grid-cols-4 border-b"
      >
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
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

      <p className="bg-muted text-muted-foreground mt-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-[19px] break-keep">
        <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
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
        </span>
      </p>

      <div className="mt-5">
        {tab === "neighborhood" && (
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
        )}
        {tab === "discovery" && (
          <PremiumGate onDecline={() => changeTab("neighborhood")}>
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-bold">{t("discovery.title")}</h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("discovery.subtitle")}
                </p>
              </div>
              <Rankings
                onSelectShop={setTarget}
                onFindMine={() => changeTab("myShop")}
              />
            </div>
          </PremiumGate>
        )}
        {tab === "myShop" && (
          <PremiumGate onDecline={() => changeTab("neighborhood")}>
            <div className="flex flex-col gap-8">
              <MyShopTab onSelectShop={setTarget} />
              <PriceSimulator onSelectShop={setTarget} />
              <PriceCalculator />
              <GrowthNotes />
              <WatchSection onSelectShop={setTarget} />
              <MembershipReceipt />
            </div>
          </PremiumGate>
        )}
        {tab === "brand" && (
          <PremiumGate onDecline={() => changeTab("neighborhood")}>
            <FranchiseTab />
          </PremiumGate>
        )}
      </div>

      <ShopSheet target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
