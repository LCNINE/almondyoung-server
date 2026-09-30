"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import type { BeautyTopOptions, BeautyTopTarget } from "../types"
import { useBeautyTop } from "../use-beautytop"
import { FranchiseTab } from "./franchise-tab"
import { MyShopTab, WatchTab } from "./my-shop-tab"
import { NeighborhoodTab } from "./neighborhood-tab"
import { Card, CardSkeleton, LoadError } from "./parts"
import { ShopSheet } from "./shop-sheet"
import { ShopsTab } from "./shops-tab"
import { TrendsTab } from "./trends-tab"

const TAB_KEY = "beautytop:tab"
const TABS = [
  "myShop",
  "neighborhood",
  "shops",
  "watch",
  "trends",
  "franchise",
] as const

type Tab = (typeof TABS)[number]

export function BeautyTopBoard() {
  const t = useTranslations("beautytop")
  const [tab, setTab] = useState<Tab>("myShop")
  const [target, setTarget] = useState<BeautyTopTarget | null>(null)
  const needsOptions =
    tab === "neighborhood" || tab === "shops" || tab === "trends"
  const options = useBeautyTop<BeautyTopOptions>(
    { resource: "options" },
    needsOptions
  )

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as Tab | null
      if (saved && TABS.includes(saved)) setTab(saved)
    } catch {}
  }, [])

  const changeTab = (next: Tab) => {
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {}
  }

  return (
    <div className="mt-6">
      <div
        role="tablist"
        className="scrollbar-hide border-border -mx-4 flex gap-5 overflow-x-auto border-b px-4"
      >
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => changeTab(value)}
            className={cn(
              "-mb-px h-12 shrink-0 border-b-2 text-[17px] transition-colors duration-150",
              tab === value
                ? "border-foreground text-foreground font-bold"
                : "text-muted-foreground border-transparent font-medium"
            )}
          >
            {t(`tabs.${value}`)}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "myShop" && <MyShopTab onSelectShop={setTarget} />}
        {tab === "watch" && <WatchTab onSelectShop={setTarget} />}
        {tab === "franchise" && <FranchiseTab />}
        {needsOptions &&
          (options.isPending ? (
            <CardSkeleton />
          ) : options.isError ? (
            <Card>
              <LoadError onRetry={() => options.refetch()} />
            </Card>
          ) : tab === "neighborhood" ? (
            <NeighborhoodTab options={options.data} onSelectShop={setTarget} />
          ) : tab === "shops" ? (
            <ShopsTab options={options.data} onSelectShop={setTarget} />
          ) : (
            <TrendsTab options={options.data} />
          ))}
      </div>

      <ShopSheet target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
