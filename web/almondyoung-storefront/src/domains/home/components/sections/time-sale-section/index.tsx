"use client"

import { useState } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"
import type { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import type { TimeSaleTab } from "@/lib/utils/time-sale-tabs"
import { ProductSection } from "../../shared/product-section"
import { HomeSection } from "../../shared/home-section"

interface TimeSaleSectionProps {
  endsAt: string
  products: HttpTypes.StoreProduct[]
  tabs: TimeSaleTab[]
  customer: StoreCustomerWithGroups | null
  wishlistIds?: Set<string>
}

const toTabItem = (tab: TimeSaleTab) => ({ ...tab, id: tab.key })

const FALLBACK_TAB = {
  id: "all",
  key: "all",
  name: "",
  handle: "",
  productIds: [],
}

export function TimeSaleSection({
  endsAt,
  products,
  tabs,
  customer,
  wishlistIds,
}: TimeSaleSectionProps) {
  const t = useTranslations("home.timeSale")
  const items = tabs.map(toTabItem)
  const [activeTab, setActiveTab] = useState(items[0])

  const visible = activeTab
    ? products.filter((product) => activeTab.productIds.includes(product.id))
    : products

  return (
    <HomeSection background="muted" className="[&_img]:p-0!">
      <ProductSection
        title={
          <>
            <span className="text-primary">{t("titleFirst")}</span>
            {t("titleSecond")}
          </>
        }
        tabs={items.length > 0 ? items : [FALLBACK_TAB]}
        activeTab={activeTab ?? FALLBACK_TAB}
        hideTabs={items.length === 0}
        products={visible}
        onTabChange={setActiveTab}
        customer={customer}
        wishlistIds={wishlistIds}
        moreHref="/time-sale"
        emptyTitle={t("emptyTitle")}
        renderOverlay={() => (
          <TimeSaleCountdown
            endsAt={endsAt}
            compact
            clockOnly
            className="absolute inset-x-0 bottom-0 z-10 bg-black/55 py-1 text-center text-[13px] font-semibold text-white tabular-nums"
          />
        )}
      />
    </HomeSection>
  )
}
