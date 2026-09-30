"use client"

import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import type { BeautyTopOptions, BeautyTopTarget } from "../types"
import { useBeautyTop } from "../use-beautytop"
import { FranchiseTab } from "./franchise-tab"
import { MyShopTab } from "./my-shop-tab"
import { NeighborhoodTab } from "./neighborhood-tab"
import { Card, CardSkeleton, LoadError, Segmented } from "./parts"
import { ShopSheet } from "./shop-sheet"

const TAB_KEY = "beautytop:tab"
const TABS = ["myShop", "neighborhood", "franchise"] as const

type Tab = (typeof TABS)[number]

export function BeautyTopBoard() {
  const t = useTranslations("beautytop")
  const [tab, setTab] = useState<Tab>("myShop")
  const [target, setTarget] = useState<BeautyTopTarget | null>(null)
  const options = useBeautyTop<BeautyTopOptions>({ resource: "options" })

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
      <Segmented
        value={tab}
        onChange={changeTab}
        options={TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
        className="bg-border/60"
      />

      <div className="mt-5">
        {tab === "myShop" && <MyShopTab onSelectShop={setTarget} />}
        {tab === "neighborhood" &&
          (options.isPending ? (
            <CardSkeleton />
          ) : options.isError ? (
            <Card>
              <LoadError onRetry={() => options.refetch()} />
            </Card>
          ) : (
            <NeighborhoodTab options={options.data} onSelectShop={setTarget} />
          ))}
        {tab === "franchise" && <FranchiseTab />}
      </div>

      <ShopSheet target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
